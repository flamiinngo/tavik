#!/usr/bin/env tsx
/**
 * Verify security boundaries against the ingested state.
 *
 * Run after `npm run ingest`. This is the product loop on the command line: ask
 * whether a stated boundary still holds, and if it does not, print the exact
 * path that broke it.
 *
 * Usage:
 *   npm run verify
 *   npm run verify -- --trust ljharb,sindresorhus
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SecurityBoundary } from "../src/lib/domain/boundary";
import { HydraClient } from "../src/lib/hydra/client";
import { GraphStore } from "../src/lib/hydra/graph-store";
import { verifyBoundary } from "../src/lib/engine/verify";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const envPath = resolve(projectRoot, ".env.local");
if (!existsSync(envPath)) {
  console.error("No .env.local found. Run `npm run hydra:setup` first.");
  process.exit(1);
}
const env: Record<string, string> = {};
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) env[match[1]] = match[2];
}

const client = new HydraClient({
  baseUrl: env.HYDRA_URL ?? "http://127.0.0.1:8443",
  token: env.HYDRA_TOKEN,
  graphId: env.HYDRA_GRAPH_ID ?? "default",
  namespace: env.HYDRA_NAMESPACE ?? "default",
  cellId: env.HYDRA_CELL_ID ?? "cell-0",
  timeoutMs: 120_000,
});
const store = new GraphStore(client);

const boundary: SecurityBoundary = {
  id: "production-isolation",
  name: "Production Isolation",
  statement:
    "No production service may depend on a package whose publish rights sit outside our trusted publisher set.",
  source: {
    kind: "Maintainer",
    property: "trust",
    value: "untrusted",
    description: "publishers not on this workspace's allowlist",
  },
  target: {
    kind: "Service",
    property: "environment",
    value: arg("environment", "production")!,
    description: `services running in ${arg("environment", "production")}`,
  },
  relations: ["MAINTAINS", "HAS_RELEASE", "SUPPLIES"],
  maxHops: 8,
  createdAt: Date.now(),
  environmentId: "env-local",
};

const STATUS_LABEL: Record<string, string> = {
  verified: "GREEN   BOUNDARY VERIFIED",
  violated: "RED     BOUNDARY VIOLATED",
  investigating: "AMBER   UNDER INVESTIGATION",
  unknown: "GREY    UNKNOWN",
};

console.log(`\n  ${boundary.name}`);
console.log(`  "${boundary.statement}"\n`);
console.log(`  checking up to ${boundary.maxHops} hops via ${boundary.relations.join(" / ")}...\n`);

const result = await verifyBoundary(store, client, boundary);

console.log(`  ${STATUS_LABEL[result.status] ?? result.status}`);
console.log(
  `  ${result.sourceCount} source entities, ${result.targetCount} targets, ` +
    `${result.elapsedMs.toFixed(0)}ms in HydraDB\n`,
);

if (result.failureReason) {
  console.log(`  ${result.failureReason}\n`);
  process.exit(0);
}

if (result.status === "verified") {
  console.log("  No path exists. The boundary holds.\n");
  process.exit(0);
}

console.log(`  ${result.paths.length} violating path(s) found. Evidence:\n`);

for (const [index, path] of result.paths.slice(0, 3).entries()) {
  console.log(`  Path ${index + 1} — ${path.length} hops`);
  console.log(`    ${path.hops[0].from.name}  [${path.hops[0].from.kind}]`);
  for (const hop of path.hops) {
    console.log(`      --${hop.relation}-->  ${hop.to.name}  [${hop.to.kind}]`);
  }
  console.log("");
}

if (result.paths.length > 3) {
  console.log(`  ... and ${result.paths.length - 3} more.\n`);
}

console.log(
  "  Note: 'untrusted' means the publishing account is not on this workspace's\n" +
    "  allowlist. It is not a claim that any account is compromised or malicious.\n",
);
