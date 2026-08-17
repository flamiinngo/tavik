#!/usr/bin/env node
/**
 * Pin HydraDB's actual wire contract.
 *
 * The published documentation describes a much larger openCypher subset than the
 * running server accepts, and Tavik's correctness depends on knowing exactly
 * where the line is. So this asks the server directly and prints what it says.
 *
 * It is written as a sequence of small, independent experiments rather than a
 * happy path: each one isolates a single question ("are query parameters
 * supported?", "does variable-length traversal need a type?") so a failure
 * identifies a capability rather than just breaking the run.
 *
 * Re-run after any HydraDB upgrade. Findings belong in docs/hydra.md.
 *
 * Run:  npm run hydra:probe
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(projectRoot, ".env.local");

if (!existsSync(envPath)) {
  console.error("No .env.local found. Run `npm run hydra:setup` first.");
  process.exit(1);
}

const env = {};
for (const line of (await readFile(envPath, "utf8")).split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) env[match[1]] = match[2];
}

const baseUrl = (env.HYDRA_URL ?? "http://127.0.0.1:8443").replace(/\/+$/, "");
const endpoint = `${baseUrl}/v1/graphs/${env.HYDRA_GRAPH_ID ?? "default"}/query`;
const NS = "TavikProbe";

const findings = [];

/** Send a raw body so parameter-passing conventions can be tested too. */
async function send(label, body, { quiet = false } = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.HYDRA_TOKEN}`,
      "X-Graph-Namespace": env.HYDRA_NAMESPACE ?? "default",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cell_id: env.HYDRA_CELL_ID ?? "cell-0", ...body }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { _raw: text.slice(0, 400) };
  }

  const ok = response.ok;
  const detail = ok
    ? `columns=${JSON.stringify(payload.columns ?? null)} rows=${JSON.stringify(payload.rows ?? null)}`
    : (payload.error?.message ?? text.slice(0, 200));

  findings.push({ label, ok, detail });
  if (!quiet) {
    console.log(`${ok ? "  OK  " : " FAIL "} ${label}`);
    console.log(`        ${detail}`);
  }
  return { ok, payload };
}

const q = (label, query, extra = {}) => send(label, { query, ...extra });

console.log("\n=== 1. Liveness: which minimal query shapes are accepted? ===");
await q("bare RETURN", "RETURN 1 AS ok");
await q("MATCH + count", `MATCH (n:${NS}) RETURN count(n) AS total`);

console.log("\n=== 2. Query parameters: does the server accept them, and how? ===");
// The SPpaths error mentioned "missing OpenCypher query parameter $sourceNode",
// which implies a parameter mechanism exists. Find the field name it expects.
for (const field of ["parameters", "params", "args", "bindings"]) {
  await q(
    `param field "${field}"`,
    `MATCH (n:${NS} {name: $name}) RETURN count(n) AS total`,
    { [field]: { name: "probe" } },
  );
}

console.log("\n=== 3. Writes ===");
await q("cleanup", `MATCH (n:${NS}) DETACH DELETE n`);
await q("single node CREATE", `CREATE (a:${NS} {name: 'ci-job', kind: 'ci'})`);
await q("second node", `CREATE (b:${NS} {name: 'deploy-role', kind: 'role'})`);
await q("third node", `CREATE (c:${NS} {name: 'prod-role', kind: 'role'})`);
await q("fourth node", `CREATE (d:${NS} {name: 'customer-db', kind: 'datastore'})`);

await q(
  "one-hop edge via MATCH + CREATE",
  `MATCH (a:${NS} {name: 'ci-job'}) MATCH (b:${NS} {name: 'deploy-role'}) CREATE (a)-[:CAN_ASSUME]->(b)`,
);
await q(
  "one-hop edge via MERGE",
  `MATCH (a:${NS} {name: 'deploy-role'}) MATCH (b:${NS} {name: 'prod-role'}) MERGE (a)-[:CAN_ASSUME]->(b)`,
);
await q(
  "third edge",
  `MATCH (a:${NS} {name: 'prod-role'}) MATCH (b:${NS} {name: 'customer-db'}) CREATE (a)-[:CAN_ACCESS]->(b)`,
);

console.log("\n=== 4. UNWIND batch write ===");
await q(
  "UNWIND + MERGE",
  `UNWIND [{name: 'batch-a'}, {name: 'batch-b'}] AS row MERGE (n:${NS} {name: row.name}) RETURN count(n) AS written`,
);

console.log("\n=== 5. Reads and traversal ===");
await q("property match", `MATCH (n:${NS} {name: 'ci-job'}) RETURN n.name AS name`);
await q("all of label", `MATCH (n:${NS}) RETURN n.name AS name, n.kind AS kind`);
await q(
  "one hop typed",
  `MATCH (a:${NS} {name: 'ci-job'})-[:CAN_ASSUME]->(b:${NS}) RETURN b.name AS target`,
);
await q(
  "varlen, single type",
  `MATCH (a:${NS} {name: 'ci-job'})-[:CAN_ASSUME*1..6]->(b:${NS}) RETURN b.name AS target`,
);
await q(
  "varlen, two types (expect reject)",
  `MATCH (a:${NS} {name: 'ci-job'})-[:CAN_ASSUME|CAN_ACCESS*1..6]->(b:${NS}) RETURN b.name AS target`,
);

console.log("\n=== 6. Path procedures ===");
await q(
  "SPpaths with $sourceNode/$targetNode params",
  `MATCH (s:${NS} {name: 'ci-job'}) MATCH (t:${NS} {name: 'customer-db'})
   CALL algo.SPpaths({sourceNode: s, targetNode: t, relTypes: ['CAN_ASSUME','CAN_ACCESS'], maxLen: 6, pathCount: 5})
   YIELD path RETURN path`,
);
await q(
  "SPpaths positional",
  `MATCH (s:${NS} {name: 'ci-job'}) MATCH (t:${NS} {name: 'customer-db'})
   CALL algo.SPpaths(s, t, 6) YIELD path RETURN path`,
);
await q(
  "SPpaths via parameters field",
  `CALL algo.SPpaths({sourceNode: $sourceNode, targetNode: $targetNode, maxLen: 6}) YIELD path RETURN path`,
  { parameters: { sourceNode: "ci-job", targetNode: "customer-db" } },
);
await q(
  "MSpaths with YIELD",
  `CALL algo.MSpaths({sourceLabel: '${NS}', sourceProperty: 'name', sourceValues: ['ci-job'], targetValues: ['customer-db'], pairwise: false, relTypes: ['CAN_ASSUME','CAN_ACCESS'], relDirection: 'outgoing', maxLen: 6, pathCount: 5, resultLimit: 100}) YIELD path RETURN path`,
);
await q(
  "SHOW PROCEDURES",
  "SHOW PROCEDURES",
);

console.log("\n=== 7. Delete an edge (the remediation primitive) ===");
await q(
  "delete named edge",
  `MATCH (a:${NS} {name: 'deploy-role'})-[r:CAN_ASSUME]->(b:${NS} {name: 'prod-role'}) DELETE r`,
);
await q(
  "re-verify after severing",
  `MATCH (a:${NS} {name: 'ci-job'})-[:CAN_ASSUME*1..6]->(b:${NS}) RETURN b.name AS target`,
);

console.log("\n=== cleanup ===");
await q("cleanup", `MATCH (n:${NS}) DETACH DELETE n`);

console.log("\n" + "=".repeat(72));
console.log("SUMMARY");
console.log("=".repeat(72));
for (const finding of findings) {
  console.log(`${finding.ok ? "OK  " : "FAIL"}  ${finding.label}`);
}
const okCount = findings.filter((f) => f.ok).length;
console.log(`\n${okCount}/${findings.length} accepted. Record findings in docs/hydra.md.`);
