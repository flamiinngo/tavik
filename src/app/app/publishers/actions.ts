"use server";

import { revalidatePath } from "next/cache";

import { entityUrn, type EntityUrn } from "@/lib/domain/entities";
import { event } from "@/lib/engine/change-log";
import { gate } from "@/lib/server/operator";
import { invalidateSecurityState, tavik } from "@/lib/server/tavik";

/**
 * Deciding who you trust.
 *
 * The other way to close a rule. Removing a dependency is one answer to
 * "somebody outside our list can reach production"; the other is looking at the
 * account and deciding it belongs on the list. Both are real decisions teams
 * make, and a product that only offers the first is telling half the truth.
 *
 * Trust is this workspace's own policy and nothing more. Approving an account
 * says "we have looked, and we accept this"; it says nothing about the person,
 * and neither does declining to.
 */

export type TrustLevel = "trusted" | "untrusted" | "quarantined";

export interface TrustResult {
  readonly ok: boolean;
  readonly message: string;
  readonly rulesAffected?: number;
}

export async function setTrust(
  publisher: string,
  trust: TrustLevel,
): Promise<TrustResult> {
  const allowed = await gate("manageTrust");
  if (!allowed.allowed) return { ok: false, message: allowed.reason };

  const name = publisher.trim();
  if (name.length === 0) {
    return { ok: false, message: "No publisher given." };
  }

  try {
    const { store } = tavik();
    const urn = entityUrn("Maintainer", name) as EntityUrn;

    const existing = await store.getEntity(urn);
    if (!existing) {
      return { ok: false, message: `${name} isn't in your graph.` };
    }

    const before = String(
      (existing.properties as Record<string, unknown> | undefined)?.trust ?? "untrusted",
    );
    await store.setTrust(urn, trust);
    await recordTrustChange(allowed.operator.name, name, before, trust);

    // The held verdict is now out of date. Clearing it before the page
    // cache means the next read re-checks against what just changed.
    invalidateSecurityState();
    revalidatePath("/app");
    revalidatePath("/app/publishers");
    revalidatePath("/app/boundaries");

    return {
      ok: true,
      message:
        trust === "trusted"
          ? `${name} is on your approved list. Rules will be re-checked.`
          : trust === "quarantined"
            ? `${name} is under review. Their code is treated as paused until you finish looking.`
            : `${name} is back to unapproved.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Couldn't update that publisher.",
    };
  }
}

/**
 * Write the decision down, with the name of whoever made it.
 *
 * Approving a publisher can turn a red rule green without a single line of code
 * changing, which makes it the easiest way to make a problem disappear without
 * solving it. That is a legitimate thing to do — teams accept risk deliberately
 * all the time — but only if the record says who accepted it and what it was
 * before. A green rule with no trace of how it got there is worth nothing in a
 * review.
 */
async function recordTrustChange(
  operatorName: string,
  publisher: string,
  from: string,
  to: TrustLevel,
): Promise<void> {
  // The decision has already been applied. Failing to write history must not
  // report a completed change as failed.
  try {
    const { changeLog } = tavik();
    await changeLog.append([
      event("trust.changed", Date.now(), {
        actor: { kind: "user", id: operatorName, name: operatorName },
        // States the capability fact and nothing more. Never a claim about the
        // person behind the account.
        summary:
          to === "trusted"
            ? `${operatorName} added ${publisher} to the approved publisher list.`
            : to === "quarantined"
              ? `${operatorName} put ${publisher} under review.`
              : `${operatorName} removed ${publisher} from the approved publisher list.`,
        detail: { kind: "trust_change", publisher, from, to },
      }),
    ]);
  } catch {
    // Intentionally swallowed — see above.
  }
}

/** Approve several at once — useful when a whole org's accounts are yours. */
export async function setTrustBulk(
  publishers: readonly string[],
  trust: TrustLevel,
): Promise<TrustResult> {
  const allowed = await gate("manageTrust");
  if (!allowed.allowed) return { ok: false, message: allowed.reason };

  let updated = 0;
  for (const publisher of publishers) {
    const result = await setTrust(publisher, trust);
    if (result.ok) updated++;
  }
  return {
    ok: updated > 0,
    message: `${updated} publisher${updated === 1 ? "" : "s"} updated.`,
  };
}
