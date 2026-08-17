#!/usr/bin/env node
/**
 * Confirm HydraDB's batch node-upsert form.
 *
 * The server's own error text points at the answer: "UNWIND vertex upsert MERGE
 * pattern matches only id; apply labels with SET" and "requires exactly one SET
 * label". So the label is applied via `SET n:Label`, not in the MERGE pattern.
 * This verifies that and the matching edge-batch form, which together are
 * everything Tavik needs to ingest.
 *
 * Run:  node scripts/hydra-probe-writes.mjs
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(projectRoot, ".env.local");
if (!existsSync(envPath)) {
  console.error("Run `npm run hydra:setup` first.");
  process.exit(1);
}

const env = {};
for (const line of (await readFile(envPath, "utf8")).split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}

const base = (env.HYDRA_URL ?? "http://127.0.0.1:8443").replace(/\/+$/, "");
const graph = env.HYDRA_GRAPH_ID ?? "default";

async function q(label, query, extra = {}) {
  const res = await fetch(`${base}/v1/graphs/${graph}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.HYDRA_TOKEN}`,
      "X-Graph-Namespace": env.HYDRA_NAMESPACE ?? "default",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cell_id: env.HYDRA_CELL_ID ?? "cell-0", query, ...extra }),
  });
  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { _raw: text.slice(0, 300) }; }
  const detail = res.ok
    ? `columns=${JSON.stringify(payload.columns)} rows=${JSON.stringify(payload.rows)?.slice(0, 500)}`
    : (payload.error?.message ?? JSON.stringify(payload).slice(0, 200));
  console.log(`${res.ok ? " OK  " : "FAIL "} ${label}`);
  console.log(`       ${detail}`);
  return { ok: res.ok, payload };
}

const nodes = [
  { id: 600, urn: "tavik:maintainer:probe-user", kind: "Maintainer", name: "probe-user" },
  { id: 601, urn: "tavik:package:probe-pkg", kind: "Package", name: "probe-pkg" },
  { id: 602, urn: "tavik:release:probe-pkg-1.0.0", kind: "Release", name: "probe-pkg@1.0.0" },
  { id: 603, urn: "tavik:service:probe-svc", kind: "Service", name: "probe-svc" },
];

console.log("=== 1. Batch node upsert, label applied with SET ===");
await q("SET label + properties",
  "UNWIND $rows AS row MERGE (n {id: row.id}) SET n:Entity, n.urn = row.urn, n.kind = row.kind, n.name = row.name",
  { parameters: { rows: nodes } });
await q("read back", "MATCH (n:Entity {id: 600}) RETURN n.urn AS urn, n.kind AS kind, n.name AS name");

console.log("\n=== 2. Idempotence: run the same upsert again ===");
await q("re-upsert",
  "UNWIND $rows AS row MERGE (n {id: row.id}) SET n:Entity, n.urn = row.urn, n.kind = row.kind, n.name = row.name",
  { parameters: { rows: nodes } });
await q("count after re-upsert", "MATCH (n:Entity) RETURN count(*) AS total");

console.log("\n=== 3. Batch edges, one relationship type per statement ===");
await q("MAINTAINS edge",
  "UNWIND $rows AS row CREATE (a {id: row.from})-[:MAINTAINS]->(b {id: row.to})",
  { parameters: { rows: [{ from: 600, to: 601 }] } });
await q("HAS_RELEASE edge",
  "UNWIND $rows AS row CREATE (a {id: row.from})-[:HAS_RELEASE]->(b {id: row.to})",
  { parameters: { rows: [{ from: 601, to: 602 }] } });
await q("SUPPLIES edge",
  "UNWIND $rows AS row CREATE (a {id: row.from})-[:SUPPLIES]->(b {id: row.to})",
  { parameters: { rows: [{ from: 602, to: 603 }] } });

console.log("\n=== 4. THE PRODUCT QUESTION: can the maintainer reach the service? ===");
await q("MSpaths maintainer -> service",
  "CALL algo.MSpaths({sourceLabel: 'Entity', sourceProperty: 'urn', sourceValues: ['tavik:maintainer:probe-user'], targetValues: ['tavik:service:probe-svc'], pairwise: false, relTypes: ['MAINTAINS','HAS_RELEASE','SUPPLIES'], relDirection: 'outgoing', maxLen: 8, pathCount: 10, resultLimit: 50}) YIELD path RETURN path");

console.log("\n=== 5. Remediation: sever the link, then re-verify ===");
await q("delete HAS_RELEASE", "MATCH (a {id: 601})-[r:HAS_RELEASE]->(b {id: 602}) DELETE r");
await q("re-verify (expect no rows)",
  "CALL algo.MSpaths({sourceLabel: 'Entity', sourceProperty: 'urn', sourceValues: ['tavik:maintainer:probe-user'], targetValues: ['tavik:service:probe-svc'], pairwise: false, relTypes: ['MAINTAINS','HAS_RELEASE','SUPPLIES'], relDirection: 'outgoing', maxLen: 8, pathCount: 10, resultLimit: 50}) YIELD path RETURN path");

console.log("\n=== cleanup ===");
await q("cleanup", "MATCH (n:Entity) DETACH DELETE n");
