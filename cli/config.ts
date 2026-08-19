/**
 * Where the CLI gets its settings.
 *
 * Two sources, deliberately split by what they are:
 *
 *   tavik.config.json  — facts about this repository. Which service this is,
 *                        which environment it runs in, where its lockfile lives.
 *                        Committed, reviewed, and shared by the whole team.
 *
 *   environment vars   — where the graph lives and the token to reach it.
 *                        Never committed. In CI these come from secrets.
 *
 * The split is not cosmetic. A token in a config file is a token in git history,
 * and Tavik would be a poor advertisement for supply chain security if its own
 * setup instructions leaked credentials into a public repository.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { parseRules, type RuleSpec } from "./rules-file";

export const CONFIG_FILENAME = "tavik.config.json";

export interface RepoConfig {
  /** What this project is called in the graph. Defaults to the directory name. */
  readonly service?: string;
  /** Which environment it runs in — what a rule's target selector matches. */
  readonly environment?: string;
  /** Lockfile to read. Auto-detected when absent. */
  readonly lockfile?: string;
  /** Publishers this workspace has already accepted. */
  readonly trustedPublishers?: readonly string[];
  /**
   * What must never become true, declared here rather than clicked once.
   *
   * Kept in the repository so adding a boundary is a reviewable change with a
   * diff, like any other decision a team makes about its own system. Applied to
   * the workspace on every scan and check, so the file and the dashboard cannot
   * quietly drift apart.
   */
  readonly rules?: readonly RuleSpec[];
  /**
   * Whether a rule Tavik could not check should fail the build.
   *
   * Defaults to true, which is the honest setting: "we could not check" is not
   * "it is fine", and a CI step that passes on an unchecked rule is the
   * `unknown`-collapsing-into-`verified` failure with a green tick on it.
   */
  readonly failOnUnknown?: boolean;
}

export interface Connection {
  readonly baseUrl: string;
  readonly token: string;
  readonly graphId: string;
  readonly namespace: string;
  readonly cellId: string;
  readonly timeoutMs: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Walk up from `startDir` looking for a config file.
 *
 * Same behaviour as every other tool that does this, because someone running
 * `tavik check` from a subdirectory of their own repository is not making a
 * mistake and should not be told they are.
 */
export function findConfig(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readRepoConfig(path: string): RepoConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigError(
      `Couldn't read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // Names the file and the parser's own complaint. "Invalid config" on its own
    // sends someone hunting through a file they may not have written.
    throw new ConfigError(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`${path} should contain a JSON object.`);
  }

  const config = parsed as Record<string, unknown>;

  // Checked rather than cast. A misspelled key is a silent no-op otherwise, and
  // the person is left believing they configured something they did not.
  const known = new Set([
    "service",
    "environment",
    "lockfile",
    "trustedPublishers",
    "failOnUnknown",
    "rules",
    "$schema",
  ]);
  const unknownKeys = Object.keys(config).filter((key) => !known.has(key));
  if (unknownKeys.length > 0) {
    throw new ConfigError(
      `${path} has ${unknownKeys.length === 1 ? "a setting" : "settings"} Tavik doesn't ` +
        `recognise: ${unknownKeys.join(", ")}. Known settings are ` +
        `service, environment, lockfile, trustedPublishers, failOnUnknown, rules.`,
    );
  }

  const string = (key: string): string | undefined => {
    const value = config[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new ConfigError(`${path}: "${key}" should be a string.`);
    }
    return value;
  };

  const trusted = config.trustedPublishers;
  if (trusted !== undefined) {
    if (!Array.isArray(trusted) || trusted.some((entry) => typeof entry !== "string")) {
      throw new ConfigError(`${path}: "trustedPublishers" should be a list of names.`);
    }
  }

  if (config.failOnUnknown !== undefined && typeof config.failOnUnknown !== "boolean") {
    throw new ConfigError(`${path}: "failOnUnknown" should be true or false.`);
  }

  return {
    service: string("service"),
    environment: string("environment"),
    lockfile: string("lockfile"),
    trustedPublishers: trusted as readonly string[] | undefined,
    failOnUnknown: config.failOnUnknown as boolean | undefined,
    rules: parseRules(config.rules, path),
  };
}

/**
 * Load `.env.local` if one is sitting next to the config.
 *
 * Convenience for someone running the CLI against their own local HydraDB, which
 * `npm run hydra:setup` has already configured. Real environment variables win,
 * so CI is never surprised by a file that happened to be checked out.
 */
export function loadDotEnv(dir: string): void {
  const path = join(dir, ".env.local");
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
}

/**
 * Where the graph lives.
 *
 * `TAVIK_*` names are checked first so a team can point the CLI somewhere
 * different from whatever a local `.env.local` says, without editing files. The
 * `HYDRA_*` names are the app's own, kept working so that a laptop that already
 * runs the dashboard needs no extra setup at all.
 */
export function connection(): Connection {
  const pick = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = process.env[name];
      if (value !== undefined && value !== "") return value;
    }
    return undefined;
  };

  const token = pick("TAVIK_HYDRA_TOKEN", "HYDRA_TOKEN");
  if (!token) {
    throw new ConfigError(
      "No HydraDB token. Set TAVIK_HYDRA_TOKEN (in CI, from a secret), or run " +
        "`npm run hydra:setup` if this is your own machine.",
    );
  }

  const timeoutRaw = pick("TAVIK_HYDRA_TIMEOUT_MS", "HYDRA_TIMEOUT_MS");
  const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : 120_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigError(`Timeout must be a positive number of milliseconds, got "${timeoutRaw}".`);
  }

  return {
    baseUrl: pick("TAVIK_HYDRA_URL", "HYDRA_URL") ?? "http://127.0.0.1:8443",
    token,
    graphId: pick("TAVIK_HYDRA_GRAPH_ID", "HYDRA_GRAPH_ID") ?? "default",
    namespace: pick("TAVIK_HYDRA_NAMESPACE", "HYDRA_NAMESPACE") ?? "default",
    cellId: pick("TAVIK_HYDRA_CELL_ID", "HYDRA_CELL_ID") ?? "cell-0",
    // Generous by default. A first scan of a large lockfile is genuinely slow,
    // and a timeout mid-write leaves a half-populated graph, which is the one
    // state that produces confidently wrong answers.
    timeoutMs,
  };
}

/**
 * Who is running this.
 *
 * The work log names people, so the CLI has to supply a name too — otherwise
 * every entry that came from CI is anonymous, which is exactly the gap the
 * named-operator work closed on the dashboard side. In GitHub Actions the actor
 * is already in the environment, so the common case needs no configuration.
 */
export function operatorName(explicit?: string): string {
  const fromEnv =
    process.env.TAVIK_OPERATOR ??
    (process.env.GITHUB_ACTOR ? `${process.env.GITHUB_ACTOR} (via CI)` : undefined);

  return (explicit ?? fromEnv ?? "Tavik CLI").trim().slice(0, 60);
}
