import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LockfileError,
  packageNameFromPath,
  parseLockfile,
  projectLockfile,
  resolveDependencyPath,
} from "./lockfile";

describe("packageNameFromPath", () => {
  it("reads a top-level package", () => {
    expect(packageNameFromPath("node_modules/semver")).toBe("semver");
  });

  it("reads a scoped package", () => {
    expect(packageNameFromPath("node_modules/@types/node")).toBe("@types/node");
  });

  it("takes the innermost package from a nested path", () => {
    expect(packageNameFromPath("node_modules/a/node_modules/b")).toBe("b");
  });

  it("returns null for the root entry", () => {
    expect(packageNameFromPath("")).toBeNull();
  });
});

/**
 * npm's resolution order decides which *version* an edge points at. Attaching a
 * dependency to the wrong version would silently corrupt every reachability
 * answer downstream, so this is tested directly rather than assumed.
 */
describe("resolveDependencyPath", () => {
  const tree = new Set([
    "node_modules/a",
    "node_modules/b",
    "node_modules/a/node_modules/b",
    "node_modules/a/node_modules/c/node_modules/d",
    "node_modules/a/node_modules/c",
  ]);

  it("resolves from the root to a hoisted package", () => {
    expect(resolveDependencyPath("", "a", tree)).toBe("node_modules/a");
  });

  it("prefers a nested copy over the hoisted one", () => {
    // `a` has its own `b`, which must win over the root `b`.
    expect(resolveDependencyPath("node_modules/a", "b", tree)).toBe(
      "node_modules/a/node_modules/b",
    );
  });

  it("falls back to the hoisted copy when there is no nested one", () => {
    expect(resolveDependencyPath("node_modules/b", "a", tree)).toBe("node_modules/a");
  });

  it("walks up through several levels", () => {
    // From deep inside, `a` is only found at the root.
    expect(resolveDependencyPath("node_modules/a/node_modules/c", "a", tree)).toBe(
      "node_modules/a",
    );
  });

  it("finds a sibling one level up", () => {
    expect(
      resolveDependencyPath("node_modules/a/node_modules/c/node_modules/d", "c", tree),
    ).toBe("node_modules/a/node_modules/c");
  });

  it("returns null when nothing matches", () => {
    expect(resolveDependencyPath("", "nonexistent", tree)).toBeNull();
  });
});

describe("parseLockfile", () => {
  it("rejects lockfileVersion 1, which has no resolved tree", () => {
    expect(() => parseLockfile({ lockfileVersion: 1, packages: {} })).toThrow(
      LockfileError,
    );
  });

  it("rejects a non-object", () => {
    expect(() => parseLockfile("nope")).toThrow(LockfileError);
  });

  it("reports unresolved dependencies instead of dropping them", () => {
    // An incomplete tree can hide a real path, so gaps must surface.
    const graph = parseLockfile({
      lockfileVersion: 3,
      packages: {
        "": { name: "app", version: "1.0.0", dependencies: { ghost: "^1.0.0" } },
      },
    });
    expect(graph.edges).toHaveLength(0);
    expect(graph.unresolved).toEqual([{ from: "", name: "ghost" }]);
  });

  it("builds edges across a nested tree", () => {
    const graph = parseLockfile({
      lockfileVersion: 3,
      packages: {
        "": { name: "app", version: "1.0.0", dependencies: { a: "^1.0.0" } },
        "node_modules/a": { version: "1.0.0", dependencies: { b: "^2.0.0" } },
        "node_modules/b": { version: "1.0.0" },
        "node_modules/a/node_modules/b": { version: "2.0.0" },
      },
    });

    expect(graph.unresolved).toHaveLength(0);
    expect(graph.edges).toContainEqual({ from: "", to: "node_modules/a" });
    // `a` must depend on its nested b@2.0.0, not the hoisted b@1.0.0.
    expect(graph.edges).toContainEqual({
      from: "node_modules/a",
      to: "node_modules/a/node_modules/b",
    });
    expect(graph.edges).not.toContainEqual({
      from: "node_modules/a",
      to: "node_modules/b",
    });
  });
});

/**
 * Run against this repository's own lockfile. Tavik's first protected service is
 * Tavik itself, so this is real first-party data rather than a fixture — and it
 * catches drift in the real format that a hand-written fixture never would.
 */
describe("this repository's real lockfile", () => {
  const lockfilePath = resolve(__dirname, "../../../package-lock.json");
  const graph = parseLockfile(JSON.parse(readFileSync(lockfilePath, "utf8")));

  it("parses", () => {
    expect(graph.projectName).toBe("tavik");
    expect(graph.packages.length).toBeGreaterThan(50);
  });

  it("resolves essentially every dependency", () => {
    // A handful of unresolved optional/platform-specific entries is normal.
    // A large number means the resolution algorithm is wrong.
    const ratio = graph.unresolved.length / Math.max(graph.edges.length, 1);
    expect(ratio).toBeLessThan(0.05);
  });

  it("includes packages we know are installed", () => {
    const names = new Set(graph.packages.map((pkg) => pkg.name));
    expect(names.has("next")).toBe(true);
    expect(names.has("semver")).toBe(true);
    expect(names.has("typescript")).toBe(true);
  });

  it("projects into entities and relations", () => {
    const projection = projectLockfile(graph, {
      environment: "production",
      observedAt: 1_755_000_000_000,
      lockfilePath: "package-lock.json",
    });

    expect(projection.serviceUrn).toBe("tavik:service:tavik");

    const service = projection.entities.find((e) => e.kind === "Service");
    expect(service?.name).toBe("tavik");

    // Every release carries a real resolved version.
    const releases = projection.entities.filter((e) => e.kind === "Release");
    expect(releases.length).toBeGreaterThan(50);
    for (const release of releases.slice(0, 25)) {
      expect(release.name).toMatch(/.+@\d+\.\d+\.\d+/);
    }

    // Relations reference entities that exist — no dangling edges.
    const urns = new Set(projection.entities.map((e) => e.urn));
    for (const relation of projection.relations) {
      expect(urns.has(relation.from)).toBe(true);
      expect(urns.has(relation.to)).toBe(true);
    }
  });

  it("produces no duplicate edges", () => {
    const projection = projectLockfile(graph, {
      environment: "production",
      observedAt: 1_755_000_000_000,
      lockfilePath: "package-lock.json",
    });
    const keys = projection.relations.map((r) => `${r.from}|${r.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
