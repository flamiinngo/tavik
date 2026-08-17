#!/usr/bin/env tsx
/**
 * Build Tavik's security state from real sources.
 *
 * Reads a real `package-lock.json`, resolves publish rights from the live public
 * npm registry, and writes the resulting graph to HydraDB. No fixtures, no
 * synthetic data — by default it ingests this repository's own dependencies, so
 * the first service Tavik protects is Tavik itself.
 *
 * Usage:
 *   npm run ingest
 *   npm run ingest -- --lockfile ../other-project/package-lock.json --service checkout-api
 *   npm run ingest -- --trust our-ci-bot,security-team
 *
 * Requires HydraDB: `npm run hydra:up`.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HydraClient } from "../src/lib/hydra/client";
import { GraphStore } from "../src/lib/hydra/graph-store";
import { ingestProject } from "../src/lib/ingest/pipeline";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function loadEnv(): Record<string, string> {
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
  return env;
}

const env = loadEnv();
const lockfilePath = resolve(projectRoot, arg("lockfile", "package-lock.json")!);
const environment = arg("environment", "production")!;
const serviceName = arg("service");
const trustedPublishers = new Set(
  (arg("trust", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);

if (!existsSync(lockfilePath)) {
  console.error(`No lockfile at ${lockfilePath}`);
  process.exit(1);
}

const client = new HydraClient({
  baseUrl: env.HYDRA_URL ?? "http://127.0.0.1:8443",
  token: env.HYDRA_TOKEN,
  graphId: env.HYDRA_GRAPH_ID ?? "default",
  namespace: env.HYDRA_NAMESPACE ?? "default",
  cellId: env.HYDRA_CELL_ID ?? "cell-0",
  timeoutMs: 60_000,
});
const store = new GraphStore(client);

try {
  await client.ping();
} catch (error) {
  console.error(
    `Cannot reach HydraDB. Start it with \`npm run hydra:up\`.\n${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}

console.log(`\nIngesting ${lockfilePath}`);
console.log(`  environment      ${environment}`);
console.log(
  `  trusted publishers ${trustedPublishers.size > 0 ? [...trustedPublishers].join(", ") : "(none — every external publisher is off-allowlist)"}\n`,
);

let lastStage = "";
const report = await ingestProject(store, {
  lockfile: JSON.parse(readFileSync(lockfilePath, "utf8")),
  serviceName,
  environment,
  trustedPublishers,
  lockfilePath: arg("lockfile", "package-lock.json")!,
  onProgress: (stage, done, total) => {
    if (stage !== lastStage) {
      if (lastStage) process.stdout.write("\n");
      process.stdout.write(`  ${stage.replace(/-/g, " ")} `);
      lastStage = stage;
    }
    if (stage === "resolving-publishers" && total > 0) {
      process.stdout.write(`\r  resolving publishers  ${done}/${total}   `);
    }
  },
});
process.stdout.write("\n\n");

console.log("Security state written to HydraDB");
console.log(`  service            ${report.serviceUrn}`);
console.log(`  entities           ${report.entitiesWritten.toLocaleString()}`);
console.log(`  relationships      ${report.relationsWritten.toLocaleString()}`);
console.log(`  packages resolved  ${report.packagesResolved.toLocaleString()}`);
console.log(`  publishers found   ${report.maintainersFound.toLocaleString()}`);
console.log(`  off-allowlist      ${report.untrustedMaintainers.toLocaleString()}`);
console.log(`  elapsed            ${(report.elapsedMs / 1000).toFixed(1)}s`);

if (report.unresolvedDependencies > 0) {
  console.log(
    `\n  note: ${report.unresolvedDependencies} dependency reference(s) did not resolve to a ` +
      `lockfile entry (usually optional or platform-specific packages).`,
  );
}

if (report.failures.length > 0) {
  console.log(`\n  ${report.failures.length} package(s) the registry could not answer for:`);
  for (const failure of report.failures.slice(0, 10)) {
    console.log(`    ${failure.packageName}: ${failure.reason}`);
  }
  if (report.failures.length > 10) {
    console.log(`    ... and ${report.failures.length - 10} more`);
  }
}

// The headline finding. Factual, not accusatory: an account able to publish to
// many of your dependencies is a single point of failure whether or not anything
// has gone wrong. These are real accounts and are described only by whether they
// appear on this workspace's allowlist.
console.log("\nPublisher concentration — accounts able to publish into this tree:\n");
console.log("  PACKAGES  ALLOWLIST     PUBLISHER");
for (const row of report.concentration.slice(0, 12)) {
  console.log(
    `  ${String(row.packages.length).padStart(8)}  ${(row.trust === "trusted" ? "on" : "off").padEnd(12)}  ${row.maintainer}`,
  );
}

console.log(
  `\n${report.concentration.length} publisher(s) in total. ` +
    `Run \`npm run dev\` to explore the graph.\n`,
);
