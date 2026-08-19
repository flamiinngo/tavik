import { describe, expect, it } from "vitest";

import {
  can,
  PERMISSIONS,
  PermissionError,
  require_,
  ROLE_DESCRIPTIONS,
  ROLES,
  type Permission,
  type Role,
} from "./team";

/**
 * The permission table is the only thing standing between a viewer and a
 * remediation, so it is worth testing as data rather than trusting it to read
 * correctly. Most of these assert properties of the table itself — the kind of
 * thing that silently stops being true when a permission is added later.
 */

const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

describe("roles", () => {
  it("describes every role, so the team screen cannot render a blank cell", () => {
    for (const role of ROLES) {
      expect(ROLE_DESCRIPTIONS[role]).toBeTruthy();
    }
  });

  it("grants every permission to at least one role", () => {
    // A permission nobody holds is a feature nobody can use — almost certainly a
    // typo in the table rather than a deliberate lockout.
    for (const permission of ALL_PERMISSIONS) {
      expect(PERMISSIONS[permission].length).toBeGreaterThan(0);
    }
  });

  it("lists only real roles in the table", () => {
    for (const permission of ALL_PERMISSIONS) {
      for (const role of PERMISSIONS[permission]) {
        expect(ROLES).toContain(role);
      }
    }
  });

  it("gives the owner everything", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(can("owner", permission)).toBe(true);
    }
  });
});

describe("viewer", () => {
  it("can read", () => {
    expect(can("viewer", "read")).toBe(true);
  });

  it("cannot change anything at all", () => {
    // Stated as "everything except read" rather than as a list, so a new
    // write-shaped permission is caught here instead of quietly defaulting open.
    for (const permission of ALL_PERMISSIONS) {
      if (permission === "read") continue;
      expect(can("viewer", permission)).toBe(false);
    }
  });

  it("cannot apply a remediation — the one irreversible action", () => {
    expect(() => require_("viewer", "remediate")).toThrow(PermissionError);
  });
});

describe("engineer", () => {
  it("can do the security work", () => {
    for (const permission of ["scan", "manageRules", "manageTrust", "remediate"] as const) {
      expect(can("engineer", permission)).toBe(true);
    }
  });

  it("cannot reset the workspace", () => {
    expect(can("engineer", "manageWorkspace")).toBe(false);
  });
});

describe("admin", () => {
  it("can do the security work but not reset the workspace", () => {
    expect(can("admin", "remediate")).toBe(true);
    expect(can("admin", "manageWorkspace")).toBe(false);
  });
});

describe("the table as a whole", () => {
  it("has an action behind every permission it claims", () => {
    // Guards against a permission surviving in the table after whatever it
    // guarded was removed. The Team screen renders this table verbatim, so a
    // stale row tells a team they have a control that does not exist.
    const used = new Set<Permission>([
      "read",
      "scan",
      "manageRules",
      "manageTrust",
      "remediate",
      "manageWorkspace",
    ]);

    expect(new Set(ALL_PERMISSIONS)).toEqual(used);
  });
});

describe("require_", () => {
  it("passes silently when the role holds the permission", () => {
    expect(() => require_("engineer", "remediate")).not.toThrow();
  });

  it("says what was refused and who can do it instead", () => {
    // The message reaches the person as a sentence in the interface, so it has
    // to be useful on its own — a bare "forbidden" leaves them stuck.
    try {
      require_("viewer", "manageWorkspace");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionError);
      const message = (error as PermissionError).message;
      expect(message).toContain("viewer");
      expect(message).toContain("owner");
    }
  });

  it("carries the role and permission for a caller that wants to branch", () => {
    try {
      require_("viewer", "scan");
      throw new Error("should have thrown");
    } catch (error) {
      const failure = error as PermissionError;
      expect(failure.role satisfies Role).toBe("viewer");
      expect(failure.permission satisfies Permission).toBe("scan");
    }
  });
});
