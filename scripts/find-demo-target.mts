#!/usr/bin/env tsx
/**
 * Find a publisher whose exposure is small enough to close completely.
 *
 * The demo needs a boundary that can actually reach GREEN. A publisher sitting
 * on hundreds of routes cannot be remediated by one change, so this looks for
 * the opposite: real accounts that reach production by only one or two routes,
 * where removing a single dependency genuinely closes the boundary.
 *
 * Usage:  npx tsx scripts/find-demo-target.mts
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SecurityBoundary } from "../src/lib/domain/boundary";
import { entityUrn } from "../src/lib/domain/entities";
import { HydraClient } from "../src/lib/hydra/client";
import { GraphStore } from "../src/lib/hydra/graph-store";
import { verifyBoundary } from "../src/lib/engine/verify";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env: Record<string, string> = {};
const envPath = resolve(projectRoot, ".env.local");
if (!existsSync(envPath)) process.exit(1);
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}

const client = new HydraClient({
  baseUrl: env.HYDRA_URL,
  token: env.HYDRA_TOKEN,
  graphId: env.HYDRA_GRAPH_ID,
  namespace: env.HYDRA_NAMESPACE,
  cellId: env.HYDRA_CELL_ID,
  timeoutMs: 120_000,
});
const store = new GraphStore(client);

// Candidates seen in the shortest routes — publishers of leaf packages, which
// are the ones most likely to have a single way in.
const candidates = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["sebmarkbage", "hirokiosame", "defunctzombie", "samn", "aseemk", "zensh"];

function banBoundary(): SecurityBoundary {
  return {
    id: "blocked-publishers",
    name: "Banned publishers",
    statement: "Anyone we've explicitly banned must never reach production.",
    source: {
      kind: "Maintainer",
      property: "trust",
      value: "quarantined",
      description: "people we have explicitly banned",
    },
    target: {
      kind: "Service",
      property: "environment",
      value: "production",
      description: "anything running in production",
    },
    relations: ["MAINTAINS", "HAS_RELEASE", "SUPPLIES"],
    maxHops: 8,
    createdAt: 0,
    environmentId: "env-local",
  };
}

console.log("\n  Publisher            routes into production   closable in one change?");
console.log("  " + "─".repeat(70));

for (const name of candidates) {
  const urn = entityUrn("Maintainer", name);
  const exists = await store.getEntity(urn);
  if (!exists) {
    console.log(`  ${name.padEnd(20)} (not in this graph)`);
    continue;
  }

  await store.setTrust(urn, "quarantined");
  const result = await verifyBoundary(store, client, banBoundary());
  await store.setTrust(urn, "untrusted");

  const routes = result.paths.length;
  const closable = routes > 0 && routes <= 3 && !result.truncated;
  console.log(
    `  ${name.padEnd(20)} ${String(routes).padStart(3)}${result.truncated ? "+" : " "}` +
      `                    ${closable ? "YES — good demo target" : routes === 0 ? "no route at all" : "too many"}`,
  );
}

console.log("");
