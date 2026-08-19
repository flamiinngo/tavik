#!/usr/bin/env tsx
/**
 * Scan a public GitHub repository from the command line.
 *
 * Usage:  npm run scan -- vercel/next.js
 *         npm run scan -- https://github.com/expressjs/express
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { entityUrn } from "../src/lib/domain/entities";
import { STARTER_RULES } from "../src/lib/domain/starter-rules";
import { RuleStore } from "../src/lib/engine/rule-store";
import { HydraClient } from "../src/lib/hydra/client";
import { GraphStore } from "../src/lib/hydra/graph-store";
import {
  fetchLockfile,
  fetchWorkflows,
  GitHubError,
  parseRepoInput,
} from "../src/lib/ingest/github";
import { parseAnyLockfile } from "../src/lib/ingest/lockfiles/index";
import { ingestProject } from "../src/lib/ingest/pipeline";
import { projectWorkflows } from "../src/lib/ingest/workflows";

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

const input = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!input) {
  console.error("\n  Usage: npm run scan -- owner/repo\n");
  process.exit(1);
}

const ref = parseRepoInput(input);
if (!ref) {
  console.error(`\n  Couldn't read "${input}" as a GitHub repository.\n`);
  process.exit(1);
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

const serviceName = `${ref.owner}/${ref.repo}`;
console.log(`\n  Scanning github.com/${serviceName}\n`);

try {
  process.stdout.write("  finding a lockfile… ");
  const lockfile = await fetchLockfile(ref);
  console.log(`${lockfile.path} on ${lockfile.ref.ref}`);

  const detected = parseAnyLockfile(lockfile.contents, lockfile.path);
  console.log(`  ${detected.graph.packages.length - 1} packages (${detected.format} lockfile)`);

  let done = 0;
  const report = await ingestProject(store, {
    lockfile: detected.graph,
    serviceName,
    environment: "production",
    trustedPublishers: new Set(),
    lockfilePath: `github.com/${serviceName}/${lockfile.path}`,
    onProgress: (stage, current, total) => {
      if (stage === "resolving-publishers" && current > done) {
        done = current;
        process.stdout.write(`\r  asking the registry who can publish… ${current}/${total}   `);
      }
    },
  });
  process.stdout.write("\n");

  process.stdout.write("  reading CI workflows… ");
  const actions = await fetchWorkflows(lockfile.ref);

  if (actions.length > 0) {
    const projection = projectWorkflows(actions, {
      serviceUrn: entityUrn("Service", serviceName),
      observedAt: Date.now(),
      trustedPublishers: new Set(),
    });
    await store.upsertEntities(projection.entities);
    await store.insertRelations(projection.relations);
    console.log(
      `${projection.actionCount} third-party actions from ${projection.publisherCount} publishers`,
    );
    if (projection.unpinnedCount > 0) {
      console.log(
        `  ${projection.unpinnedCount} of them run from a moving reference, not a fixed commit`,
      );
    }
  } else {
    console.log("none found");
  }

  const rules = new RuleStore(client);
  if ((await rules.list()).length === 0) {
    for (const rule of STARTER_RULES) await rules.save(rule);
    console.log(`  seeded ${STARTER_RULES.length} starter rules`);
  }

  console.log(`
  ${serviceName}
    packages resolved   ${report.packagesResolved.toLocaleString()}
    publishers found    ${report.maintainersFound.toLocaleString()}
    relationships       ${(report.relationsWritten + report.relationsUnchanged).toLocaleString()}
    elapsed             ${(report.elapsedMs / 1000).toFixed(0)}s
`);

  if (report.failures.length > 0) {
    console.log(
      `  ${report.failures.length} package(s) the registry couldn't answer for — their routes are missing from the graph.\n`,
    );
  }

  console.log("  Open http://localhost:3001/app to see what it found.\n");
} catch (error) {
  console.error(
    `\n  ${error instanceof GitHubError || error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
