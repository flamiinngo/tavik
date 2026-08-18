"use server";

import { revalidatePath } from "next/cache";

import type { BoundaryStatus } from "@/lib/domain/boundary";
import { event, ChangeLog } from "@/lib/engine/change-log";
import { proposeRemediations } from "@/lib/engine/remediation";
import { verifyBoundary } from "@/lib/engine/verify";
import type { RelationKind } from "@/lib/domain/entities";
import { isRelationKind, type EntityUrn } from "@/lib/domain/entities";
import { findBoundary, tavik } from "@/lib/server/tavik";

/**
 * Apply a remediation, then prove it worked.
 *
 * The sequence is the product's core claim, so it is worth stating plainly:
 *
 *   1. verify   — capture the state before, so the change is attributable
 *   2. delete   — a real mutation of the real graph, not a UI flag
 *   3. verify   — the *same* query that found the problem, run again
 *   4. record   — both the action and its proven outcome
 *
 * Step 3 is what separates this from software that says "fixed". Restoration is
 * re-computed, never assumed.
 */

export interface RemediationResult {
  readonly ok: boolean;
  readonly statusBefore: BoundaryStatus;
  readonly statusAfter: BoundaryStatus;
  readonly routesBefore: number;
  readonly routesAfter: number;
  readonly elapsedMs: number;
  readonly message: string;
}

export async function applyRemediation(
  boundaryId: string,
  from: string,
  to: string,
  relation: string,
): Promise<RemediationResult> {
  const boundary = await findBoundary(boundaryId);

  const failed = (message: string): RemediationResult => ({
    ok: false,
    statusBefore: "unknown",
    statusAfter: "unknown",
    routesBefore: 0,
    routesAfter: 0,
    elapsedMs: 0,
    message,
  });

  if (!boundary) return failed(`No boundary called ${boundaryId}.`);

  // The relationship type comes in over the wire, so it is checked against the
  // model rather than trusted. An unrecognised type would otherwise be
  // interpolated into a Cypher statement as a label.
  if (!isRelationKind(relation)) {
    return failed(`${relation} is not a relationship Tavik knows about.`);
  }

  const { client, store, changeLog } = tavik();
  const startedAt = Date.now();

  try {
    // 1. Before.
    const before = await verifyBoundary(store, client, boundary);

    // Only act on a change Tavik itself would have proposed. A server action is
    // a public endpoint, so without this check a crafted request could delete
    // any relationship in the graph — the remediation button would become an
    // arbitrary-delete API.
    const permitted = proposeRemediations(boundary, before, 8).some(
      (proposal) =>
        proposal.from === from &&
        proposal.to === to &&
        proposal.relation === relation,
    );

    if (!permitted) {
      return failed(
        "That change is not one of Tavik's current proposals for this boundary. " +
          "Re-check the boundary and try again.",
      );
    }

    // 2. Apply, for real.
    await store.deleteRelation(from as EntityUrn, to as EntityUrn, relation as RelationKind);

    // 3. Prove it, with the same query that found the problem.
    const after = await verifyBoundary(store, client, boundary);

    // 4. Record what happened and what it achieved.
    await recordOutcome(changeLog, boundaryId, boundary.name, from, to, relation, before, after);

    revalidatePath(`/app/boundaries/${boundaryId}`);
    revalidatePath("/app");

    return {
      ok: true,
      statusBefore: before.status,
      statusAfter: after.status,
      routesBefore: before.paths.length,
      routesAfter: after.paths.length,
      elapsedMs: Date.now() - startedAt,
      message:
        after.status === "verified"
          ? "Boundary restored. No route remains."
          : `${before.paths.length - after.paths.length} route(s) removed. ${after.paths.length} still remain.`,
    };
  } catch (error) {
    return failed(
      error instanceof Error ? error.message : "The remediation could not be applied.",
    );
  }
}

async function recordOutcome(
  changeLog: ChangeLog,
  boundaryId: string,
  boundaryName: string,
  from: string,
  to: string,
  relation: string,
  before: Awaited<ReturnType<typeof verifyBoundary>>,
  after: Awaited<ReturnType<typeof verifyBoundary>>,
): Promise<void> {
  // History is secondary to the outcome: a failure to write the audit entry
  // must not make a successful, already-applied remediation look like it failed.
  try {
    await changeLog.append([
      event("remediation.applied", Date.now(), {
        // A human pressed the button. The audit trail has to be able to tell
        // that apart from something Tavik did on its own.
        actor: { kind: "user", id: "local", name: "Local operator" },
        summary: `Applied remediation to ${boundaryName}: removed ${relation} from ${shortName(from)} to ${shortName(to)}.`,
        boundaryId,
        detail: {
          kind: "remediation",
          relationFrom: from,
          relationTo: to,
          relationKind: relation,
          impactedUrns: [],
        },
      }),
    ]);

    const rule = await findBoundary(boundaryId);
    if (rule) {
      await changeLog.recordVerification(rule, after, {
        status: before.status,
        paths: [],
      });
    }
  } catch {
    // Intentionally swallowed — see above.
  }
}

function shortName(urn: string): string {
  return urn.split(":").slice(2).join(":") || urn;
}
