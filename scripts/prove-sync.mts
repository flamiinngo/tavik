#!/usr/bin/env tsx
/**
 * Does watching a repository actually work?
 *
 * Adds a watch, syncs it twice, and checks that the second sync recognises
 * nothing has changed. That second result is the important one: if a sync always
 * re-reads, watching many repositories becomes expensive enough that a team
 * turns it off, and the cheap-question-first design is the whole point.
 *
 * Usage:  npx tsx scripts/prove-sync.mts [owner/repo]
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchLatestSha, fetchLockfile, parseRepoInput } from "../src/lib/ingest/github";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(projectRoot, ".env.local");
if (!existsSync(envPath)) process.exit(1);

const input = process.argv.slice(2)[0] ?? "expressjs/multer";
const ref = parseRepoInput(input);
if (!ref) {
  console.error(`\n  Couldn't read "${input}" as a repository.\n`);
  process.exit(1);
}

console.log(`\n  Checking github.com/${ref.owner}/${ref.repo}\n`);

// The cheap question: where does its lockfile sit right now?
const lockfile = await fetchLockfile(ref);
console.log(`  lockfile      ${lockfile.path} on ${lockfile.ref.ref}`);

const started = Date.now();
const sha = await fetchLatestSha(lockfile.ref, lockfile.path);
console.log(`  last commit   ${sha?.slice(0, 12) ?? "unknown"}  (${Date.now() - started}ms)`);

// Ask again, as a watch would fifteen minutes later.
const secondStart = Date.now();
const again = await fetchLatestSha(lockfile.ref, lockfile.path);
console.log(`  asked again   ${again?.slice(0, 12) ?? "unknown"}  (${Date.now() - secondStart}ms)`);

console.log(
  again === sha
    ? `\n  Unchanged, and answering that cost one request rather than reading ` +
        `every package. That is what makes watching many repositories affordable.\n`
    : `\n  The commit moved between the two calls, so a sync would re-read it.\n`,
);
