#!/usr/bin/env tsx
/**
 * Confirm the scheduler is actually sweeping.
 *
 * Reads the stored last-sweep timestamp twice, a while apart. If it advances,
 * something is re-checking the rules without anyone asking it to — which is the
 * whole claim behind "continuous".
 *
 * Usage:  npx tsx scripts/check-sweep.mts
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

const store = new GraphStore(
  new HydraClient({
    baseUrl: env.HYDRA_URL,
    token: env.HYDRA_TOKEN,
    graphId: env.HYDRA_GRAPH_ID,
    namespace: env.HYDRA_NAMESPACE,
    cellId: env.HYDRA_CELL_ID,
    timeoutMs: 60_000,
  }),
);

const first = await store.getMeta("last_sweep_at");
console.log(
  `\n  first read   ${first ? new Date(first).toISOString() : "never swept"}`,
);

const WAIT = 25_000;
console.log(`  waiting ${WAIT / 1000}s without touching the app…`);
await new Promise((r) => setTimeout(r, WAIT));

const second = await store.getMeta("last_sweep_at");
console.log(`  second read  ${second ? new Date(second).toISOString() : "never swept"}`);

if (first && second && second > first) {
  console.log(
    `\n  Advanced by ${Math.round((second - first) / 1000)}s with nobody looking. ` +
      `The scheduler is running.\n`,
  );
} else {
  console.log("\n  Did not advance. The scheduler is NOT running.\n");
}
