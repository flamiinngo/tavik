/**
 * The verification engine — the deterministic core of the product.
 *
 * This decides GREEN or RED, and it is the one place where being subtly wrong
 * would be worse than crashing. Three rules govern it:
 *
 *   1. It is deterministic. No model, no heuristic, no scoring. A boundary holds
 *      or it does not, and the answer comes from a graph traversal.
 *   2. It never traverses edges itself. HydraDB answers the reachability
 *      question; this module resolves the endpoints, asks, and interprets.
 *   3. It fails to `unknown`, never to `verified`. Every failure path returns
 *      `unknown` with a reason. A boundary that could not be checked is not a
 *      boundary that holds.
 */

import {
  type BoundaryVerification,
  type SecurityBoundary,
  validateBoundary,
} from "@/lib/domain/boundary";
import type {
  Entity,
  EntityUrn,
  PathHop,
  ReachabilityPath,
  RelationKind,
} from "@/lib/domain/entities";
import { isEntityKind, isRelationKind, KIND_DESCRIPTIONS } from "@/lib/domain/entities";
import type { HydraClient, HydraNode, HydraPath, QueryOptions } from "@/lib/hydra/client";
import { HydraError } from "@/lib/hydra/errors";
import type { GraphStore } from "@/lib/hydra/graph-store";

/**
 * How many violating paths to retrieve.
 *
 * A boundary is violated by the existence of one path, so this is only about how
 * much evidence to show — enough to make the shape of the problem legible,
 * bounded so a badly-scoped boundary cannot return a million rows.
 */
export const DEFAULT_PATH_LIMIT = 25;

export interface VerifyOptions extends QueryOptions {
  readonly pathLimit?: number;
  /** Injectable clock, so tests are not time-dependent. */
  readonly now?: () => number;
}

/**
 * Verify one boundary against the current graph.
 *
 * Never throws. Every failure becomes an `unknown` verification carrying the
 * reason, because an error escaping this function would most likely be rendered
 * somewhere as "no violations found".
 */
export async function verifyBoundary(
  store: GraphStore,
  client: HydraClient,
  boundary: SecurityBoundary,
  options: VerifyOptions = {},
): Promise<BoundaryVerification> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const pathLimit = options.pathLimit ?? DEFAULT_PATH_LIMIT;

  const unknown = (reason: string, sourceCount = 0, targetCount = 0) =>
    ({
      boundaryId: boundary.id,
      status: "unknown" as const,
      verifiedAt: now(),
      paths: [],
      truncated: false,
      sourceCount,
      targetCount,
      elapsedMs: now() - startedAt,
      failureReason: reason,
    }) satisfies BoundaryVerification;

  const problems = validateBoundary(boundary);
  if (problems.length > 0) {
    return unknown(`This boundary is not well-formed: ${problems.join(" ")}`);
  }

  // A verification is a safety claim, so it reads the freshest durable state
  // rather than a possibly-stale cached view. This matters most for the
  // re-verification immediately after a remediation.
  const queryOptions: QueryOptions = { ...options, consistency: "strong" };

  let sourceUrns: readonly EntityUrn[];
  let targetUrns: readonly EntityUrn[];
  try {
    [sourceUrns, targetUrns] = await Promise.all([
      store.resolveSelector(boundary.source, queryOptions),
      store.resolveSelector(boundary.target, queryOptions),
    ]);
  } catch (error) {
    return unknown(describeFailure(error, "resolving the boundary's endpoints"));
  }

  // An empty endpoint set has two very different meanings, and collapsing them
  // would either hide a real gap or invent a false alarm.
  //
  //   Nothing of that kind exists at all  → ingestion has not run. `unknown`.
  //   The kind exists but none match      → nothing in the estate carries this
  //                                         risk, so there is genuinely nothing
  //                                         that could cross. The boundary holds.
  //
  // The second case is a real result: "no release in production is deprecated"
  // is a boundary holding, not a failure to check. Reporting it as `unknown`
  // would train people to ignore the state that actually matters.
  if (sourceUrns.length === 0 || targetUrns.length === 0) {
    const emptySide = sourceUrns.length === 0 ? boundary.source : boundary.target;
    let population = 0;
    try {
      population = await store.countEntitiesOfKind(emptySide.kind, queryOptions);
    } catch (error) {
      return unknown(describeFailure(error, "checking whether any entities exist"));
    }

    if (population === 0) {
      // Phrased as a refusal rather than a fault, because that is what it is.
      // Tavik could report this rule as safe — there is nothing to find, after
      // all — and it would look better on the dashboard. It says `unknown`
      // instead, because "we never looked" and "we looked and it's clean" are
      // different facts, and treating them the same is the worst thing a
      // security tool can do.
      const kind = KIND_DESCRIPTIONS[emptySide.kind];
      return unknown(
        `Tavik won't guess. It has no ${kind.plural} to look at yet, so it can't ` +
          `say whether this rule holds — and reporting "safe" on something it ` +
          `never checked would be a lie. ${kind.feed} and this rule starts answering.`,
        sourceUrns.length,
        targetUrns.length,
      );
    }

    return {
      boundaryId: boundary.id,
      status: "verified",
      verifiedAt: now(),
      paths: [],
      truncated: false,
      sourceCount: sourceUrns.length,
      targetCount: targetUrns.length,
      elapsedMs: now() - startedAt,
    };
  }

  // Ask for one more path than will be shown. If that extra path comes back,
  // the result is a sample rather than the whole picture, and the UI has to say
  // so — see BoundaryVerification.truncated.
  const cypher = store.buildPathQuery(boundary, sourceUrns, targetUrns, pathLimit + 1);

  let rows: readonly Record<string, unknown>[];
  let elapsedMs: number;
  try {
    const result = await client.query(cypher, queryOptions);
    rows = result.rows;
    elapsedMs = result.elapsedMs;
  } catch (error) {
    return unknown(
      describeFailure(error, "asking HydraDB for reachable paths"),
      sourceUrns.length,
      targetUrns.length,
    );
  }

  const paths: ReachabilityPath[] = [];
  for (const row of rows) {
    const path = parsePath(row.path);
    if (path === null) {
      // Rows came back but one could not be read as a path. That is a contract
      // mismatch, not an absence of violations, and must not read as verified.
      return unknown(
        `HydraDB returned ${rows.length} row(s) for the path query, but one could not ` +
          `be interpreted as a path. The response contract has probably changed — run ` +
          `\`npm run hydra:probe\` and update the path parser. Refusing to report this ` +
          `boundary as verified.`,
        sourceUrns.length,
        targetUrns.length,
      );
    }
    paths.push(path);
  }

  const truncated = paths.length > pathLimit;

  return {
    boundaryId: boundary.id,
    status: paths.length > 0 ? "violated" : "verified",
    verifiedAt: now(),
    // Drop the probe path used to detect truncation, so callers never see one
    // more than they asked for.
    paths: truncated ? paths.slice(0, pathLimit) : paths,
    truncated,
    sourceCount: sourceUrns.length,
    targetCount: targetUrns.length,
    elapsedMs,
  };
}

