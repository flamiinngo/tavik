import { describe, expect, it } from "vitest";
import { parseRepoInput, parseWorkflowActions } from "./github";
import { projectWorkflows } from "./workflows";
import { entityUrn } from "@/lib/domain/entities";

/**
 * Two jobs, both easy to get quietly wrong.
 *
 * Repository parsing is the first thing anyone touches: rejecting a URL someone
 * reasonably pasted is a bad first impression for the sake of nothing.
 *
 * Workflow parsing decides whether Tavik sees the code running inside your CI.
 * A missed `uses:` line is a publisher who can reach your pipeline and its
 * secrets, invisible — and invisible reads exactly like safe.
 */

describe("parseRepoInput", () => {
  it("accepts the forms people actually paste", () => {
    const expected = { owner: "vercel", repo: "next.js" };
    expect(parseRepoInput("vercel/next.js")).toMatchObject(expected);
    expect(parseRepoInput("https://github.com/vercel/next.js")).toMatchObject(expected);
    expect(parseRepoInput("http://github.com/vercel/next.js")).toMatchObject(expected);
    expect(parseRepoInput("github.com/vercel/next.js")).toMatchObject(expected);
    expect(parseRepoInput("www.github.com/vercel/next.js")).toMatchObject(expected);
    expect(parseRepoInput("https://github.com/vercel/next.js.git")).toMatchObject(expected);
    expect(parseRepoInput("  vercel/next.js  ")).toMatchObject(expected);
  });

  it("keeps a branch when the URL names one", () => {
    expect(parseRepoInput("https://github.com/vercel/next.js/tree/canary")).toMatchObject({
      owner: "vercel",
      repo: "next.js",
      ref: "canary",
    });
  });

  it("survives a link to a file deep in the tree", () => {
    // Copying a URL from the file view is the most natural thing to do.
    const parsed = parseRepoInput(
      "https://github.com/vercel/next.js/blob/canary/package.json",
    );
    expect(parsed?.owner).toBe("vercel");
    expect(parsed?.repo).toBe("next.js");
  });

  it("rejects what isn't a repository", () => {
    expect(parseRepoInput("")).toBeNull();
    expect(parseRepoInput("   ")).toBeNull();
    expect(parseRepoInput("just some words")).toBeNull();
    expect(parseRepoInput("https://gitlab.com/foo/bar")).toBeNull();
  });
});

describe("parseWorkflowActions", () => {
  const workflow = `
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install
        run: npm ci
      - uses: "pnpm/action-setup@a3252b78c470c02df07e9d59298aecedc3ccdd6d"
      - uses: ./.github/actions/local-thing
      - uses: docker://alpine:3.18
      - uses: actions/cache/restore@v4
`;

  const actions = parseWorkflowActions(workflow, "ci.yml");

  it("finds every third-party action", () => {
    const names = actions.map((a) => a.action).sort();
    expect(names).toEqual([
      "actions/cache",
      "actions/checkout",
      "actions/setup-node",
      "pnpm/action-setup",
    ]);
  });

  it("keeps the version reference", () => {
    expect(actions.find((a) => a.action === "actions/checkout")?.version).toBe("v4");
  });

  it("keeps a full commit sha", () => {
    // Pinning to a commit is the safe form, and Tavik has to be able to tell
    // it apart from a tag to say which actions can change underneath you.
    expect(actions.find((a) => a.action === "pnpm/action-setup")?.version).toBe(
      "a3252b78c470c02df07e9d59298aecedc3ccdd6d",
    );
  });

  it("reduces a subdirectory action to its owning repository", () => {
    // `actions/cache/restore` is published by the actions/cache repository —
    // that is what somebody can push to.
    expect(actions.some((a) => a.action === "actions/cache")).toBe(true);
  });

  it("ignores local and container actions", () => {
    // Neither is third-party supply chain in the same sense.
    expect(actions.some((a) => a.action.startsWith("."))).toBe(false);
    expect(actions.some((a) => a.action.includes("docker"))).toBe(false);
  });

  it("ignores run steps", () => {
    // The workflow contains `run: npm ci`. Only `uses:` lines are actions, and
    // a shell command is not somebody else's code being pulled in.
    //
    // Asserted on the exact set rather than a substring: an earlier version
    // checked that no action name contained "npm", which `pnpm/action-setup`
    // fails for entirely innocent reasons.
    expect(actions.map((a) => a.action)).not.toContain("npm ci");
    expect(actions).toHaveLength(4);
  });

  it("handles a step written on one line", () => {
    const found = parseWorkflowActions("      - uses: actions/checkout@v4\n", "x.yml");
    expect(found).toHaveLength(1);
  });

  it("records an action with no version as unpinned", () => {
    // No reference at all means whatever is on the default branch today.
    const found = parseWorkflowActions("      - uses: actions/checkout\n", "x.yml");
    expect(found[0]?.version).toBe("unpinned");
  });

  it("returns nothing for a workflow with no actions", () => {
    expect(parseWorkflowActions("name: CI\njobs:\n  a:\n    steps:\n      - run: ls\n", "x.yml")).toEqual([]);
  });
});

describe("projectWorkflows", () => {
  const serviceUrn = entityUrn("Service", "my-app");
  const projection = projectWorkflows(
    [
      { action: "actions/checkout", version: "v4", workflow: "ci.yml" },
      { action: "actions/checkout", version: "v4", workflow: "release.yml" },
      { action: "pnpm/action-setup", version: "a".repeat(40), workflow: "ci.yml" },
    ],
    { serviceUrn, observedAt: 1_755_000_000_000, trustedPublishers: new Set() },
  );

  it("builds the same chain a dependency does", () => {
    // publisher -> action -> workflow -> service. Reusing the vocabulary is
    // what lets one rule cover dependencies and CI without knowing they differ.
    const kinds = projection.relations.map((r) => r.kind);
    expect(kinds).toContain("MAINTAINS");
    expect(kinds).toContain("SUPPLIES");
  });

  it("counts distinct actions, not usages", () => {
    expect(projection.actionCount).toBe(2);
  });

  it("counts the accounts behind them", () => {
    expect(projection.publisherCount).toBe(2);
  });

  it("flags actions running from a moving reference", () => {
    // `@v4` is a tag the publisher can repoint at any time, so the code that
    // runs tomorrow need not be the code that ran today.
    expect(projection.unpinnedCount).toBe(2);
  });

  it("does not flag a commit-pinned action", () => {
    const pinned = projectWorkflows(
      [{ action: "pnpm/action-setup", version: "b".repeat(40), workflow: "ci.yml" }],
      { serviceUrn, observedAt: 0, trustedPublishers: new Set() },
    );
    expect(pinned.unpinnedCount).toBe(0);
  });

  it("deduplicates edges repeated across workflows", () => {
    const keys = projection.relations.map((r) => `${r.from}|${r.kind}|${r.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("respects the approved list", () => {
    const trusted = projectWorkflows(
      [{ action: "actions/checkout", version: "v4", workflow: "ci.yml" }],
      { serviceUrn, observedAt: 0, trustedPublishers: new Set(["actions"]) },
    );
    const publisher = trusted.entities.find((e) => e.kind === "Maintainer");
    expect(publisher?.attributes?.trust).toBe("trusted");
  });
});
