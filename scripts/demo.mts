#!/usr/bin/env tsx
/**
 * The whole product loop, on the command line.
 *
 * GREEN → RED → GREEN against the real graph, printing each step so the claim
 * can be checked without opening a browser. Everything here is a real mutation
 * and a real re-computation; nothing is simulated.
 *
 * The scenario is one a security team actually runs: a publisher is placed under
 * review, which quarantines their code until the review completes. Tavik then
 * shows exactly what that code reaches, and the fix is either to remove the
 * dependency or to finish the review.
 *
 * Note on naming: these are real npm accounts. Quarantine describes *our*
 * process — pausing something pending review — and never implies anything about
 * the person. Nothing in this product accuses a real publisher of anything.
 *
 * Usage:  npm run demo
 *         npm run demo -- --publisher hirokiosame
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SecurityBoundary } from "../src/lib/domain/boundary";
import { entityUrn, type EntityUrn } from "../src/lib/domain/entities";
import { HydraClient } from "../src/lib/hydra/client";
import { GraphStore } from "../src/lib/hydra/graph-store";
import { verifyBoundary } from "../src/lib/engine/verify";
import { proposeRemediations } from "../src/lib/engine/remediation";

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

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const publisher = arg("publisher", "sebmarkbage");

const client = new HydraClient({
  baseUrl: env.HYDRA_URL,
  token: env.HYDRA_TOKEN,
  graphId: env.HYDRA_GRAPH_ID,
  namespace: env.HYDRA_NAMESPACE,
  cellId: env.HYDRA_CELL_ID,
  timeoutMs: 120_000,
});
const store = new GraphStore(client);

const boundary: SecurityBoundary = {
  id: "blocked-publishers",
  name: "Quarantined publishers",
  statement:
    "While a publisher is under review, none of their code should be reaching production.",
  source: {
    kind: "Maintainer",
    property: "trust",
    value: "quarantined",
    description: "publishers we have paused pending review",
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

const step = (n: number, label: string) =>
  console.log(`\n${"─".repeat(70)}\n  ${n}.  ${label}\n${"─".repeat(70)}`);

const report = (v: Awaited<ReturnType<typeof verifyBoundary>>) => {
  const badge =
    v.status === "verified" ? "GREEN  ✓" : v.status === "violated" ? "RED    ✗" : "GREY   ?";
  console.log(
    `  ${badge}   ${v.paths.length}${v.truncated ? "+" : ""} route(s)   ${v.elapsedMs.toFixed(0)}ms`,
  );
  if (v.failureReason) console.log(`  ${v.failureReason}`);
};

console.log(`\n  TAVIK — ${boundary.name}`);
console.log(`  "${boundary.statement}"`);

// Make sure we start from a clean slate.
const urn = entityUrn("Maintainer", publisher) as EntityUrn;
const exists = await store.getEntity(urn);
if (!exists) {
  console.error(`\n  No publisher called ${publisher} in the graph. Run \`npm run ingest\` first.\n`);
  process.exit(1);
}
await store.setTrust(urn, "untrusted");

// ── 1 ───────────────────────────────────────────────────────────────────────
step(1, "Right now, the boundary holds");
report(await verifyBoundary(store, client, boundary));
console.log("  Nobody is under review, so nothing is quarantined.");

// ── 2 ───────────────────────────────────────────────────────────────────────
step(2, `Something changes: ${publisher} is placed under review`);
await store.setTrust(urn, "quarantined");
console.log(`  ${publisher}'s trust label is now 'quarantined' in the graph.`);

// ── 3 ───────────────────────────────────────────────────────────────────────
step(3, "Tavik re-checks — same query, changed world");
const violated = await verifyBoundary(store, client, boundary);
report(violated);

if (violated.status !== "violated") {
  console.log("\n  Expected a violation. Has the graph been ingested?\n");
  await store.setTrust(urn, "untrusted");
  process.exit(1);
}

for (const [index, path] of violated.paths.entries()) {
  console.log(`\n  Route ${index + 1} (${path.length} hops):`);
  console.log(`    ${path.hops[0].from.name}`);
  for (const hop of path.hops) {
    console.log(`      --${hop.relation.toLowerCase()}--> ${hop.to.name}`);
  }
}

// ── 4 ───────────────────────────────────────────────────────────────────────
step(4, "Tavik proposes a fix");
const proposals = proposeRemediations(boundary, violated, 3);
proposals.forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.summary}`);
  console.log(
    `     closes ${p.routesRemoved} of ${p.routesRemoved + p.routesRemaining}` +
      (p.routesRemaining === 0 ? "  — fixes it completely" : "") +
      (p.sampled ? "  (sampled: more routes exist)" : ""),
  );
  console.log(`     cost: ${p.consequence}`);
});

// ── 5 & 6 ───────────────────────────────────────────────────────────────────
//
// Applied one at a time until the boundary closes. A publisher can reach
// production by several independent routes, and closing one leaves the others
// standing — which is exactly why Tavik re-checks after every change instead of
// declaring victory after the first. Each pass is a real deletion followed by a
// real re-computation.
step(5, "A human approves each change. Tavik applies and re-checks");

const applied: typeof proposals = [];
let current = violated;

for (let round = 1; round <= 6; round++) {
  const next = proposeRemediations(boundary, current, 1)[0];
  if (!next) break;

  console.log(`\n  Round ${round}: ${next.summary}`);
  await store.deleteRelation(next.from, next.to, next.relation);
  applied.push(next);

  current = await verifyBoundary(store, client, boundary);
  process.stdout.write("  → ");
  report(current);

  if (current.status === "verified") break;
}

step(6, "Result");
report(current);
console.log(
  current.status === "verified"
    ? `\n  Boundary restored after ${applied.length} change(s). No route remains.\n` +
        "  Proven by re-running the same query that found the problem."
    : `\n  ${violated.paths.length - current.paths.length} route(s) removed, ${current.paths.length} remain.`,
);

// ── Restore, so the demo can be run again ───────────────────────────────────
step(7, "Resetting so this can be run again");
await store.insertRelations(
  applied.map((proposal) => ({
    from: proposal.from,
    to: proposal.to,
    kind: proposal.relation,
    source: "demo" as const,
    observedAt: Date.now(),
    evidence: "restored by npm run demo",
  })),
);
await store.setTrust(urn, "untrusted");
console.log(`  ${applied.length} relationship(s) and the trust label restored.\n`);
