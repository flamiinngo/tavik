import { describe, expect, it } from "vitest";

import type { BoundaryVerification, SecurityBoundary } from "../src/lib/domain/boundary";
import type { EntityUrn, ReachabilityPath } from "../src/lib/domain/entities";
import { renderMarkdownSummary } from "./summary";

/**
 * The report a whole team reads off a failed build.
 *
 * Two things are worth pinning. The verdict has to be the first thing on the
 * page, because somebody opening a red build wants to know what broke before
 * they want a table. And the text has to survive package names, which come from
 * the public registry where anyone can publish — a name is untrusted input on
 * the way into a build summary exactly as it is on the way into Cypher.
 */

const rule = (overrides: Partial<SecurityBoundary> = {}): SecurityBoundary => ({
  id: "outside-publishers",
  name: "Outside publishers",
  statement: "Nobody outside our approved list should be able to get code into production.",
  source: { kind: "Maintainer", property: "trust", value: "untrusted", description: "them" },
  target: { kind: "Service", property: "environment", value: "production", description: "us" },
  relations: ["MAINTAINS", "HAS_RELEASE", "SUPPLIES"],
  maxHops: 8,
  createdAt: 0,
  environmentId: "env-local",
  ...overrides,
});

const node = (name: string) => ({
  urn: `tavik:release:${name}` as EntityUrn,
  kind: "Release" as const,
  name,
  source: "npm-registry" as const,
});

const path = (names: readonly string[]): ReachabilityPath => ({
  length: names.length - 1,
  hops: names.slice(0, -1).map((from, index) => ({
    from: node(from),
    relation: "SUPPLIES" as const,
    to: node(names[index + 1]),
  })),
});

const verification = (
  overrides: Partial<BoundaryVerification> = {},
): BoundaryVerification => ({
  boundaryId: "outside-publishers",
  status: "violated",
  verifiedAt: 0,
  paths: [path(["lodash", "checkout"])],
  truncated: false,
  sourceCount: 1,
  targetCount: 1,
  elapsedMs: 10,
  ...overrides,
});

const render = (
  outcomes: { rule: SecurityBoundary; verification: BoundaryVerification }[],
  failOnUnknown = true,
) => renderMarkdownSummary({ outcomes, elapsedMs: 2500, failOnUnknown, showPaths: 3 });

describe("the verdict, first", () => {
  it("leads with what broke", () => {
    const out = render([{ rule: rule(), verification: verification() }]);
    expect(out.split("\n")[0]).toBe("## ❌ 1 rule broken");
  });

  it("leads with the all-clear when everything holds", () => {
    const out = render([
      { rule: rule(), verification: verification({ status: "verified", paths: [] }) },
    ]);
    expect(out.split("\n")[0]).toBe("## ✅ Every rule holds");
  });

  it("leads with the refusal when a rule could not be checked", () => {
    const out = render([
      {
        rule: rule(),
        verification: verification({ status: "unknown", paths: [], failureReason: "no data" }),
      },
    ]);
    expect(out.split("\n")[0]).toContain("could not be checked");
    // States that this is a deliberate choice, not a malfunction.
    expect(out).toContain('"Not checked" is not "safe"');
  });

  it("does not lead with a refusal the run was told to tolerate", () => {
    const out = render(
      [
        {
          rule: rule(),
          verification: verification({ status: "unknown", paths: [], failureReason: "no data" }),
        },
      ],
      false,
    );
    expect(out.split("\n")[0]).toBe("## ✅ Every rule holds");
  });

  it("reports broken ahead of unchecked when both are present", () => {
    // A proven way in is a worse fact than an unanswered question.
    const out = render([
      { rule: rule({ id: "a", name: "A" }), verification: verification() },
      {
        rule: rule({ id: "b", name: "B" }),
        verification: verification({ status: "unknown", paths: [] }),
      },
    ]);
    expect(out.split("\n")[0]).toContain("broken");
  });
});

describe("the evidence", () => {
  it("prints every hop, so each link can be checked by hand", () => {
    const out = render([
      {
        rule: rule(),
        verification: verification({ paths: [path(["a", "b", "c", "checkout"])] }),
      },
    ]);

    expect(out).toContain("──supplies──▶ b");
    expect(out).toContain("──supplies──▶ c");
    expect(out).toContain("──supplies──▶ checkout");
  });

  it("marks a capped result as a sample rather than a total", () => {
    // Saying "3 more" where the truth is "at least 3 more" understates the
    // problem in the one report meant to convey its size.
    const out = render([
      {
        rule: rule(),
        verification: verification({
          paths: [path(["a", "x"]), path(["b", "x"]), path(["c", "x"]), path(["d", "x"])],
          truncated: true,
        }),
      },
    ]);

    expect(out).toContain("1+ more");
  });

  it("uses the engine's own words for an unchecked rule", () => {
    const out = render([
      {
        rule: rule(),
        verification: verification({
          status: "unknown",
          paths: [],
          failureReason: "Tavik won't guess. It has no CI identities to look at yet.",
        }),
      },
    ]);
    expect(out).toContain("Tavik won't guess");
  });
});

describe("untrusted names", () => {
  it("does not let a package name break the table", () => {
    // A pipe in a rule name would split the row and silently drop a column.
    const out = render([
      { rule: rule({ name: "a | b" }), verification: verification({ status: "verified", paths: [] }) },
    ]);
    expect(out).toContain("a \\| b");
  });

  it("does not let a name inject markup into someone else's build summary", () => {
    const out = render([
      {
        rule: rule({ name: "<img src=x onerror=alert(1)>" }),
        verification: verification({ status: "verified", paths: [] }),
      },
    ]);
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("keeps a multi-line statement on one row", () => {
    const out = render([
      { rule: rule({ statement: "line one\nline two" }), verification: verification() },
    ]);
    expect(out).toContain("> line one line two");
  });
});

describe("the footer", () => {
  it("counts every outcome", () => {
    const out = render([
      { rule: rule({ id: "a", name: "A" }), verification: verification() },
      {
        rule: rule({ id: "b", name: "B" }),
        verification: verification({ status: "verified", paths: [] }),
      },
      {
        rule: rule({ id: "c", name: "C" }),
        verification: verification({ status: "unknown", paths: [] }),
      },
    ]);
    expect(out).toContain("1 holding · 1 broken · 1 unchecked");
  });
});
