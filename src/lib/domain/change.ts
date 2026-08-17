/**
 * The change log — what Tavik did, what it observed, and when.
 *
 * This is what makes the timeline and the "what changed?" screens honest. Every
 * entry is produced by something that actually happened: an ingestion that ran,
 * a verification that returned a result, a remediation a human approved. Nothing
 * here is generated to make a screen look busy.
 *
 * It is append-only. A boundary's history is evidence — for an incident review,
 * for an auditor, for the engineer asking "was this true at 09:00?" — and
 * evidence that can be edited after the fact is not evidence.
 *
 * The most product-critical entry is `boundary.status_changed`. Knowing a
 * boundary is red is useful; knowing the exact moment it stopped being green,
 * and which path appeared at that moment, is what turns an alert into an
 * investigation.
 */

import type { BoundaryStatus } from "./boundary";
import type { ReachabilityPath } from "./entities";

export type ChangeEventType =
  /** An ingestion run finished and wrote state. */
  | "ingestion.completed"
  /** A boundary was evaluated. Recorded every run, including no-change runs. */
  | "boundary.verified"
  /** A boundary's status differs from its previous verification. */
  | "boundary.status_changed"
  /** Tavik prepared a remediation for a human to review. */
  | "remediation.proposed"
  /** A human approved a remediation and it was applied. */
  | "remediation.applied"
  /** A remediation was reviewed and rejected. */
  | "remediation.rejected";

/**
 * Who caused an entry.
 *
 * Kept explicit because the product's trust model depends on the distinction:
 * Tavik observes and proposes, humans approve. An audit trail that cannot tell
 * the two apart is not much of an audit trail.
 */
export type ChangeActor =
  | { readonly kind: "tavik" }
  | { readonly kind: "user"; readonly id: string; readonly name: string }
  | { readonly kind: "system"; readonly reason: string };

export interface ChangeEvent {
  readonly id: string;
  readonly type: ChangeEventType;
  /** Epoch milliseconds. */
  readonly at: number;
  readonly actor: ChangeActor;
  /** One line, in Tavik's voice. Calm, specific, never theatrical. */
  readonly summary: string;
  readonly boundaryId?: string;
  readonly environmentId?: string;
  /** Type-specific payload. */
  readonly detail?: ChangeDetail;
}

export type ChangeDetail =
  | IngestionDetail
  | VerificationDetail
  | StatusChangeDetail
  | RemediationDetail;

export interface IngestionDetail {
  readonly kind: "ingestion";
  readonly entitiesWritten: number;
  readonly relationsWritten: number;
  readonly packagesResolved: number;
  readonly maintainersFound: number;
  /** Packages the registry could not answer for. Surfaced, never hidden. */
  readonly failures: number;
  readonly elapsedMs: number;
}

export interface VerificationDetail {
  readonly kind: "verification";
  readonly status: BoundaryStatus;
  readonly pathCount: number;
  readonly sourceCount: number;
  readonly targetCount: number;
  readonly elapsedMs: number;
  readonly failureReason?: string;
  /**
   * The paths found, stored so the next run can diff against them.
   *
   * Without this, "what changed?" could only compare statuses — it could say a
   * boundary went red but not which path made it red, which is the whole point.
   * Recomputing the previous state instead is not an option: the graph has moved
   * on, and the past is exactly what is being asked about.
   */
  readonly paths: readonly PathSummary[];
}

export interface StatusChangeDetail {
  readonly kind: "status_change";
  readonly from: BoundaryStatus;
  readonly to: BoundaryStatus;
  /**
   * Paths present now that were not present at the previous verification.
   *
   * This is the root-cause answer. When a boundary goes red, the newly appeared
   * path is what actually broke it — as distinct from the paths that were
   * already there and are merely still there.
   */
  readonly appearedPaths: readonly PathSummary[];
  /** Paths that were present before and are now gone, e.g. after a remediation. */
  readonly resolvedPaths: readonly PathSummary[];
}

export interface RemediationDetail {
  readonly kind: "remediation";
  readonly relationFrom: string;
  readonly relationTo: string;
  readonly relationKind: string;
  /** Entities that lose reachability if this is applied. */
  readonly impactedUrns: readonly string[];
}

/** A path reduced to a comparable, storable form. */
export interface PathSummary {
  /** Stable identity for the path, so two verifications can be compared. */
  readonly signature: string;
  readonly hops: readonly {
    readonly from: string;
    readonly relation: string;
    readonly to: string;
  }[];
  readonly length: number;
}

/**
 * Reduce a path to a comparable summary.
 *
 * The signature is the full ordered chain rather than just its endpoints,
 * because two different routes between the same pair are genuinely different
 * findings: one may be remediable and the other not.
 */
export function summarisePath(path: ReachabilityPath): PathSummary {
  const hops = path.hops.map((hop) => ({
    from: String(hop.from.urn),
    relation: hop.relation,
    to: String(hop.to.urn),
  }));

  return {
    signature: hops.map((hop) => `${hop.from}|${hop.relation}|${hop.to}`).join(">"),
    hops,
    length: path.length,
  };
}

/**
 * Compare two sets of paths.
 *
 * Used to answer "what changed?" between consecutive verifications of the same
 * boundary.
 */
export function diffPaths(
  before: readonly ReachabilityPath[],
  after: readonly ReachabilityPath[],
): { appeared: PathSummary[]; resolved: PathSummary[] } {
  return diffPathSummaries(before.map(summarisePath), after.map(summarisePath));
}

/**
 * Compare two sets of already-summarised paths.
 *
 * The change log stores summaries rather than full paths, so a comparison
 * against a previous run necessarily happens at this level.
 */
export function diffPathSummaries(
  before: readonly PathSummary[],
  after: readonly PathSummary[],
): { appeared: PathSummary[]; resolved: PathSummary[] } {
  const beforeSignatures = new Set(before.map((p) => p.signature));
  const afterSignatures = new Set(after.map((p) => p.signature));

  return {
    appeared: after.filter((p) => !beforeSignatures.has(p.signature)),
    resolved: before.filter((p) => !afterSignatures.has(p.signature)),
  };
}

/**
 * Tavik's phrasing for a status transition.
 *
 * Deliberately flat. The product's credibility rests on sounding like a senior
 * engineer stating a fact, not like software trying to alarm someone. No
 * exclamation marks, no urgency adjectives — the status colour already carries
 * the severity.
 */
export function describeStatusChange(
  boundaryName: string,
  from: BoundaryStatus,
  to: BoundaryStatus,
  appearedPaths: number,
): string {
  if (to === "violated" && from === "verified") {
    return appearedPaths === 1
      ? `${boundaryName} is violated. A new path made the target reachable.`
      : `${boundaryName} is violated. ${appearedPaths} new paths made the target reachable.`;
  }
  if (to === "verified" && from === "violated") {
    return `${boundaryName} is restored. No path remains.`;
  }
  if (to === "unknown") {
    return `${boundaryName} could not be evaluated. Its status is unknown, not verified.`;
  }
  if (from === "unknown" && to === "verified") {
    return `${boundaryName} is verified. Evaluation succeeded for the first time.`;
  }
  return `${boundaryName} changed from ${from} to ${to}.`;
}
