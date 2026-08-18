#!/usr/bin/env node
/**
 * Wait for HydraDB to answer queries.
 *
 * Readiness is checked from the host rather than by a container healthcheck: the
 * HydraDB image is minimal and ships neither curl nor wget, so nothing inside it
 * can run a probe. Polling from here is also a stronger signal — it proves the
 * query endpoint Tavik actually uses is answering and authenticating, not just
 * that a TCP port is listening.
 *
 * Run:  npm run hydra:wait   (invoked automatically by `npm run hydra:up`)
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 90_000;
const INTERVAL_MS = 1_000;

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

const startedAt = Date.now();
let lastError = "no attempt made";

process.stdout.write("Waiting for HydraDB");

while (Date.now() - startedAt < TIMEOUT_MS) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.HYDRA_TOKEN}`,
        "X-Graph-Namespace": env.HYDRA_NAMESPACE ?? "default",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cell_id: env.HYDRA_CELL_ID ?? "cell-0",
        // A bare `RETURN 1` is refused: the server only executes
        // `MATCH ... RETURN`. Counting a label works on an empty graph too, so
        // readiness does not depend on anything having been ingested yet.
        query: "MATCH (n:Entity) RETURN count(*) AS total",
      }),
    });

    if (response.ok) {
      console.log(`\nHydraDB is ready (${Date.now() - startedAt}ms).`);
      process.exit(0);
    }

    // A 401/403 means the server is up but the token is wrong — retrying will
    // never fix that, so fail immediately with something actionable.
    if (response.status === 401 || response.status === 403) {
      console.error(
        `\nHydraDB rejected the auth token (HTTP ${response.status}).\n` +
          `The token in .env.local must match .hydradb-data/auth-token. ` +
          `Re-run \`npm run hydra:setup\` and restart the container:\n\n` +
          `  npm run hydra:down && npm run hydra:up\n`,
      );
      process.exit(1);
    }

    lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  process.stdout.write(".");
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}

console.error(
  `\nHydraDB did not become ready within ${TIMEOUT_MS / 1000}s.\n` +
    `Last error: ${lastError}\n\n` +
    `Check the container logs with:  npm run hydra:logs\n`,
);
process.exit(1);
