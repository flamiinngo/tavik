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
  EntitySource,
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
    incoming: readonly Entity[],
    options: QueryOptions = {},
  ): Promise<number> {
    if (incoming.length === 0) return 0;

    // Combine repeats of the same thing before anything else touches them.
    //
    // Two ingestion stages routinely describe one entity: the lockfile knows
    // that `flatten@1.0.3` is installed, the registry knows it is deprecated.
    // Both emit a Release with the same URN carrying different facts, and
    // HydraDB rejects the whole batch — `conflicting metadata values for vertex
    // ... property deprecated` — because one `UNWIND ... MERGE ... SET` cannot
    // set one property to two values.
    //
    // Dropping either copy would be worse than the error. `deprecated` is
    // precisely what the "abandoned code" rule matches on, so losing the
    // registry's copy turns a rule that should be red into a quiet green. They
    // are merged instead, which loses nothing.
    const entities = mergeByUrn(incoming);

    // Fail loudly before writing: a collision would merge two unrelated
    // entities and fabricate paths through the merged node.
    const collisions = detectCollisions(entities.map((entity) => entity.urn));
    if (collisions.length > 0) throw new NodeIdCollisionError(collisions);

    // Write only what actually differs.
    //
    // Rewriting every entity on every scan is the single largest source of
    // write churn in this system, and churn is not free here: HydraDB is
    // log-structured, and enough of it degrades every subsequent read. Measured
    // on an identical graph, the same rule check took 1,198ms against a clean
    // store and 27,616ms against a churned one — a 23x difference that pushed
    // verification past the server's 30s limit and made it report `unknown`.
    //
    // Relations were already diffed for this reason. Entities were not, so a
    // re-scan rewrote all ~1,800 of them to change nothing.
    const unchanged = await this.unchangedEntities(entities, options);
    const pending = entities.filter((entity) => !unchanged.has(entity.urn));
    if (pending.length === 0) return 0;

    const label = identifier(ENTITY_LABEL);
    let written = 0;

    for (const batch of chunk(pending, WRITE_BATCH_SIZE)) {
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
   * Which of these entities are already stored exactly as given.
   *
   * Compares the properties a write would actually set. Anything missing, or
   * differing in any of them, is treated as pending — the comparison errs
   * toward writing, since a skipped update leaves the graph stating something
   * untrue, which is far worse than a redundant write.
   */
  private async unchangedEntities(
    entities: readonly Entity[],
    options: QueryOptions = {},
  ): Promise<Set<EntityUrn>> {
    const label = identifier(ENTITY_LABEL);
    const unchanged = new Set<EntityUrn>();

    try {
      const stored = new Map<string, Record<string, unknown>>();

      // Read in batches of WRITE_BATCH_SIZE (500), which keeps every request
      // under HydraDB's 1024-row result cap. Reading all ids in one query would
      // silently truncate and make everything past the cap look changed forever.
      for (const batch of chunk(entities, WRITE_BATCH_SIZE)) {
        const result = await this.client.query(
          `UNWIND $ids AS wanted
           MATCH (e:${label.text} {id: wanted})
           RETURN e.urn AS urn, e.kind AS kind, e.name AS name, e.source AS source,
                  e.tag AS tag, e.environment AS environment, e.trust AS trust,
                  e.deprecated AS deprecated, e.sole_publisher AS sole_publisher`,
          {
            ...options,
            parameters: { ids: batch.map((entity) => urnToNodeId(entity.urn)) },
          },
        );
        for (const row of result.rows) {
          stored.set(String(row.urn), row);
        }
      }

      for (const entity of entities) {
        const row = stored.get(String(entity.urn));
        if (!row) continue;

        const attributes = selectorAttributes(entity);
        const same =
          String(row.kind ?? "") === entity.kind &&
          String(row.name ?? "") === entity.name &&
          String(row.source ?? "") === entity.source &&
          String(row.tag ?? "") === attributes.tag &&
          String(row.environment ?? "") === attributes.environment &&
          String(row.trust ?? "") === attributes.trust &&
          String(row.deprecated ?? "") === attributes.deprecated &&
          String(row.sole_publisher ?? "") === attributes.sole_publisher;

        if (same) unchanged.add(entity.urn);
      }
    } catch {
      // If the comparison fails, write everything. Skipping a write on the
      // strength of a failed read is how a graph ends up quietly stale.
      return new Set();
    }

    return unchanged;
  }

  /**
   * Every publisher, with how many packages each can publish to.
   *
   * Reach is what makes a publisher worth looking at: an account that can push
   * to one package is a small decision, one that can push to a hundred is a
   * single point of failure. Sorting by it puts the decisions that matter at the
   * top, which is the whole value of the screen.
   *
   * Counted in application code rather than with an aggregate: HydraDB supports
   * only `count(*)` over a whole match, not a per-group count, so there is no
   * way to ask it for this directly.
   */
  async listPublishers(
    options: QueryOptions = {},
  ): Promise<
    { urn: string; name: string; trust: string; packages: number }[]
  > {
    const label = identifier(ENTITY_LABEL);

    // Publishers, paged past the 1024-row cap.
    const publishers = new Map<string, { name: string; trust: string; packages: number }>();
    const PAGE = 1000;

    for (let skip = 0; ; skip += PAGE) {
      const result = await this.client.query<{
        urn: string;
        name: string;
        trust: string;
      }>(
        `MATCH (n:${label.text})
         WHERE n.kind = 'Maintainer'
         RETURN n.urn AS urn, n.name AS name, n.trust AS trust
         SKIP ${skip} LIMIT ${PAGE}`,
        { timeoutMs: 60_000, ...options },
      );

      for (const row of result.rows) {
        const urn = String(row.urn);
        if (urn.length === 0) continue;
        publishers.set(urn, {
          name: String(row.name ?? ""),
          trust: String(row.trust ?? "untrusted"),
          packages: 0,
        });
      }

      if (result.rows.length < PAGE) break;
    }

    // Their publish rights, also paged.
    for (const pair of await this.listRelationsOfKind("MAINTAINS", options)) {
      const [from] = pair.split("|");
      const publisher = publishers.get(from);
      if (publisher) publisher.packages++;
    }

    return [...publishers.entries()]
      .map(([urn, value]) => ({ urn, ...value }))
      .sort((a, b) => b.packages - a.packages || a.name.localeCompare(b.name));
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
    const pairs = new Set<string>();

    // Paged, because HydraDB caps a result set at 1024 rows.
    //
    // Unpaged, this returned exactly 1024 edges no matter how many existed, so
    // every edge past the first 1024 looked new on every scan and was rewritten
    // forever. That is the write churn that degrades reads: on an identical
    // graph the same rule check measured 976ms against a clean store and
    // 27,616ms against a churned one — past the server's 30s limit, and
    // therefore reported as `unknown`.
    //
    // A silently truncated read is precisely the failure this product exists to
    // catch, and it was sitting in our own diffing.
    const PAGE = 1000;
    for (let skip = 0; ; skip += PAGE) {
      const result = await this.client.query<{ from_urn: string; to_urn: string }>(
        `MATCH (a:${label.text})-[r:${relType.text}]->(b:${label.text})
         RETURN a.urn AS from_urn, b.urn AS to_urn
         SKIP ${skip} LIMIT ${PAGE}`,
        { timeoutMs: 120_000, ...options },
      );

      for (const row of result.rows) {
        if (typeof row.from_urn === "string" && typeof row.to_urn === "string") {
          pairs.add(`${row.from_urn}|${row.to_urn}`);
        }
      }

      if (result.rows.length < PAGE) break;
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

    // Paged: an unpaged read is capped at 1024 rows, so a wipe would leave
    // everything past the first 1024 in place while reporting success.
    const urns: EntityUrn[] = [];
    const PAGE = 1000;
    for (let skip = 0; ; skip += PAGE) {
      const result = await this.client.query<{ urn: string }>(
        `MATCH (n:${label.text}) RETURN n.urn AS urn SKIP ${skip} LIMIT ${PAGE}`,
        { timeoutMs: 60_000, ...queryOptions },
      );
      for (const row of result.rows) {
        const urn = String(row.urn);
        if (urn.length > 0) urns.push(urn as EntityUrn);
      }
      if (result.rows.length < PAGE) break;
    }

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
 * Combine entities that describe the same thing.
 *
 * Ingestion runs in stages that each know part of the truth. A lockfile knows
 * `flatten@1.0.3` is installed and what its integrity hash is; the npm registry
 * knows the same release is deprecated. Both emit a Release with the same URN,
 * and both are right.
 *
 * The merge is additive, and deliberately so. Taking the last copy wholesale
 * would drop the lockfile's integrity hash; taking the first would drop
 * `deprecated`, which is the exact property the "abandoned code" rule matches
 * on — so a package the registry has marked abandoned would sail past the rule
 * meant to catch it. A silent false green is the worst outcome this system can
 * produce, so nothing is discarded: later stages fill in facts, and only
 * genuinely conflicting values are overwritten.
 *
 * Order carries meaning. Callers pass stages in the order they ran, so a later
 * stage's value wins a real conflict — which is right, because the registry is
 * a live source and the lockfile is a snapshot.
 */
function mergeByUrn(entities: readonly Entity[]): Entity[] {
  // The overwhelmingly common case is no duplicates at all. Checking first
  // keeps a 4,000-entity scan from rebuilding every object for nothing.
  const seen = new Set<string>();
  let duplicated = false;
  for (const entity of entities) {
    if (seen.has(entity.urn)) {
      duplicated = true;
      break;
    }
    seen.add(entity.urn);
  }
  if (!duplicated) return [...entities];

  const merged = new Map<EntityUrn, Entity>();

  for (const entity of entities) {
    const existing = merged.get(entity.urn);
    if (!existing) {
      merged.set(entity.urn, entity);
      continue;
    }

    merged.set(entity.urn, {
      ...existing,
      ...entity,
      // Provenance, resolved so that the one guarantee that must never break
      // cannot break: demo data is never relabelled as live. If any stage that
      // described this entity was the labelled demo environment, the merged
      // entity stays demo. Otherwise the later stage wins, being the more
      // recently confirmed of the two.
      source: mergeSource(existing.source, entity.source),
      // Spreading the entities would let a later copy with no attributes at all
      // erase an earlier copy's attributes wholesale.
      attributes: { ...existing.attributes, ...entity.attributes },
      // A missing displayName must not blank out one that was set.
      displayName: entity.displayName ?? existing.displayName,
    });
  }

  return [...merged.values()];
}

/**
 * Which provenance survives when two stages describe one entity.
 *
 * Only one rule here is non-negotiable: an entity the demo environment touched
 * stays labelled demo. Tavik must never present demo data as though it were live
 * infrastructure, and merging is exactly where that could happen silently — a
 * demo fixture combined with a real registry lookup would otherwise come out
 * looking entirely real.
 */
function mergeSource(existing: EntitySource, incoming: EntitySource): EntitySource {
  if (existing === "demo" || incoming === "demo") return "demo";
  return incoming;
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
