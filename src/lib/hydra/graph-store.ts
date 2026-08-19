/**
 * The security state graph, as stored in HydraDB.
 *
 * The only place in Tavik that writes Cypher. Everything above works in domain
 * terms; everything below is HydraDB's wire protocol.
 *
 * **Tavik never traverses edges in application code.** Reachability is answered
 * by HydraDB's native `algo.MSpaths`, which resolves many sources against many
 * targets inside the database. Walking edges in Node would be slower, would not
 * scale past a toy graph, and would move the security decision out of the
 * deterministic layer.
 *
 * Schema
 * ------
 *   (:Entity {id, urn, kind, name, source})
 *   -[:SUPPLIES|MAINTAINS|HAS_RELEASE|CAN_ASSUME|... ]->
 *   (:Entity)
 *
 * `id` is an integer derived from `urn` (see node-id.ts) because HydraDB refuses
 * writes without one. `urn` remains the identity Tavik reasons about, and is the
 * property `algo.MSpaths` keys on.
 *
 * Every form below was verified against a live server by `npm run hydra:probe`.
 * The accepted subset is narrow and unintuitive; see docs/hydra.md before
 * changing a query.
 */

import type {
  Entity,
  EntityUrn,
  Relation,
  RelationKind,
} from "@/lib/domain/entities";
import type { EntitySelector, SecurityBoundary } from "@/lib/domain/boundary";
import type { HydraClient, HydraParam, QueryOptions } from "./client";
import { encodeValue, identifier } from "./cypher";
import { detectCollisions, NodeIdCollisionError, urnToNodeId } from "./node-id";

/** The single node label carrying all security state. */
const ENTITY_LABEL = "Entity";

/**
 * Rows per `UNWIND` statement. HydraDB takes one statement per request, so this
 * trades round trips against payload size.
 */
const WRITE_BATCH_SIZE = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

export interface EntityRow {
  urn: string;
  kind: string;
  name: string;
  source: string;
  /** Rows are projections from HydraDB, which may carry columns we ignore. */
  [column: string]: unknown;
}

export class GraphStore {
  constructor(private readonly client: HydraClient) {}

  // ── Writes ────────────────────────────────────────────────────────────────

  /**
   * Insert or update entities, keyed on the id derived from `urn`.
   *
   * The accepted upsert form is narrow: `MERGE` may match on `id` only, and the
   * label has to be applied afterwards with `SET`. HydraDB rejects a label
   * inside the MERGE pattern and rejects `MERGE ... SET` outside of `UNWIND`.
   *
   * Idempotent, so re-ingesting a registry snapshot converges instead of
   * duplicating — which matters because ingestion is resumable.
   */
  async upsertEntities(
    entities: readonly Entity[],
    options: QueryOptions = {},
  ): Promise<number> {
    if (entities.length === 0) return 0;

    // Fail loudly before writing: a collision would merge two unrelated
    // entities and fabricate paths through the merged node.
    const collisions = detectCollisions(entities.map((entity) => entity.urn));
    if (collisions.length > 0) throw new NodeIdCollisionError(collisions);

    const label = identifier(ENTITY_LABEL);
    let written = 0;

    for (const batch of chunk(entities, WRITE_BATCH_SIZE)) {
      const rows = batch.map((entity) => ({
        id: urnToNodeId(entity.urn),
        urn: entity.urn as string,
        kind: entity.kind,
        name: entity.name,
        source: entity.source,
        // Selector-addressable attributes are written as first-class properties
        // rather than a bag. `UNWIND ... SET` needs statically-named properties,
        // and the set a selector can match on is closed and small (see
        // EntitySelector), so enumerating them here is both necessary and
        // sufficient. Absent values become '' rather than null so that an
        // equality predicate never matches by accident.
        ...selectorAttributes(entity),
      }));

      await this.client.query(
        `UNWIND $rows AS row
         MERGE (n {id: row.id})
         SET n:${label.text}, n.urn = row.urn, n.kind = row.kind,
             n.name = row.name, n.source = row.source,
             n.tag = row.tag, n.environment = row.environment, n.trust = row.trust,
             n.deprecated = row.deprecated, n.sole_publisher = row.sole_publisher`,
        { ...options, parameters: { rows: rows as unknown as HydraParam } },
      );
      written += batch.length;
    }
    return written;
  }

