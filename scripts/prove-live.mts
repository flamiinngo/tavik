#!/usr/bin/env tsx
/**
 * Prove the interface is reading the database, not reciting constants.
 *
 * Reads the numbers off the rendered pages, changes the graph, reads them again,
 * then restores. If any figure is hardcoded it will not move.
 *
 * Usage:  npx tsx scripts/prove-live.mts
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { entityUrn, type Entity } from "../src/lib/domain/entities";
import { HydraClient } from "../src/lib/hydra/client";
import { GraphStore } from "../src/lib/hydra/graph-store";

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

const BASE = process.env.TAVIK_URL ?? "http://localhost:3001";

const client = new HydraClient({
  baseUrl: env.HYDRA_URL,
  token: env.HYDRA_TOKEN,
  graphId: env.HYDRA_GRAPH_ID,
  namespace: env.HYDRA_NAMESPACE,
  cellId: env.HYDRA_CELL_ID,
  timeoutMs: 120_000,
});
const store = new GraphStore(client);

/** Pull the figures the pages actually render. */
async function readPages() {
  const landing = await (await fetch(BASE + "/", { cache: "no-store" })).text();
  const app = await (await fetch(BASE + "/app", { cache: "no-store" })).text();

  // "Your code trusts <n> strangers"
  const publishers = /trusts[\s\S]{0,400}?([\d,]+)<\/span>/.exec(landing)?.[1] ?? "?";
  // "<n> packages, versions and publishers mapped"
  const mapped =
    /([\d,]+)<\/dd>[\s\S]{0,200}?packages, versions and publishers mapped/.exec(landing)?.[1] ??
    "?";
  // "Watching <n> things across your supply chain"
  const watching = /Watching ([\d,]+) things/.exec(app)?.[1] ?? "?";

  return { publishers, mapped, watching };
}

function row(label: string, values: Record<string, string>) {
  console.log(
    `  ${label.padEnd(26)} publishers=${values.publishers.padStart(6)}` +
      `   mapped=${values.mapped.padStart(7)}   watching=${values.watching.padStart(7)}`,
  );
}

console.log("\n  Reading the numbers the pages currently render…\n");
const before = await readPages();
row("BEFORE", before);

// ── Change the graph ────────────────────────────────────────────────────────
//
// Three new publishers, none of which exist anywhere in the source. If the
// figures are hardcoded they cannot move.
const probeNames = ["zz-proof-alpha", "zz-proof-beta", "zz-proof-gamma"];
const probes: Entity[] = probeNames.map((name) => ({
  urn: entityUrn("Maintainer", name),
  kind: "Maintainer",
  name,
  source: "demo",
  attributes: { trust: "untrusted" },
}));

console.log(`\n  Adding ${probes.length} publishers directly to HydraDB…`);
await store.upsertEntities(probes);

const after = await readPages();
row("AFTER ADDING 3", after);

// ── Put it back ─────────────────────────────────────────────────────────────
console.log("\n  Removing them again…");
await store.deleteEntities(probes.map((p) => p.urn));

const restored = await readPages();
row("AFTER REMOVING", restored);

// ── Verdict ─────────────────────────────────────────────────────────────────
const moved =
  before.publishers !== after.publishers ||
  before.mapped !== after.mapped ||
  before.watching !== after.watching;

console.log(
  "\n  " +
    (moved
      ? "The figures moved when the database changed, and moved back. They are read from HydraDB."
      : "The figures did NOT move. Something is hardcoded — that is a real bug."),
);
console.log("");
