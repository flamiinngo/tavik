/**
 * Security boundaries — the thing Tavik exists to verify.
 *
 * A boundary is a negative claim: "these things must never be able to reach
 * those things." That framing is the product's whole differentiation. Scanners
 * enumerate what *is* wrong and leave you to judge severity. A boundary is
 * declared once by a human who understands the business, and from then on it is
 * either true or it is not — a binary a machine can check continuously and prove
 * with a concrete path.
 *
 * Deliberately, a boundary has no severity score. If it is violated, it is
 * violated.
 */

import type { EntityKind, EntityUrn, ReachabilityPath, RelationKind } from "./entities";
import { TRAVERSABLE_RELATIONS } from "./entities";

/**
 * Verification status.
 *
 * `unknown` is load-bearing and must never be collapsed into `verified`. If
 * Tavik could not read the graph, it does not know the boundary holds, and
 * saying otherwise would be the worst failure mode this product has.
 */
export type BoundaryStatus =
  /** No path exists. Proven at the stated time, against the stated state. */
  | "verified"
  /** At least one path exists. Evidence attached. */
  | "violated"
  /** A violation is being triaged, or a remediation is in flight. */
  | "investigating"
  /** Not yet evaluated, or evaluation failed. Never assume safety here. */
  | "unknown";

/**
 * Selects a set of entities by an exact property match.
 *
 * Intentionally narrow. HydraDB's Cypher subset rejects `IN`, `CONTAINS` and
 * `IS NULL` in `WHERE`, so predicates are equality-only; anything richer would
 * have to be evaluated in application code, which would move security decisions
 * out of the deterministic layer. Sets of values are handled natively by
 * `algo.MSpaths`, which accepts arrays of source and target values directly.
 */
export interface EntitySelector {
  readonly kind: EntityKind;
  /** Property to match on. Validated as a Cypher identifier before use. */
  readonly property: "urn" | "name" | "tag" | "environment" | "trust";
  readonly value: string;
  /** Human description, shown in the UI in place of the raw predicate. */
  readonly description: string;
}

export interface SecurityBoundary {
  readonly id: string;
  /** Short name, e.g. "Production Isolation". */
  readonly name: string;
  /**
   * The claim, in the words the team would actually use.
   * e.g. "Production customer data must never be reachable from CI."
   */
  readonly statement: string;
  /** The side that must not be able to reach. */
  readonly source: EntitySelector;
  /** The side that must not be reached. */
  readonly target: EntitySelector;
  /**
   * Relationship types a path may traverse. Narrowing this is how a team says
   * "we care about assumed-role chains, not network routes."
   */
  readonly relations: readonly RelationKind[];
  /**
   * Maximum path length to consider.
   *
   * HydraDB rejects unbounded traversal outright (`*` and `*1..` are refused at
   * parse time) because cost would be unpredictable, so a bound is required
   * rather than optional. It is also honest: Tavik reports what it checked.
   */
  readonly maxHops: number;
  readonly createdAt: number;
  readonly environmentId: string;
}

/** The outcome of evaluating one boundary against the graph. */
export interface BoundaryVerification {
  readonly boundaryId: string;
  readonly status: BoundaryStatus;
  /** When this verification ran, epoch ms. */
  readonly verifiedAt: number;
  /**
   * Every violating path found, up to the query's path limit. Empty when
   * verified.
   */
  readonly paths: readonly ReachabilityPath[];
  /** How many source entities the selector resolved to. */
  readonly sourceCount: number;
  readonly targetCount: number;
  /** Wall-clock time HydraDB spent on the traversal. */
  readonly elapsedMs: number;
  /**
   * Populated when `status` is `unknown`, explaining why verification could not
   * be completed. Surfaced verbatim in the UI — never replaced with a generic
   * failure message.
   */
  readonly failureReason?: string;
}

export const DEFAULT_MAX_HOPS = 8;

/**
 * Guard against a boundary that would be expensive or meaningless to evaluate.
 * Returns the problems found; an empty array means the boundary is well-formed.
 */
export function validateBoundary(boundary: SecurityBoundary): string[] {
  const problems: string[] = [];

  if (boundary.name.trim().length === 0) {
    problems.push("A boundary needs a name.");
  }
  if (boundary.statement.trim().length === 0) {
    problems.push("A boundary needs a statement describing what must never happen.");
  }
  if (boundary.relations.length === 0) {
    problems.push(
      "A boundary must traverse at least one relationship type, otherwise no path can ever exist and it would always report verified.",
    );
  }

  const nonTraversable = boundary.relations.filter(
    (relation) => !TRAVERSABLE_RELATIONS.includes(relation),
  );
  if (nonTraversable.length > 0) {
    problems.push(
      `These relationships describe structure rather than capability and cannot grant reach: ${nonTraversable.join(", ")}.`,
    );
  }

  if (!Number.isInteger(boundary.maxHops) || boundary.maxHops < 1) {
    problems.push("maxHops must be a positive integer.");
  } else if (boundary.maxHops > 16) {
    problems.push(
      "maxHops above 16 is rejected. HydraDB requires a bounded traversal, and beyond this depth the result is too slow to be useful for continuous verification.",
    );
  }

  if (
    boundary.source.kind === boundary.target.kind &&
    boundary.source.property === boundary.target.property &&
    boundary.source.value === boundary.target.value
  ) {
    problems.push(
      "Source and target select the same entities, so the boundary is trivially violated.",
    );
  }

  return problems;
}

/** Map a status onto the product's four-state colour language. */
export function statusTone(
  status: BoundaryStatus,
): "success" | "danger" | "warning" | "neutral" {
  switch (status) {
    case "verified":
      return "success";
    case "violated":
      return "danger";
    case "investigating":
      return "warning";
    case "unknown":
      return "neutral";
  }
}

/** Sort order for dashboards: what needs attention first. */
export const STATUS_PRIORITY: Record<BoundaryStatus, number> = {
  violated: 0,
  investigating: 1,
  unknown: 2,
  verified: 3,
};

export interface BoundaryWithVerification {
  readonly boundary: SecurityBoundary;
  readonly verification: BoundaryVerification | null;
}

export function sortByUrgency(
  items: readonly BoundaryWithVerification[],
): BoundaryWithVerification[] {
  return [...items].sort((a, b) => {
    const aStatus = a.verification?.status ?? "unknown";
    const bStatus = b.verification?.status ?? "unknown";
    const delta = STATUS_PRIORITY[aStatus] - STATUS_PRIORITY[bStatus];
    return delta !== 0 ? delta : a.boundary.name.localeCompare(b.boundary.name);
  });
}

/** Entity urns referenced by a verification, for blast-radius rendering. */
export function affectedUrns(
  verification: BoundaryVerification,
): readonly EntityUrn[] {
  const seen = new Set<EntityUrn>();
  for (const path of verification.paths) {
    for (const hop of path.hops) {
      seen.add(hop.from.urn);
      seen.add(hop.to.urn);
    }
  }
  return [...seen];
}
