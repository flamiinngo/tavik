#!/usr/bin/env node
/**
 * Delete the local HydraDB volume.
 *
 * Used by `npm run reset` between stopping and restarting the container. A full
 * reset by query is possible but slow and self-defeating: HydraDB enforces a 30s
 * server-side query timeout, and mass deletes leave enough tombstones to degrade
 * every subsequent read — the exact problem that once took a boundary check from
 * 420ms to 31s. Throwing the volume away costs a few seconds and leaves a
 * genuinely clean store.
 *
 * Only ever touches ./.hydradb-data, which is gitignored and holds nothing that
 * cannot be rebuilt by scanning again.
 */

import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(projectRoot, ".hydradb-data");

if (!existsSync(dataDir)) {
  console.log("• No local HydraDB data to remove.");
  process.exit(0);
}

await rm(dataDir, { recursive: true, force: true });
console.log("• Removed the local HydraDB volume.");