/** Verify many boundaries. Independent, so failures do not cascade. */
export async function verifyAll(
  store: GraphStore,
  client: HydraClient,
  boundaries: readonly SecurityBoundary[],
  options: VerifyOptions = {},
): Promise<BoundaryVerification[]> {
  return Promise.all(
    boundaries.map((boundary) => verifyBoundary(store, client, boundary, options)),
  );
}

// ── Path parsing ────────────────────────────────────────────────────────────

function isHydraPath(value: unknown): value is HydraPath {
  if (typeof value !== "object" || value === null) return false;
  const path = value as Partial<HydraPath>;
  return Array.isArray(path.nodes) && Array.isArray(path.relationships);
}

/**
 * Convert a HydraDB path into Tavik's evidence type.
 *
 * The path arrives with full node properties and typed relationships carrying
 * `src`/`dst` ids, so entities are read straight out of it — no second lookup,
 * and no chance of the evidence disagreeing with the traversal that produced it.
 *
 * Returns null rather than guessing when a path cannot be understood; the caller
 * escalates that to `unknown`.
 */
export function parsePath(value: unknown): ReachabilityPath | null {
  if (!isHydraPath(value)) return null;
  if (value.relationships.length === 0) return null;

  const byId = new Map<number, HydraNode>();
  for (const node of value.nodes) byId.set(node.id, node);

  const hops: PathHop[] = [];
  for (const relationship of value.relationships) {
    if (!isRelationKind(relationship.edge_type)) return null;

    const from = toEntity(byId.get(relationship.src));
    const to = toEntity(byId.get(relationship.dst));
    if (!from || !to) return null;

    hops.push({
      from,
      relation: relationship.edge_type as RelationKind,
      to,
    });
  }

  return { hops, length: hops.length };
}

function toEntity(node: HydraNode | undefined): Entity | null {
  if (!node) return null;
  const urn = node.properties.urn;
  const kind = node.properties.kind;
  if (typeof urn !== "string" || typeof kind !== "string") return null;
  if (!isEntityKind(kind)) return null;

  const name = node.properties.name;
  const source = node.properties.source;

  return {
    urn: urn as EntityUrn,
    kind,
    name: typeof name === "string" ? name : urn,
    source: (typeof source === "string" ? source : "demo") as Entity["source"],
  };
}

function describeFailure(error: unknown, whileDoing: string): string {
  if (error instanceof HydraError) {
    return `HydraDB failed while ${whileDoing}: ${error.message}`;
  }
  return `Unexpected failure while ${whileDoing}: ${
    error instanceof Error ? error.message : String(error)
  }`;
}
