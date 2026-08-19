/**
 * People, and what they are allowed to do.
 *
 * Tavik's safety model is that a human approves every irreversible change. That
 * only means something if "a human" is a specific, named person and the record
 * says which one — otherwise the audit trail reads "someone approved this",
 * which is not an audit trail.
 *
 * Four roles, because there are genuinely four different relationships people
 * have with this product: someone who owns the workspace, someone who
 * administers it, someone who does the security work, and someone who needs to
 * see the state without being able to change it.
 */

export const ROLES = ["owner", "admin", "engineer", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export interface Member {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

/**
 * What each role can do.
 *
 * Deliberately explicit rather than a hierarchy of levels. "An engineer can do
 * everything a viewer can, plus more" is true here, but encoding it as a
 * comparison invites a future permission that does not follow the ladder to be
 * shoehorned into it. A table stays honest as it grows.
 */
export const PERMISSIONS = {
  /** See the state: rules, routes, the graph, history. */
  read: ["owner", "admin", "engineer", "viewer"],
  /** Add data: scan a project, watch a repository. */
  scan: ["owner", "admin", "engineer"],
  /** Write and delete rules. */
  manageRules: ["owner", "admin", "engineer"],
  /** Approve a publisher, or put one under review. */
  manageTrust: ["owner", "admin", "engineer"],
  /**
   * Apply a remediation — the only genuinely irreversible action, since it
   * removes a real relationship from the graph.
   */
  remediate: ["owner", "admin", "engineer"],
  /**
   * Reset or delete the workspace itself.
   *
   * There is deliberately no "manage other people's roles" permission to sit
   * beside this. Identity here is self-declared — someone can set their own role
   * on the Team screen — so a control that claimed to change *your* role would
   * be enforcing nothing, and a permission table that lists a power nobody
   * actually has is the same failure as a settings page claiming an integration
   * that was never built.
   */
  manageWorkspace: ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Human-readable, for the team screen. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Everything, including transferring or deleting the workspace.",
  admin: "Everything except resetting or deleting the workspace itself.",
  engineer: "Scan, write rules, approve publishers, and apply fixes.",
  viewer: "See everything. Cannot change anything.",
};

/**
 * What each permission lets someone do, in words.
 *
 * Written out rather than derived from the key by splitting camelCase, which
 * produced "a viewer cannot manage trust" — the name of an internal concept
 * handed to someone who never asked to learn it. The refusal message is the only
 * thing they see, so it says what they were trying to do.
 */
export const PERMISSION_LABELS: Record<Permission, string> = {
  read: "see rules, routes, and history",
  scan: "scan a project or watch a repository",
  manageRules: "write or delete rules",
  manageTrust: "approve a publisher or put one under review",
  remediate: "apply a fix to the graph",
  manageWorkspace: "reset or delete the workspace",
};

export class PermissionError extends Error {
  constructor(
    readonly permission: Permission,
    readonly role: Role,
  ) {
    // Says what was refused and who can do it instead. A bare "not allowed"
    // leaves someone stuck with no idea what to do next.
    const canInstead = PERMISSIONS[permission][0];
    super(
      `A ${role} can't ${PERMISSION_LABELS[permission]}. ` +
        `Ask ${canInstead === "owner" ? "an" : "a"} ${canInstead} to do it, or change your role on the Team screen.`,
    );
    this.name = "PermissionError";
  }
}

/**
 * Check a permission, throwing if it is missing.
 *
 * Server actions call this, not the interface. Hiding a button is a courtesy to
 * the person using the product; it is not a security control, because a server
 * action is a public endpoint whether or not anything on screen points at it.
 */
export function require_(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new PermissionError(permission, role);
}
