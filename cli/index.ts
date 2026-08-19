/**
 * Tavik on the command line.
 *
 * The same engine the dashboard uses, against the same graph, so that a boundary
 * can be enforced where changes actually happen — in a pull request, before it
 * merges — rather than only being observed on a screen afterwards.
 *
 * Hand-rolled argument parsing. It is about eighty lines, and a security tool
 * that asks a team to think about who can reach their code through their
 * dependencies should not add a dependency tree to read `--json`.
 */

import { dirname } from "node:path";

import { approve } from "./commands/approve";
import { check } from "./commands/check";
import { init } from "./commands/init";
import { listRules } from "./commands/rules";
import { addRule } from "./commands/rules-add";
import { removeRule } from "./commands/rules-remove";
import { scan } from "./commands/scan";
import {
  ConfigError,
  findConfig,
  loadDotEnv,
  operatorName,
  readRepoConfig,
  type RepoConfig,
} from "./config";
import { bold, dim, errorLine, grey, line, red } from "./output";
import { EXIT } from "./runtime";

const USAGE = `
  ${bold("tavik")} — continuous security boundary verification

  ${bold("Commands")}
    init                    Set this repository up, and prove the connection works
    scan                    Read this project into the graph
    check                   Verify every rule. ${dim("Exits non-zero when one breaks.")}
    rules                   List what this workspace has declared
    rules add               Declare a new boundary, and write it to the config
    rules remove <id>       Stop enforcing one
    approve <publisher>...  Put an account on the approved publisher list
    review <publisher>...   Put an account under review instead
    unapprove <publisher>.. Take an account back off the approved list

  ${bold("Options")}
    --json                  Machine-readable output
    --repo owner/name       Scan a GitHub repository instead of this directory
    --lockfile <path>       Use this lockfile rather than the detected one
    --service <name>        What to call this project in the graph
    --environment <name>    Which environment it runs in ${dim("(default: production)")}
    --rule <id>             Check one rule instead of all of them
    --name --from --to      Declare a rule without being asked ${dim("(rules add)")}
    --allow-unchecked       Don't fail the build on a rule that couldn't be checked
    --as "<name>"           Who to record this as ${dim("(default: $TAVIK_OPERATOR, or the CI actor)")}
    --routes <n>            How many routes to print per broken rule ${dim("(default: 3)")}
    --summary <path>        Also write a markdown report there ${dim("(CI uses $GITHUB_STEP_SUMMARY)")}
    --force                 Overwrite an existing config on init
    --help, --version

  ${bold("Connection")} ${dim("— from the environment, never from a file")}
    TAVIK_HYDRA_TOKEN       Required. In CI, from a secret.
    TAVIK_HYDRA_URL         Default http://127.0.0.1:8443

  ${bold("Exit codes")}
    0  every rule was checked and holds
    1  a rule has a way through
    2  a rule could not be checked ${dim("— \"not checked\" is not \"safe\"")}
    3  Tavik could not run at all
`;

