#!/usr/bin/env node
/**
 * The `tavik` executable.
 *
 * Thin on purpose: everything real lives in `cli/`, which is TypeScript and
 * shares the engine with the app. This file exists to give that a name a shell
 * can run, to turn a returned exit code into a real one, and to make sure a
 * failure prints something a person can act on rather than a stack trace.
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// tsx runs the TypeScript directly, so there is no build step between editing
// the CLI and running it, and no compiled copy that can drift from the source
// the tests cover.
const result = spawnSync(
  process.execPath,
  [join(root, "node_modules", "tsx", "dist", "cli.mjs"), join(root, "cli", "main.ts"), ...process.argv.slice(2)],
  {
    stdio: "inherit",
    // The user's directory, not Tavik's: `tavik scan` reads the lockfile of
    // wherever it was run, which is the whole reason the CLI exists.
    cwd: process.cwd(),
    env: {
      ...process.env,
      // tsx finds tsconfig.json from the working directory, so running from
      // another project left the `@/` path alias unresolved and the CLI died
      // with a module-not-found stack trace before it could print anything
      // useful. Pointing it at Tavik's own tsconfig makes the aliases resolve
      // from anywhere, which is the only way this is usable in someone else's
      // repository — the primary case.
      TSX_TSCONFIG_PATH: join(root, "tsconfig.json"),
    },
  },
);

if (result.error) {
  process.stderr.write(
    `tavik could not start: ${result.error.message}\n` +
      `Run \`npm install\` in ${root} first.\n`,
  );
  process.exit(3);
}

process.exit(result.status ?? 3);
