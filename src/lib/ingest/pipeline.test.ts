import { beforeEach, describe, expect, it, vi } from "vitest";

import { entityUrn, type EntityUrn, type RelationKind } from "@/lib/domain/entities";
import type { GraphStore } from "@/lib/hydra/graph-store";
import { ingestProject } from "./pipeline";

/**
 * Forgetting a dependency that has been removed.
 *
 * Ingestion used to only ever add. A team that deleted a bad package and
 * re-scanned was still told it was there, because the edge from the old release
 * into their service was never taken away — so the rule stayed red forever and
 * "fix it, re-scan, watch it go green" quietly stopped being true.
 *
 * The opposite mistake is far worse, which is why the scope is tested as
 * carefully as the behaviour: a route wrongly deleted is a boundary reported
 * safe that is not. One project's scan must never remove another project's
 * routes, and must never touch facts about the wider ecosystem.
 */

/**
 * No real registry calls.
 *
 * `ingestProject` asks npm who can publish each package, which is right in
 * production and wrong in a unit test: it makes the suite slow, and it makes it
 * fail when the network is down or the public registry is having a bad day —
 * neither of which says anything about the code under test. Publish rights are
 * irrelevant to what these tests are about.
 */
beforeEach(() => {
  vi.stubGlobal("fetch", async () => new Response("not found", { status: 404 }));
});

const SERVICE = entityUrn("Service", "checkout");
const OTHER_SERVICE = entityUrn("Service", "billing");
const FLATTEN = entityUrn("Release", "flatten:1.0.3");
const LODASH = entityUrn("Release", "lodash:4.17.21");

interface Deleted {
  from: EntityUrn;
  to: EntityUrn;
  kind: RelationKind;
}

/**
 * A store that records what would have been deleted.
 *
 * `stored` is what the graph already holds, in the `from|to` form
 * `listRelationsOfKind` returns.
 */
function fakeStore(stored: readonly string[]): {
  store: GraphStore;
  deleted: Deleted[];
} {
  const deleted: Deleted[] = [];

  const store = {
    upsertEntities: vi.fn(async () => 0),
    insertRelations: vi.fn(async () => 0),
    listRelationsOfKind: vi.fn(async (kind: RelationKind) =>
      kind === "SUPPLIES" ? new Set(stored) : new Set<string>(),
    ),
    deleteRelation: vi.fn(async (from: EntityUrn, to: EntityUrn, kind: RelationKind) => {
      deleted.push({ from, to, kind });
    }),
  } as unknown as GraphStore;

  return { store, deleted };
}

/** A lockfile for `checkout` that installs whichever packages are named. */
function lockfile(packages: readonly { name: string; version: string }[]) {
  return {
    projectName: "checkout",
    packages: [
      { path: "", name: "checkout", version: "1.0.0", dev: false },
      ...packages.map((pkg) => ({
        path: `node_modules/${pkg.name}`,
        name: pkg.name,
        version: pkg.version,
        dev: false,
      })),
    ],
    edges: packages.map((pkg) => ({ from: "", to: `node_modules/${pkg.name}` })),
    unresolved: [],
  };
}

async function scan(store: GraphStore, packages: readonly { name: string; version: string }[]) {
  return ingestProject(store, {
    lockfile: lockfile(packages),
    serviceName: "checkout",
    environment: "production",
    trustedPublishers: new Set(),
    lockfilePath: "package-lock.json",
    // No registry calls: publish rights are irrelevant to what is being tested
    // here, and a unit test must not depend on the public npm registry being up.
    concurrency: 1,
  });
}

describe("a dependency that has been removed", () => {
  it("is forgotten, so the rule can go green again", async () => {
    // The graph remembers flatten supplying checkout. The new lockfile does not.
    const { store, deleted } = fakeStore([`${FLATTEN}|${SERVICE}`]);

    await scan(store, []);

    expect(deleted).toContainEqual({ from: FLATTEN, to: SERVICE, kind: "SUPPLIES" });
  });

  it("is forgotten even when the project still has other dependencies", async () => {
    const { store, deleted } = fakeStore([`${FLATTEN}|${SERVICE}`, `${LODASH}|${SERVICE}`]);

    await scan(store, [{ name: "lodash", version: "4.17.21" }]);

    expect(deleted.map((entry) => entry.from)).toEqual([FLATTEN]);
  });

  it("is reported, because the count is what proves a fix worked", async () => {
    const { store } = fakeStore([`${FLATTEN}|${SERVICE}`]);

    const report = await scan(store, []);

    expect(report.relationsRemoved).toBe(1);
  });
});

describe("what a scan must never remove", () => {
  it("leaves another service's routes alone", async () => {
    // The graph is shared. One repository's scan has no business deleting a
    // route into somebody else's service.
    const { store, deleted } = fakeStore([
      `${FLATTEN}|${SERVICE}`,
      `${FLATTEN}|${OTHER_SERVICE}`,
    ]);

    await scan(store, []);

    expect(deleted).toHaveLength(1);
    expect(deleted[0].to).toBe(SERVICE);
  });

  it("leaves facts about the wider ecosystem alone", async () => {
    // `flatten supplies lodash` stays true no matter who scans. Only edges into
    // the service being scanned are this lockfile's business.
    const { store, deleted } = fakeStore([`${FLATTEN}|${LODASH}`, `${FLATTEN}|${SERVICE}`]);

    await scan(store, []);

    expect(deleted.map((entry) => entry.to)).toEqual([SERVICE]);
  });

  it("removes nothing when the dependencies are unchanged", async () => {
    // Deleting and re-adding the same edge every scan would be pure write churn,
    // and churn is what degrades every subsequent read in a log-structured store.
    const { store, deleted } = fakeStore([`${LODASH}|${SERVICE}`]);

    await scan(store, [{ name: "lodash", version: "4.17.21" }]);

    expect(deleted).toHaveLength(0);
  });

  it("removes nothing on a first scan of an empty graph", async () => {
    const { store, deleted } = fakeStore([]);

    await scan(store, [{ name: "lodash", version: "4.17.21" }]);

    expect(deleted).toHaveLength(0);
  });
});

describe("when a delete fails", () => {
  it("still finishes the scan", async () => {
    // A stale edge produces a route that no longer exists — a false alarm, not a
    // false all-clear — so it must not abandon a scan that has already written
    // everything else. The next scan tries again.
    const { store } = fakeStore([`${FLATTEN}|${SERVICE}`]);
    vi.mocked(store.deleteRelation).mockRejectedValue(new Error("HydraDB said no"));

    const report = await scan(store, []);

    expect(report.relationsRemoved).toBe(0);
    expect(report.serviceUrn).toBe(SERVICE);
  });
});