  /**
   * Insert relationships.
   *
   * Batched writes accept exactly one relationship type and no edge properties,
   * so relations are grouped by kind and written a type at a time.
   *
   * Endpoints are matched by id rather than merged, so an edge referencing an
   * entity that was never written simply does not appear — it does not
   * silently create an empty node that would distort later traversals.
   */
  async insertRelations(
    relations: readonly Relation[],
    options: QueryOptions = {},
  ): Promise<number> {
    if (relations.length === 0) return 0;
    let written = 0;

    for (const [kind, group] of groupByKind(relations)) {
      const relType = identifier(kind);

      for (const batch of chunk(group, WRITE_BATCH_SIZE)) {
        const rows = batch.map((relation) => ({
          from: urnToNodeId(relation.from),
          to: urnToNodeId(relation.to),
        }));

        await this.client.query(
          `UNWIND $rows AS row
           CREATE (a {id: row.from})-[:${relType.text}]->(b {id: row.to})`,
          { ...options, parameters: { rows: rows as unknown as HydraParam } },
        );
        written += batch.length;
      }
    }
    return written;
  }

  /**
   * Remove every relationship of one type between two entities.
   *
   * This is the remediation primitive. Deleting the edge is what actually
   * restores a boundary, and the re-verification that follows runs against the
   * mutated graph — the state change is real, not a flag flip in the UI.
   *
   * Batched edge writes cannot use `MERGE`, so duplicates are possible across
   * re-ingestions; deleting by pattern removes all of them, which is the
   * behaviour remediation needs.
   */
  async deleteRelation(
    from: EntityUrn,
    to: EntityUrn,
    kind: RelationKind,
    options: QueryOptions = {},
  ): Promise<void> {
    const relType = identifier(kind);
    await this.client.query(
      `MATCH (a {id: $from})-[r:${relType.text}]->(b {id: $to}) DELETE r`,
      {
        ...options,
        parameters: { from: urnToNodeId(from), to: urnToNodeId(to) },
      },
    );
  }

  /**
   * Change an entity's trust label.
   *
   * Trust is this workspace's own policy, not a fact about the world and never a
   * judgement about a person — see the note in ingest/maintainers.ts. Moving an
   * account onto or off a list is a real decision a security team makes, and it
   * is a real mutation of the graph, so a boundary re-checked afterwards is
   * answering a genuinely different question.
   */
  async setTrust(
    urn: EntityUrn,
    trust: "trusted" | "untrusted" | "quarantined",
    options: QueryOptions = {},
  ): Promise<void> {
    const label = identifier(ENTITY_LABEL);
    // No `RETURN` after the `SET`: HydraDB refuses a mutation that continues
    // with MATCH, RETURN or WITH. Callers that need to confirm the write read
    // it back separately with getEntity.
    await this.client.query(
      `MATCH (n:${label.text} {id: $id}) SET n.trust = $trust`,
      { ...options, parameters: { id: urnToNodeId(urn), trust } },
    );
  }

  /**
   * Store a small piece of workspace state, such as when the last sweep ran.
   *
   * Kept under its own `Meta` label so it can never appear in a traversal. The
   * alternative — writing a log entry per sweep — would bury real events under
   * routine heartbeats and make the work log unreadable.
   */
  async setMeta(key: string, value: number, options: QueryOptions = {}): Promise<void> {
    const label = identifier("Meta");
    await this.client.query(
      `UNWIND $rows AS row
       MERGE (n {id: row.id})
       SET n:${label.text}, n.meta_key = row.key, n.meta_value = row.value`,
      {
        ...options,
        parameters: {
          rows: [
            { id: urnToNodeId(`tavik:meta:${key}`), key, value },
          ] as unknown as HydraParam,
        },
      },
    );
  }

