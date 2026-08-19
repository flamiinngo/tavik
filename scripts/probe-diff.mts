#!/usr/bin/env tsx
/**
 * Why does a re-scan still report new relations?
 *
 * Compares what `listRelationsOfKind` returns against what ingestion is about
 * to write, and prints keys that fail to match. If the two sides disagree about
 * the shape of a key, every edge looks new forever and the store is rewritten on
 * every scan — which is the churn that degrades reads.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HydraClient } from "../src/lib/hydra/client";
import { GraphStore } from "../src/lib/hydra/graph-store";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(projectRoot, ".env.local");
if (!existsSync(envPath)) process.exit(1);
const env: Record<string, string> = {};
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
  timeoutMs: 180_000,
});
const store = new GraphStore(client);

for (const kind of ["SUPPLIES", "HAS_RELEASE", "MAINTAINS"] as const) {
  const pairs = await store.listRelationsOfKind(kind);
  console.log(`\n  ${kind}: listRelationsOfKind returned ${pairs.size} pairs`);
  for (const pair of [...pairs].slice(0, 2)) {
    console.log(`    ${pair}`);
  }
}

// What the raw query actually returns, unfiltered — the list method drops rows
// whose endpoints are not both strings, so a null urn would vanish silently.
const raw = await client.query<{ from_urn: unknown; to_urn: unknown }>(
  `MATCH (a:Entity)-[r:SUPPLIES]->(b:Entity) RETURN a.urn AS from_urn, b.urn AS to_urn`,
  { timeoutMs: 120_000 },
);
console.log(`\n  raw SUPPLIES rows: ${raw.rows.length}`);

let nonString = 0;
for (const row of raw.rows) {
  if (typeof row.from_urn !== "string" || typeof row.to_urn !== "string") nonString++;
}
console.log(`  rows with a non-string endpoint: ${nonString}`);
if (raw.rows[0]) {
  console.log(
    `  first row types: from=${typeof raw.rows[0].from_urn} to=${typeof raw.rows[0].to_urn}`,
  );
  console.log(`  first row value: ${JSON.stringify(raw.rows[0])}`);
}
console.log("");
