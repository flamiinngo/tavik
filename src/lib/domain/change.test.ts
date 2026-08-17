import { describe, expect, it } from "vitest";
import { describeStatusChange, diffPaths, summarisePath } from "./change";
import type { Entity, EntityUrn, ReachabilityPath } from "./entities";
import { entityUrn } from "./entities";

function entity(urn: EntityUrn, kind: Entity["kind"]): Entity {
  return { urn, kind, name: String(urn), source: "demo" };
}

const publisher = entityUrn("Maintainer", "someone");
const pkg = entityUrn("Package", "left-pad");
const other = entityUrn("Package", "other-pkg");
const service = entityUrn("Service", "checkout");

function path(...steps: [EntityUrn, string, EntityUrn][]): ReachabilityPath {
  const hops = steps.map(([from, relation, to]) => ({
    from: entity(from, "Package"),
    relation: relation as ReachabilityPath["hops"][number]["relation"],
    to: entity(to, "Package"),
  }));
  return { hops, length: hops.length };
}

describe("summarisePath", () => {
  it("signs the whole chain, not just the endpoints", () => {
    // Two different routes between the same pair are different findings: one
    // may be remediable and the other not.
    const viaOne = path([publisher, "MAINTAINS", pkg], [pkg, "SUPPLIES", service]);
    const viaTwo = path([publisher, "MAINTAINS", other], [other, "SUPPLIES", service]);

    expect(summarisePath(viaOne).signature).not.toBe(summarisePath(viaTwo).signature);
  });

  it("is stable for the same chain", () => {
    const a = path([publisher, "MAINTAINS", pkg]);
    const b = path([publisher, "MAINTAINS", pkg]);
    expect(summarisePath(a).signature).toBe(summarisePath(b).signature);
  });

  it("distinguishes the same endpoints reached by a different relationship", () => {
    const viaMaintains = path([publisher, "MAINTAINS", pkg]);
    const viaPublished = path([publisher, "PUBLISHED", pkg]);
    expect(summarisePath(viaMaintains).signature).not.toBe(
      summarisePath(viaPublished).signature,
    );
  });
});

describe("diffPaths", () => {
  it("identifies the path that appeared", () => {
    const before = [path([publisher, "MAINTAINS", pkg])];
    const after = [
      path([publisher, "MAINTAINS", pkg]),
      path([publisher, "MAINTAINS", other]),
    ];

    const { appeared, resolved } = diffPaths(before, after);
    expect(appeared).toHaveLength(1);
    expect(appeared[0].hops[0].to).toBe(String(other));
    expect(resolved).toHaveLength(0);
  });

  it("identifies the path a remediation removed", () => {
    const before = [path([publisher, "MAINTAINS", pkg])];
    const after: ReachabilityPath[] = [];

    const { appeared, resolved } = diffPaths(before, after);
    expect(appeared).toHaveLength(0);
    expect(resolved).toHaveLength(1);
  });

  it("reports nothing when the paths are unchanged", () => {
    const paths = [path([publisher, "MAINTAINS", pkg])];
    const { appeared, resolved } = diffPaths(paths, paths);
    expect(appeared).toHaveLength(0);
    expect(resolved).toHaveLength(0);
  });

  it("treats a re-routed path as both resolved and appeared", () => {
    // The old route is genuinely gone and a new one genuinely exists; collapsing
    // them into "no change" would hide a real event.
    const before = [path([publisher, "MAINTAINS", pkg])];
    const after = [path([publisher, "MAINTAINS", other])];

    const { appeared, resolved } = diffPaths(before, after);
    expect(appeared).toHaveLength(1);
    expect(resolved).toHaveLength(1);
  });
});

describe("describeStatusChange", () => {
  it("states a violation plainly, without theatre", () => {
    const message = describeStatusChange("Production Isolation", "verified", "violated", 1);
    expect(message).toBe(
      "Production Isolation is violated. A new path made the target reachable.",
    );
    expect(message).not.toMatch(/[!]/);
    expect(message).not.toMatch(/urgent|alert|danger|critical/i);
  });

  it("pluralises multiple new paths", () => {
    expect(describeStatusChange("Production Isolation", "verified", "violated", 3)).toContain(
      "3 new paths",
    );
  });

  it("states restoration", () => {
    expect(describeStatusChange("Production Isolation", "violated", "verified", 0)).toBe(
      "Production Isolation is restored. No path remains.",
    );
  });

  it("is explicit that unknown is not verified", () => {
    // The distinction is the product's most important safety property, so the
    // wording must not let a reader round it down to "fine".
    const message = describeStatusChange("Production Isolation", "verified", "unknown", 0);
    expect(message).toMatch(/unknown, not verified/);
  });
});
