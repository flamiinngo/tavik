#!/usr/bin/env tsx
/**
 * Does searching from the smaller endpoint set help?
 *
 * A rule with 441 sources and 2 targets is currently answered by exploring
 * outward from all 441, which times out. The same question can be asked
 * backwards — start at the 2 targets and follow edges in reverse — and should
 * explore a fraction of the space for an identical answer.
 *
 * This measures whether HydraDB supports that, and by how much it helps.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HydraClient } from "../src/lib/hydra/client";
import { GraphStore } from "../src/lib/hydra/graph-store";
import { encodeValue } from "../src/lib/hydra/cypher";

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
  timeoutMs: 120_000,
});
const store = new GraphStore(client);

const sources = await store.resolveSelector({
  kind: "Maintainer",
  property: "trust",
  value: "untrusted",
  description: "",
});
const targets = await store.resolveSelector({
  kind: "Service",
  property: "environment",
  value: "production",
  description: "",
});

console.log(`\n  ${sources.length} sources, ${targets.length} targets\n`);

const RELS = "'MAINTAINS', 'HAS_RELEASE', 'SUPPLIES'";

async function timed(label: string, cypher: string) {
  const started = Date.now();
  try {
    const result = await client.query(cypher, { consistency: "strong" });
    console.log(
      `  ${label.padEnd(44)} ${String(Date.now() - started).padStart(6)}ms  ${result.rows.length} rows`,
    );
    return result.rows.length;
  } catch (error) {
    console.log(
      `  ${label.padEnd(44)} ${String(Date.now() - started).padStart(6)}ms  ${
        error instanceof Error ? error.message.slice(0, 60) : "failed"
      }`,
    );
    return -1;
  }
}

function query(opts: {
  sourceValues: readonly string[];
  targetValues: readonly string[];
  direction: string;
  maxLen: number;
  limit: number;
}) {
  return `CALL algo.MSpaths({
    sourceLabel: 'Entity', sourceProperty: 'urn',
    sourceValues: ${encodeValue(opts.sourceValues.map(String))},
    targetValues: ${encodeValue(opts.targetValues.map(String))},
    pairwise: false, relTypes: [${RELS}], relDirection: '${opts.direction}',
    maxLen: ${opts.maxLen}, pathCount: ${opts.limit}, resultLimit: ${opts.limit}
  }) YIELD path RETURN path`;
}

// Current behaviour: outward from the many.
await timed(
  "forward, 441 sources, maxLen 8",
  query({ sourceValues: sources, targetValues: targets, direction: "outgoing", maxLen: 8, limit: 26 }),
);

// Backwards from the few: same question, far smaller search space.
await timed(
  "reversed, 2 sources, incoming, maxLen 8",
  query({ sourceValues: targets, targetValues: sources, direction: "incoming", maxLen: 8, limit: 26 }),
);

// Does a shorter bound rescue the forward direction?
await timed(
  "forward, maxLen 4",
  query({ sourceValues: sources, targetValues: targets, direction: "outgoing", maxLen: 4, limit: 26 }),
);

// Does asking for fewer paths help?
await timed(
  "forward, maxLen 8, limit 6",
  query({ sourceValues: sources, targetValues: targets, direction: "outgoing", maxLen: 8, limit: 6 }),
);

// Batching the sources into a small chunk.
await timed(
  "forward, first 40 sources only",
  query({
    sourceValues: sources.slice(0, 40),
    targetValues: targets,
    direction: "outgoing",
    maxLen: 8,
    limit: 26,
  }),
);

console.log("");
