"use server";

import { revalidatePath } from "next/cache";

import { entityUrn, type EntityUrn } from "@/lib/domain/entities";
import { tavik } from "@/lib/server/tavik";

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

    await store.setTrust(urn, trust);

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

/** Approve several at once — useful when a whole org's accounts are yours. */
export async function setTrustBulk(
  publishers: readonly string[],
  trust: TrustLevel,
): Promise<TrustResult> {
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
