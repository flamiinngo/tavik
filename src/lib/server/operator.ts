import "server-only";

import { cookies } from "next/headers";

import {
  can,
  type Permission,
  PermissionError,
  require_,
  type Role,
  ROLES,
} from "@/lib/domain/team";

/**
 * Who is using Tavik right now.
 *
 * The product's safety model is that a human approves every irreversible
 * change. That only means something if the record names a specific person —
 * "someone approved this" is not an audit trail, and until now every entry said
 * "Local operator", which is the same thing wearing a name badge.
 *
 * Identity is a signed-in-by-declaration cookie, not authentication. Tavik runs
 * as one local workspace, so there is nobody to authenticate *against*; what
 * matters here is attribution, and pretending otherwise would be worse than
 * being clear about it. The interface says as much rather than implying a
 * security boundary that does not exist.
 */

const COOKIE = "tavik_operator";
const MAX_AGE = 60 * 60 * 24 * 365;

export interface Operator {
  readonly name: string;
  readonly role: Role;
  /** False when nobody has said who they are, so the UI can ask. */
  readonly identified: boolean;
}

const ANONYMOUS: Operator = {
  name: "Unnamed operator",
  // An unidentified person gets the most capable role rather than the least.
  //
  // That looks backwards for a security product, and would be wrong if this
  // were authentication. It is not: a single local workspace with no sign-in
  // has no way to tell a stranger from the owner, so a restrictive default
  // would only lock the actual owner out of their own tool while stopping
  // nobody. The honest position is full capability plus an unmistakable prompt
  // to say who you are, so the audit trail becomes useful.
  role: "owner",
  identified: false,
};

/** Read the current operator from the request. */
export async function currentOperator(): Promise<Operator> {
  try {
    const store = await cookies();
    const raw = store.get(COOKIE)?.value;
    if (!raw) return ANONYMOUS;

    const parsed = JSON.parse(decodeURIComponent(raw)) as {
      name?: unknown;
      role?: unknown;
    };

    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (name.length === 0) return ANONYMOUS;

    const role = ROLES.includes(parsed.role as Role) ? (parsed.role as Role) : "engineer";

    return { name: name.slice(0, 60), role, identified: true };
  } catch {
    // A malformed cookie must not lock someone out of their own workspace.
    return ANONYMOUS;
  }
}

/** Record who is using Tavik. */
export async function setOperator(name: string, role: Role): Promise<void> {
  const store = await cookies();
  store.set(
    COOKIE,
    encodeURIComponent(JSON.stringify({ name: name.trim().slice(0, 60), role })),
    {
      maxAge: MAX_AGE,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    },
  );
}

export async function clearOperator(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/**
 * Check a permission for the current operator, throwing if it is missing.
 *
 * Called by server actions, not by the interface. Hiding a button is a courtesy
 * to the person using the product; it is not a control, because a server action
 * is a public endpoint whether or not anything on screen points at it.
 */
export async function requirePermission(permission: Permission): Promise<Operator> {
  const operator = await currentOperator();
  require_(operator.role, permission);
  return operator;
}

export type Gate =
  | { readonly allowed: true; readonly operator: Operator }
  | { readonly allowed: false; readonly reason: string };

/**
 * The same check as `requirePermission`, as a value rather than an exception.
 *
 * Server actions return a result object that the screen renders; a thrown error
 * there becomes a blank error page, which tells someone far less than a sentence
 * saying what their role cannot do and who can do it for them.
 */
export async function gate(permission: Permission): Promise<Gate> {
  const operator = await currentOperator();
  if (!can(operator.role, permission)) {
    return { allowed: false, reason: new PermissionError(permission, operator.role).message };
  }
  return { allowed: true, operator };
}