  async getMeta(key: string, options: QueryOptions = {}): Promise<number | null> {
    const label = identifier("Meta");
    try {
      const result = await this.client.query<{ value: number }>(
        `MATCH (n:${label.text} {id: $id}) RETURN n.meta_value AS value`,
        { ...options, parameters: { id: urnToNodeId(`tavik:meta:${key}`) } },
      );
      const value = Number(result.rows[0]?.value);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  /** Look up an entity by URN, for confirming a mutation targeted something real. */
  async getEntity(
    urn: EntityUrn,
    options: QueryOptions = {},
  ): Promise<EntityRow | null> {
    const label = identifier(ENTITY_LABEL);
    const result = await this.client.query<EntityRow>(
      `MATCH (e:${label.text} {id: $id})
       RETURN e.urn AS urn, e.kind AS kind, e.name AS name, e.source AS source`,
      { ...options, parameters: { id: urnToNodeId(urn) } },
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      urn: String(row.urn),
      kind: String(row.kind),
      name: String(row.name),
      source: String(row.source),
    };
  }

  /**
   * List every relationship of one type, as `from|to` URN pairs.
   *
   * This is what lets ingestion be incremental. HydraDB refuses `MERGE` for
   * batched edge writes, so re-running an ingestion with `CREATE` would
   * duplicate every edge — and duplicates are not harmless: they do not change
   * *whether* a path exists, but they multiply the routes the traversal must
   * enumerate.
   *
   * The obvious fix — delete every edge of the type and rewrite it — was tried
   * and is worse. HydraDB is log-structured, and deleting several thousand edges
   * left enough tombstones to slow *every* read: a boundary check went from
   * 420ms to 31s and timed out, and writes began failing with server errors. A
   * clean rebuild restored 420ms, confirming the churn rather than the data
   * volume was the cause.
   *
   * So ingestion reads what exists, and writes only the difference. Which is
   * also strictly better product behaviour: the difference *is* the change, and
   * that is what the change log wants to record.
   */
  async listRelationsOfKind(
    kind: RelationKind,
    options: QueryOptions = {},
  ): Promise<Set<string>> {
    const label = identifier(ENTITY_LABEL);
    const relType = identifier(kind);
    const result = await this.client.query<{ from_urn: string; to_urn: string }>(
      `MATCH (a:${label.text})-[r:${relType.text}]->(b:${label.text})
       RETURN a.urn AS from_urn, b.urn AS to_urn`,
      { timeoutMs: 120_000, ...options },
    );

    const pairs = new Set<string>();
    for (const row of result.rows) {
      if (typeof row.from_urn === "string" && typeof row.to_urn === "string") {
        pairs.add(`${row.from_urn}|${row.to_urn}`);
      }
    }
    return pairs;
  }

  /**
   * Remove specific entities and every relationship attached to them.
   *
   * Deleted one id per statement rather than in a batch: HydraDB has no
   * supported `UNWIND ... DETACH DELETE` form, and this is used for small,
   * known sets — test fixtures and single-entity removals — not bulk teardown.
   */
  async deleteEntities(
    urns: readonly EntityUrn[],
    options: QueryOptions = {},
  ): Promise<void> {
    for (const urn of urns) {
      await this.client.query("MATCH (n {id: $id}) DETACH DELETE n", {
        ...options,
        parameters: { id: urnToNodeId(urn) },
      });
    }
  }

  /**
   * Remove all Tavik state for the whole graph.
   *
   * Destructive and deliberately blunt — environment reset, not test cleanup.
   * Tests should delete their own fixtures with {@link deleteEntities}, since
   * this destroys real ingested state too.
   *
   * Deleted in batches rather than as one statement. HydraDB enforces its own
   * 30s query timeout, which a single `DETACH DELETE` over a real graph exceeds
   * — the client timeout is irrelevant because the limit is server-side. Reading
   * the ids first and removing them in chunks keeps every statement well inside
   * it, and lets progress be reported on what is otherwise a long silent wait.
   */
  async clear(
    options: QueryOptions & { onProgress?: (done: number, total: number) => void } = {},
  ): Promise<void> {
    const label = identifier(ENTITY_LABEL);
    const { onProgress, ...queryOptions } = options;

    const result = await this.client.query<{ urn: string }>(
      `MATCH (n:${label.text}) RETURN n.urn AS urn`,
      { timeoutMs: 60_000, ...queryOptions },
    );

    const urns = result.rows
      .map((row) => String(row.urn))
      .filter((urn) => urn.length > 0) as EntityUrn[];

    const BATCH = 40;
    for (let i = 0; i < urns.length; i += BATCH) {
      await Promise.all(
        urns.slice(i, i + BATCH).map((urn) =>
          this.client.query("MATCH (n {id: $id}) DETACH DELETE n", {
            ...queryOptions,
            parameters: { id: urnToNodeId(urn) },
          }),
        ),
      );
      onProgress?.(Math.min(i + BATCH, urns.length), urns.length);
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /**
   * Resolve a selector to concrete URNs.
   *
   * Selectors are equality-only. `algo.MSpaths` takes arrays of string values
   * for its endpoints, so set membership is expressed there rather than in a
   * `WHERE` clause — which is just as well, since HydraDB rejects `IN`.
   */
  async resolveSelector(
    selector: EntitySelector,
    options: QueryOptions = {},
  ): Promise<readonly EntityUrn[]> {
    const label = identifier(ENTITY_LABEL);
    const property = identifier(selector.property);

    const result = await this.client.query<{ urn: string }>(
      `MATCH (e:${label.text})
       WHERE e.kind = $kind AND e.${property.text} = $value
       RETURN e.urn AS urn`,
      {
        ...options,
        parameters: { kind: selector.kind, value: selector.value },
      },
    );
    return result.rows.map((row) => String(row.urn) as EntityUrn);
  }

  /** Fetch entities by URN, for rendering path evidence. */
  async getEntities(
    urns: readonly EntityUrn[],
    options: QueryOptions = {},
  ): Promise<Map<EntityUrn, EntityRow>> {
    const found = new Map<EntityUrn, EntityRow>();
    if (urns.length === 0) return found;
    const label = identifier(ENTITY_LABEL);

    for (const batch of chunk(urns, WRITE_BATCH_SIZE)) {
      const result = await this.client.query<EntityRow>(
        `UNWIND $ids AS wanted
         MATCH (e:${label.text} {id: wanted})
         RETURN e.urn AS urn, e.kind AS kind, e.name AS name, e.source AS source`,
        {
          ...options,
          parameters: { ids: batch.map((urn) => urnToNodeId(urn)) },
        },
      );
      for (const row of result.rows) {
        found.set(String(row.urn) as EntityUrn, {
          urn: String(row.urn),
          kind: String(row.kind),
          name: String(row.name),
          source: String(row.source),
        });
      }
    }
    return found;
  }

  /**
   * Build the reachability query for a boundary.
   *
   * `pairwise: false` gives the semantics a boundary needs — violated if *any*
   * source reaches *any* target. `algo.MSpaths` accepts several relationship
   * types even though inline patterns permit only one, which is what makes a
   * multi-hop, multi-relation boundary expressible in a single native call.
   *
   * An empty result is what proves a boundary, which is why the client throws on
   * an unrecognised envelope rather than returning no rows.
   */
  buildPathQuery(
    boundary: SecurityBoundary,
    sourceUrns: readonly EntityUrn[],
    targetUrns: readonly EntityUrn[],
    pathLimit: number,
  ): string {
    // Relationship types are structural identifiers, never ingested data, and
    // are validated rather than escaped.
    const relTypes = boundary.relations
      .map((relation) => `'${identifier(relation).text}'`)
      .join(", ");

    // The endpoint lists have to be inlined: HydraDB accepts a composite
    // parameter only as an `UNWIND` input, so `sourceValues: $sourceValues` is
    // refused inside a procedure's config map. That makes this the one place
    // where untrusted data is concatenated into Cypher — URNs embed npm package
    // names, which anyone can publish — so both lists go through the encoder in
    // cypher.ts rather than being interpolated directly.
    return `CALL algo.MSpaths({
      sourceLabel: '${identifier(ENTITY_LABEL).text}',
      sourceProperty: 'urn',
      sourceValues: ${encodeValue(sourceUrns.map(String))},
      targetValues: ${encodeValue(targetUrns.map(String))},
      pairwise: false,
      relTypes: [${relTypes}],
      relDirection: 'outgoing',
      maxLen: ${Math.trunc(boundary.maxHops)},
      pathCount: ${Math.trunc(pathLimit)},
      resultLimit: ${Math.trunc(pathLimit)}
    }) YIELD path RETURN path`;
  }

  /**
   * How many entities of a kind exist, regardless of any selector.
   *
   * Used to tell two very different situations apart: a selector matching
   * nothing because ingestion never ran, versus matching nothing because
   * genuinely nothing in the estate carries that risk. The first is `unknown`;
   * the second is a boundary that holds.
   */
  async countEntitiesOfKind(
    kind: string,
    options: QueryOptions = {},
  ): Promise<number> {
    const label = identifier(ENTITY_LABEL);
    const result = await this.client.query<{ total: number }>(
      `MATCH (n:${label.text}) WHERE n.kind = $kind RETURN count(*) AS total`,
      { ...options, parameters: { kind } },
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  /** Total entity count, for the dashboard state summary. */
  async countEntities(options: QueryOptions = {}): Promise<number> {
    const label = identifier(ENTITY_LABEL);
    const result = await this.client.query<{ total: number }>(
      `MATCH (n:${label.text}) RETURN count(*) AS total`,
      options,
    );
    return Number(result.rows[0]?.total ?? 0);
  }
}

/**
 * Project the attributes a selector can match on.
 *
 * Kept as a closed set matching `EntitySelector["property"]`. Adding a selector
 * property means adding it here and to the `SET` clause in `upsertEntities` —
 * the two must stay in step, or a selector will silently match nothing and the
 * boundary it belongs to will report `unknown`.
 */
function selectorAttributes(entity: Entity): Record<string, string> {
  const attributes = entity.attributes ?? {};
  const read = (key: string): string => {
    const value = attributes[key];
    if (typeof value === "string") return value;
    // Booleans are stored as strings because selectors compare for equality
    // against a literal, and "true"/"false" reads correctly in a UI that shows
    // the raw predicate alongside the description.
    if (typeof value === "boolean") return value ? "true" : "false";
    return "";
  };
  return {
    tag: read("tag"),
    environment: read("environment"),
    trust: read("trust"),
    deprecated: read("deprecated"),
    sole_publisher: read("sole_publisher"),
  };
}

function groupByKind(
  relations: readonly Relation[],
): Map<RelationKind, Relation[]> {
  const grouped = new Map<RelationKind, Relation[]>();
  for (const relation of relations) {
    const existing = grouped.get(relation.kind);
    if (existing) existing.push(relation);
    else grouped.set(relation.kind, [relation]);
  }
  return grouped;
}
