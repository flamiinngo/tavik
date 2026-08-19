import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SecurityBoundary } from "@/lib/domain/boundary";
import type { Entity, Relation } from "@/lib/domain/entities";
import { entityUrn } from "@/lib/domain/entities";
import { HydraClient } from "@/lib/hydra/client";
import { GraphStore } from "@/lib/hydra/graph-store";
import { verifyBoundary } from "./verify";

/**
 * The product thesis, executed end to end against a live HydraDB.
 *
 * Everything else in this suite runs against fakes, which proves the logic but
 * not the integration. This proves the integration: real writes, HydraDB's own
 * `algo.MSpaths` doing the traversal, a real edge deletion, and a real
 * re-computation afterwards.
 *
 * The sequence is exactly the GREEN → RED → GREEN loop the product is built
 * around:
 *
 *   1. an untrusted publisher can reach production  → violated, with the path
 *   2. remove the one relationship responsible      → remediation
 *   3. ask the identical question again             → verified
 *
 * Step 3 is what makes this worth writing. Restoration is *proven* by
 * re-running the same query against the mutated graph, not asserted.
 *
 * Skipped automatically when HydraDB is not running, so the suite stays green
 * without Docker. Start it with `npm run hydra:up`.
 */

function loadEnv(): Record<string, string> | null {
  const envPath = resolve(__dirname, "../../../.env.local");
  if (!existsSync(envPath)) return null;
  const env: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2];
  }
  return env.HYDRA_TOKEN ? env : null;
}

const env = loadEnv();
let client: HydraClient | null = null;
let store: GraphStore | null = null;
let reachable = false;

if (env) {
  client = new HydraClient({
    baseUrl: env.HYDRA_URL ?? "http://127.0.0.1:8443",
    token: env.HYDRA_TOKEN,
    graphId: env.HYDRA_GRAPH_ID ?? "default",
    namespace: env.HYDRA_NAMESPACE ?? "default",
    cellId: env.HYDRA_CELL_ID ?? "cell-0",
    timeoutMs: 30_000,
  });
  store = new GraphStore(client);
}

beforeAll(async () => {
  if (!client) return;
  try {
    reachable = await client.ping();
  } catch {
    reachable = false;
  }
});

// Distinct names so a run cannot collide with real ingested data.
const publisher = entityUrn("Maintainer", "itest-publisher");
const pkg = entityUrn("Package", "itest-package");
const release = entityUrn("Release", "itest-package", "1.0.0");
const service = entityUrn("Service", "itest-checkout-api");

/**
 * Selector values unique to this test.
 *
 * The graph may already hold real ingested state — hundreds of genuine
 * maintainers labelled `untrusted` and services in `production`. Using those
 * values here would make the test assert against live data, and clearing the
 * graph to isolate it would destroy that data and time out on a large tree. So
 * the fixtures live in their own selector space and clean up only themselves.
 */
const ITEST_TRUST = "itest-untrusted";
const ITEST_ENVIRONMENT = "itest-production";

const entities: Entity[] = [
  { urn: publisher, kind: "Maintainer", name: "itest-publisher", source: "demo",
    attributes: { trust: ITEST_TRUST } },
  { urn: pkg, kind: "Package", name: "itest-package", source: "demo" },
  { urn: release, kind: "Release", name: "itest-package@1.0.0", source: "demo" },
  { urn: service, kind: "Service", name: "itest-checkout-api", source: "demo",
    attributes: { environment: ITEST_ENVIRONMENT } },
];

const allUrns = [publisher, pkg, release, service];

const observedAt = 1_755_000_000_000;
const relations: Relation[] = [
  { from: publisher, to: pkg, kind: "MAINTAINS", source: "demo", observedAt },
  { from: pkg, to: release, kind: "HAS_RELEASE", source: "demo", observedAt },
  { from: release, to: service, kind: "SUPPLIES", source: "demo", observedAt },
];

