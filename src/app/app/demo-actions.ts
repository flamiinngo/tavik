"use server";

import { revalidatePath } from "next/cache";

import { entityUrn, type EntityUrn } from "@/lib/domain/entities";
import { event } from "@/lib/engine/change-log";
import { verifyBoundary } from "@/lib/engine/verify";
import { gate } from "@/lib/server/operator";
import { findBoundary, invalidateSecurityState, tavik } from "@/lib/server/tavik";

/**
 * The demo control.
 *
 * Blocking a publisher is a real decision a security team makes — "we no longer
 * accept code from this account" — and here it is a real mutation of the real
 * graph. Nothing is faked, and nothing short-circuits: the trust label changes,
 * the boundary is re-checked by the same engine with the same query, and the
 * result is whatever the graph actually says.
 *
 * This exists because the product's most important claim is a *transition*, and
 * a transition needs something to move. Waiting for a real publisher to be
 * banned is not a demo. Faking the transition would make the entire product
 * unbelievable. Causing it for real is the only honest option.
 */

export interface DemoResult {
  readonly ok: boolean;
  readonly message: string;
  readonly routes: number;
  readonly status: string;
}

/** Block or unblock a publisher by name, then re-check what it changed. */
export async function setPublisherTrust(
  publisherName: string,
  trust: "quarantined" | "untrusted",
): Promise<DemoResult> {
  const allowed = await gate("manageTrust");
  if (!allowed.allowed) {
    return { ok: false, message: allowed.reason, routes: 0, status: "unknown" };
  }

  const { client, store, changeLog } = tavik();
  const urn = entityUrn("Maintainer", publisherName) as EntityUrn;

  try {
    const existing = await store.getEntity(urn);
    if (!existing) {
      return {
        ok: false,
        message: `No publisher called ${publisherName} in the graph.`,
        routes: 0,
        status: "unknown",
      };
    }

    await store.setTrust(urn, trust);

    // Re-check the boundary this actually affects, with the same engine that
    // reports it everywhere else.
    const boundary = await findBoundary("blocked-publishers");
    const verification = boundary
      ? await verifyBoundary(store, client, boundary)
      : null;

    try {
      await changeLog.append([
        // A trust decision, not a remediation. Nothing was removed from the
        // graph — someone changed this workspace's policy about an account.
        event("trust.changed", Date.now(), {
          actor: {
            kind: "user",
            id: allowed.operator.name,
            name: allowed.operator.name,
          },
          summary:
            trust === "quarantined"
              ? `${publisherName} was placed under review. Their code is quarantined until the review completes.`
              : `Review of ${publisherName} completed. The quarantine was lifted.`,
          boundaryId: "blocked-publishers",
          detail: {
            kind: "trust_change",
            publisher: publisherName,
            from: String(
              (existing.properties as Record<string, unknown> | undefined)?.trust ??
                "untrusted",
            ),
            to: trust,
          },
        }),
      ]);
      if (boundary && verification) {
        await changeLog.recordVerification(boundary, verification, null);
      }
    } catch {
      // History is secondary; the state change already happened.
    }

    // The held verdict is now out of date. Clearing it before the page
    // cache means the next read re-checks against what just changed.
    invalidateSecurityState();
    revalidatePath("/app");
    revalidatePath("/app/boundaries");
    revalidatePath("/app/boundaries/blocked-publishers");

    return {
      ok: true,
      message:
        trust === "quarantined"
          ? `${publisherName} is now under review. Tavik re-checked and found ${verification?.paths.length ?? 0} route(s) their code takes into production.`
          : `Review complete. ${publisherName} is no longer quarantined.`,
      routes: verification?.paths.length ?? 0,
      status: verification?.status ?? "unknown",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The change could not be applied.",
      routes: 0,
      status: "unknown",
    };
  }
}
