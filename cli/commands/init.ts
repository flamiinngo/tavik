/**
 * `tavik init` — set this repository up, and prove the setup works.
 *
 * Writes the config file, then actually connects. A setup command that only
 * writes a file and says "done" leaves someone to discover in CI that their
 * token was wrong, which is the worst place to find out.
 */

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { connection, CONFIG_FILENAME, type RepoConfig } from "../config";
import { bold, dim, green, grey, heading, line, red, yellow } from "../output";
import { EXIT, runtime } from "../runtime";

const LOCKFILES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pnpm-lock.yml",
  "npm-shrinkwrap.json",
];

export interface InitOptions {
  readonly cwd: string;
  readonly service?: string;
  readonly environment?: string;
  readonly force: boolean;
}

export async function init(options: InitOptions): Promise<number> {
  const dir = resolve(options.cwd);
  const path = join(dir, CONFIG_FILENAME);

  heading("Setting up Tavik");
  line();

  if (existsSync(path) && !options.force) {
    // Not overwritten. The file may carry a team's decisions — which publishers
    // they already accepted, which environment this is — and silently replacing
    // it would drop them without a trace.
    line(`  ${yellow("·")} ${CONFIG_FILENAME} already exists. ${dim("Pass --force to replace it.")}`);
    line();
    return EXIT.ERROR;
  }

  const lockfile = LOCKFILES.find((name) => existsSync(join(dir, name)));
  const config: RepoConfig = {
    service: options.service ?? basename(dir),
    environment: options.environment ?? "production",
    ...(lockfile ? { lockfile } : {}),
    trustedPublishers: [],
    failOnUnknown: true,
  };

  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  line(`  ${green("✓")} wrote ${bold(CONFIG_FILENAME)}`);
  line(`      service      ${config.service}`);
  line(`      environment  ${config.environment}`);
  line(
    lockfile
      ? `      lockfile     ${lockfile}`
      : `      ${yellow("no lockfile found here")} ${dim("— pass --lockfile when you scan")}`,
  );
  line();

  if (!lockfile) {
    const workflows = join(dir, ".github", "workflows");
    if (existsSync(workflows)) {
      let count = 0;
      try {
        count = readdirSync(workflows).filter((name) => /\.ya?ml$/i.test(name)).length;
      } catch {
        count = 0;
      }
      if (count > 0) {
        line(`  ${grey(`${count} CI workflow file(s) here — Tavik reads those too.`)}`);
        line();
      }
    }
  }

  // ── Prove it connects ─────────────────────────────────────────────────────
  let settings;
  try {
    settings = connection();
  } catch (error) {
    line(`  ${red("✗")} ${error instanceof Error ? error.message : String(error)}`);
    line();
    line(`  ${dim("The config file is written. Set the token and run `tavik init` again")}`);
    line(`  ${dim("to confirm the connection, or just run `tavik scan`.")}`);
    line();
    return EXIT.ERROR;
  }

  try {
    const { store } = runtime(settings);
    const count = await store.countEntities();
    line(`  ${green("✓")} reached HydraDB at ${bold(settings.baseUrl)}`);
    line(
      `      ${grey(
        count === 0
          ? "the graph is empty — `tavik scan` fills it"
          : `${count.toLocaleString()} things already in the graph`,
      )}`,
    );
  } catch (error) {
    line(`  ${red("✗")} couldn't reach HydraDB at ${bold(settings.baseUrl)}`);
    line(`      ${grey(error instanceof Error ? error.message : String(error))}`);
    line();
    line(`  ${dim("Start it with `npm run hydra:up`, or point TAVIK_HYDRA_URL at yours.")}`);
    line();
    return EXIT.ERROR;
  }

  line();
  line(`  ${bold("Next:")} ${grey("`tavik scan` to map this project, then `tavik check`.")}`);
  line();
  return EXIT.OK;
}