const boundary: SecurityBoundary = {
  id: "itest-production-isolation",
  name: "Production Isolation",
  statement:
    "No production service may depend on a package whose publish rights sit outside our trusted publisher set.",
  source: {
    kind: "Maintainer",
    property: "trust",
    value: ITEST_TRUST,
    description: "publishers outside the trusted set",
  },
  target: {
    kind: "Service",
    property: "environment",
    value: ITEST_ENVIRONMENT,
    description: "services running in this test's environment",
  },
  relations: ["MAINTAINS", "HAS_RELEASE", "SUPPLIES"],
  maxHops: 8,
  createdAt: observedAt,
  environmentId: "env-itest",
};

describe.runIf(env)("the GREEN -> RED -> GREEN loop, against live HydraDB", () => {
  it("runs the full loop", async () => {
    if (!reachable || !client || !store) {
      console.warn(
        "\n  SKIPPED: HydraDB is not reachable. Start it with `npm run hydra:up`.\n",
      );
      return;
    }

    // ── Arrange: clear only this test's fixtures, then the supply chain ───
    await store.deleteEntities(allUrns);

    const writtenEntities = await store.upsertEntities(entities);
    expect(writtenEntities).toBe(entities.length);

    const writtenRelations = await store.insertRelations(relations);
    expect(writtenRelations).toBe(relations.length);

    // Selectors must resolve, or the verification below would be vacuous.
    const sources = await store.resolveSelector(boundary.source);
    const targets = await store.resolveSelector(boundary.target);
    expect(sources).toContain(publisher);
    expect(targets).toContain(service);

    // ── RED: the publisher can reach production ───────────────────────────
    const violated = await verifyBoundary(store, client, boundary);

    expect(violated.failureReason).toBeUndefined();
    expect(violated.status).toBe("violated");
    expect(violated.paths.length).toBeGreaterThan(0);

    // The evidence must be the real chain, in order.
    const path = violated.paths[0];
    expect(path.hops.map((hop) => hop.relation)).toEqual([
      "MAINTAINS",
      "HAS_RELEASE",
      "SUPPLIES",
    ]);
    expect(path.hops[0].from.urn).toBe(publisher);
    expect(path.hops.at(-1)?.to.urn).toBe(service);

    // ── Remediate: remove the one relationship responsible ────────────────
    await store.deleteRelation(pkg, release, "HAS_RELEASE");

    // ── GREEN: the identical question, asked again ────────────────────────
    const restored = await verifyBoundary(store, client, boundary);

    expect(restored.failureReason).toBeUndefined();
    expect(restored.status).toBe("verified");
    expect(restored.paths).toHaveLength(0);

    await store.deleteEntities(allUrns);
  }, 60_000);

  it("holds when the estate is populated but nothing matches the selectors", async () => {
    if (!reachable || !store || !client) return;

    // Populate explicitly rather than relying on whatever a previous run left
    // behind. An earlier version of this test assumed ambient data and started
    // failing the moment the workspace could be reset — it was asserting against
    // leftovers, not a stated precondition.
    //
    // Both kinds exist here, but no maintainer carries this test's trust label,
    // so there is genuinely nothing that could cross and the boundary holds.
    // That distinction is what lets a real rule ever report green: "checked, and
    // nothing qualifies" is a result, not a failure to check.
    await store.deleteEntities(allUrns);
    await store.upsertEntities([
      { ...entities[0], attributes: { trust: "itest-some-other-label" } },
      entities[3],
    ]);

    const result = await verifyBoundary(store, client, boundary);

    expect(result.status).toBe("verified");
    expect(result.paths).toHaveLength(0);
    expect(result.failureReason).toBeUndefined();

    await store.deleteEntities(allUrns);
  }, 30_000);

  it("reports unknown when nothing of that kind exists at all", async () => {
    if (!reachable || !store || !client) return;

    // No maintainers whatsoever means ingestion never ran. Tavik has checked
    // nothing, so it must not claim the rule holds.
    await store.deleteEntities(allUrns);
    const result = await verifyBoundary(store, client, {
      ...boundary,
      source: { ...boundary.source, kind: "CiJob" },
    });

    expect(result.status).toBe("unknown");
    expect(result.failureReason).toMatch(/ingestion/i);
  }, 30_000);
});