interface Args {
  readonly command: string | undefined;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

function parse(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const [name, inline] = splitOnce(token.slice(2), "=");
    if (inline !== undefined) {
      flags[name] = inline;
      continue;
    }

    // A flag that takes a value consumes the next token unless that token is
    // itself a flag, which keeps `--json --rule x` from swallowing `--rule`.
    const next = argv[i + 1];
    if (VALUE_FLAGS.has(name) && next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }

  return { command: positional[0], positional: positional.slice(1), flags };
}

const VALUE_FLAGS = new Set([
  "name",
  "from",
  "to",
  "hops",
  "repo",
  "lockfile",
  "service",
  "environment",
  "rule",
  "as",
  "routes",
  "config",
  "summary",
]);

function splitOnce(text: string, separator: string): [string, string | undefined] {
  const index = text.indexOf(separator);
  if (index === -1) return [text, undefined];
  return [text.slice(0, index), text.slice(index + 1)];
}

function str(flags: Args["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function num(flags: Args["flags"], name: string, fallback: number): number {
  const raw = str(flags, name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ConfigError(`--${name} should be a number, got "${raw}".`);
  }
  return parsed;
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parse(argv);
  const { flags } = args;

  // Version before help. `--version` carries no command, so the "nothing to do,
  // show usage" branch below was swallowing it and printing the whole help text.
  if (flags.version === true || args.command === "version") {
    line("tavik 0.1.0");
    return EXIT.OK;
  }

  if (flags.help === true || args.command === "help" || args.command === undefined) {
    line(USAGE);
    return args.command === undefined && flags.help !== true ? EXIT.USAGE : EXIT.OK;
  }

  const cwd = process.cwd();
  const json = flags.json === true;

  // Config is optional everywhere. Someone should be able to point the CLI at a
  // repository and get an answer before deciding whether to commit a file to it.
  const configPath = str(flags, "config") ?? findConfig(cwd);
  const config: RepoConfig = configPath ? readRepoConfig(configPath) : {};

  // Convenience for a laptop that already runs the dashboard: pick up the
  // token `npm run hydra:setup` wrote. Real environment variables still win, so
  // CI is never surprised by a file that happened to be checked out.
  loadDotEnv(configPath ? dirname(configPath) : cwd);

  const operator = operatorName(str(flags, "as"));

  switch (args.command) {
    case "init":
      return init({
        cwd,
        service: str(flags, "service"),
        environment: str(flags, "environment"),
        force: flags.force === true,
      });

    case "scan":
      return scan({
        config,
        cwd,
        repo: str(flags, "repo"),
        lockfile: str(flags, "lockfile"),
        service: str(flags, "service"),
        environment: str(flags, "environment"),
        json,
      });

    case "check":
      return check({
        config,
        ruleId: str(flags, "rule"),
        json,
        // The config file is the team's standing decision; the flag is one run's
        // override. Defaults to failing, which is the honest setting.
        failOnUnknown: failOnUnchecked(),
        operator,
        showPaths: num(flags, "routes", 3),
        // GitHub sets GITHUB_STEP_SUMMARY itself, so CI needs no extra flag.
        summaryPath: str(flags, "summary") ?? process.env.GITHUB_STEP_SUMMARY,
      });

    case "rules": {
      const sub = args.positional[0];
      if (sub === "add") {
        return addRule({
          cwd,
          name: str(flags, "name"),
          from: str(flags, "from"),
          to: str(flags, "to"),
          maxHops: str(flags, "hops") === undefined ? undefined : num(flags, "hops", 8),
        });
      }
      if (sub === "remove" || sub === "rm") {
        const id = args.positional[1];
        if (!id) {
          errorLine(`  Which rule? ${grey("e.g. tavik rules remove abandoned-code")}`);
          return EXIT.USAGE;
        }
        return removeRule(cwd, id);
      }
      if (sub !== undefined) {
        errorLine(`  ${red(`No such thing as \`tavik rules ${sub}\`.`)}`);
        errorLine(`  ${grey("Try `tavik rules`, `tavik rules add`, or `tavik rules remove <id>`.")}`);
        return EXIT.USAGE;
      }
      return listRules(json);
    }

    case "approve":
    case "review":
    case "unapprove":
      if (args.positional.length === 0) {
        errorLine(`  Which publisher? ${grey(`e.g. tavik ${args.command} sindresorhus`)}`);
        return EXIT.USAGE;
      }
      return approve({
        publishers: args.positional,
        trust:
          args.command === "approve"
            ? "trusted"
            : args.command === "review"
              ? "quarantined"
              : // Back to simply not being on the list — which is where every
                // account starts, and is a fact about the list rather than about
                // the person.
                "untrusted",
        operator,
        json,
      });

    default:
      errorLine(`  ${red(`Unknown command "${args.command}".`)}`);
      errorLine(`  ${grey("Run `tavik --help` to see what there is.")}`);
      return EXIT.USAGE;
  }

  function failOnUnchecked(): boolean {
    if (flags["allow-unchecked"] === true) return false;
    return config.failOnUnknown ?? true;
  }
}
