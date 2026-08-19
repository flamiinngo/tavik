#!/usr/bin/env tsx
/**
 * Does approving publishers actually close a rule?
 *
 * The publishers screen claims a second route to green: instead of removing a
 * dependency, look at the accounts and accept them. This checks that the claim
 * holds by doing it — approve every publisher on a violating route, re-run the
 * same rule, and see whether the answer moves. Then put everything back.
 *
 * Usage:  npx tsx scripts/prove-approve.mts
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { entityUrn, type EntityUrn } from "../src/lib/domain/entities";
import { STARTER_RULES } from "../src/lib/domain/starter-rules";
import { verifyBoundary } from "../src/lib/engine/verify";
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

/**
 * Uses the quarantine rule rather than the general one.
 *
 * "Nobody outside our approved list" has 441 untrusted publishers behind it, so
 * the result is truncated: approving the four that happen to start the first 25
 * routes just surfaces 25 different routes from the other 437, and the count
 * never moves. That is correct behaviour — the count was always a sample, and
 * the UI says "25+" for exactly this reason — but it proves nothing about
 * approving.
 *
 * The quarantine rule scopes to a handful of accounts, so its result is complete
 * and the effect of a decision is actually visible.
 */
const rule = STARTER_RULES.find((r) => r.id === "blocked-publishers")!;

console.log(`\n  ${rule.name}`);
console.log(`  "${rule.statement}"\n`);

// Put two publishers under review, so there is something to close.
const subjects = ["hiogawa", "benjie"];
for (const name of subjects) {
  await store.setTrust(entityUrn("Maintainer", name) as EntityUrn, "quarantined");
}
console.log(`  Put ${subjects.join(" and ")} under review.\n`);

const before = await verifyBoundary(store, client, rule);
console.log(
  `  BEFORE   ${before.status.toUpperCase()} — ${before.paths.length}${
    before.truncated ? "+" : ""
  } routes, ${before.elapsedMs.toFixed(0)}ms`,
);

if (before.status !== "violated") {
  console.log("\n  Nothing to approve; the rule already holds.\n");
  process.exit(0);
}

// Every publisher that starts a violating route.
const publishers = [
  ...new Set(before.paths.map((path) => path.hops[0]?.from.name).filter(Boolean)),
] as string[];

console.log(`\n  ${publishers.length} publishers begin those routes:`);
for (const name of publishers.slice(0, 8)) console.log(`    ${name}`);
if (publishers.length > 8) console.log(`    …and ${publishers.length - 8} more`);

console.log("\n  Approving all of them…");
for (const name of publishers) {
  await store.setTrust(entityUrn("Maintainer", name) as EntityUrn, "trusted");
}

const after = await verifyBoundary(store, client, rule);
console.log(
  `\n  AFTER    ${after.status.toUpperCase()} — ${after.paths.length}${
    after.truncated ? "+" : ""
  } routes, ${after.elapsedMs.toFixed(0)}ms`,
);

console.log(
  after.paths.length < before.paths.length
    ? `\n  ${before.paths.length - after.paths.length} routes closed by approving publishers.` +
        (after.status === "verified"
          ? " The rule now holds."
          : " Others remain, from publishers further along the routes.")
    : "\n  No change — approving did not close anything, which is a bug.",
);

console.log("\n  Putting everything back…");
for (const name of publishers) {
  await store.setTrust(entityUrn("Maintainer", name) as EntityUrn, "untrusted");
}

const restored = await verifyBoundary(store, client, rule);
console.log(
  `  Restored. ${restored.status.toUpperCase()} — ${restored.paths.length}${
    restored.truncated ? "+" : ""
  } routes.\n`,
);
