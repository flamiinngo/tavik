#!/usr/bin/env tsx
/**
 * Report what is actually in the graph, per label and relationship type.
 *
 * Written because a report of "2,313 relationships written" says what was sent,
 * not what exists — and after a duplicate-edge incident those are exactly the
 * two numbers that need to be compared.
 *
 * Usage:  npx tsx scripts/graph-stats.mts
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HydraClient } from "../src/lib/hydra/client";
import { RELATION_KINDS } from "../src/lib/domain/entities";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(projectRoot, ".env.local");
if (!existsSync(envPath)) {
  console.error("Run `npm run hydra:setup` first.");
  process.exit(1);
}

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

async function count(label: string, cypher: string) {
  const started = Date.now();
  try {
    const result = await client.query<{ total: number }>(cypher);
    const total = Number(result.rows[0]?.total ?? 0);
    console.log(
      `${String(total).padStart(8)}  ${label.padEnd(22)} ${Date.now() - started}ms`,
    );
    return total;
  } catch (error) {
    console.log(
      `   ERROR  ${label.padEnd(22)} ${error instanceof Error ? error.message.slice(0, 90) : ""}`,
    );
    return 0;
  }
}

console.log("\nNODES");
await count("Entity", "MATCH (n:Entity) RETURN count(*) AS total");
await count("ChangeEvent", "MATCH (n:ChangeEvent) RETURN count(*) AS total");

console.log("\nEDGES BY TYPE");
let edgeTotal = 0;
for (const kind of RELATION_KINDS) {
  edgeTotal += await count(
    kind,
    `MATCH (a:Entity)-[r:${kind}]->(b:Entity) RETURN count(*) AS total`,
  );
}
console.log(`${String(edgeTotal).padStart(8)}  ${"TOTAL".padEnd(22)}`);

console.log("\nENTITIES BY KIND");
for (const kind of ["Maintainer", "Package", "Release", "Service"]) {
  await count(kind, `MATCH (n:Entity) WHERE n.kind = '${kind}' RETURN count(*) AS total`);
}
console.log("");
