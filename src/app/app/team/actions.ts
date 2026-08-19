"use server";

import { revalidatePath } from "next/cache";

import { ROLES, type Role } from "@/lib/domain/team";
import { clearOperator, setOperator } from "@/lib/server/operator";

/**
 * Saying who you are.
 *
 * Not a login, and the screen says so. Tavik runs as one workspace with no
 * account system to authenticate against, so a password box here would be
 * theatre — it would imply a security boundary that does not exist, which is the
 * same class of dishonesty as reporting an unchecked rule as safe.
 *
 * What it does buy is real: every approval from here on is recorded against a
 * named person instead of "Local operator", and the work log becomes something
 * you could take into a review.
 */

export interface IdentifyResult {
  readonly ok: boolean;
  readonly message: string;
}

export async function identify(formData: FormData): Promise<IdentifyResult> {
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "");

  if (name.length === 0) {
    return { ok: false, message: "Put in a name — that is the whole point of it." };
  }

  if (name.length > 60) {
    return { ok: false, message: "Keep it under 60 characters." };
  }

  if (!ROLES.includes(role as Role)) {
    return { ok: false, message: "Pick one of the four roles." };
  }

  await setOperator(name, role as Role);

  // Every screen shows the current operator in the sidebar, and the role decides
  // which controls are offered, so the whole app is stale after this.
  revalidatePath("/app", "layout");

  return {
    ok: true,
    message: `You are signed in as ${name}. Approvals will be recorded under that name.`,
  };
}

export async function signOutOperator(): Promise<IdentifyResult> {
  await clearOperator();
  revalidatePath("/app", "layout");
  return { ok: true, message: "Cleared. Approvals go back to being unattributed." };
}
