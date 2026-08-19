/**
 * `tavik rules add` — declare a boundary from the terminal.
 *
 * Writes into `tavik.config.json` rather than straight to the database. The
 * point is the diff: a new boundary becomes a line somebody reviews in a pull
 * request, like every other decision a team makes about its own system. Saving
 * it only to the workspace would make it something one person clicked once, with
 * nothing to review and nothing to explain it later.
 *
 * It also saves to the workspace, so the rule answers immediately rather than
 * waiting for the next scan.
 *
 * Asks questions when a person is there to answer them, and takes flags when
 * one is not. A wizard that blocks forever on a CI runner with no terminal is a
 * hung build, so the absence of a TTY is treated as a clear error rather than
 * something to wait on.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join, resolve } from "node:path";

import { ruleIdFromName } from "../../src/lib/engine/rule-store";
import { connection, CONFIG_FILENAME, ConfigError, findConfig } from "../config";
import { bold, dim, green, grey, heading, line, yellow } from "../output";
import { EXIT, runtime } from "../runtime";
import { ALL_SOURCES, ALL_TARGETS, compileRule, type RuleSpec } from "../rules-file";

export interface RulesAddOptions {
  readonly cwd: string;
  readonly name?: string;
  readonly from?: string;
  readonly to?: string;
  readonly maxHops?: number;
}

export async function addRule(options: RulesAddOptions): Promise<number> {
  const configPath = findConfig(options.cwd) ?? join(resolve(options.cwd), CONFIG_FILENAME);

  const spec = await gather(options);

  // ── Write it to the file ──────────────────────────────────────────────────
  const config = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>)
    : {};

  const rules = Array.isArray(config.rules) ? [...(config.rules as RuleSpec[])] : [];
  const id = ruleIdFromName(spec.name);
  const replacing = rules.findIndex((rule) => ruleIdFromName(rule.name) === id);

  if (replacing >= 0) rules[replacing] = spec;
  else rules.push(spec);

  writeFileSync(configPath, `${JSON.stringify({ ...config, rules }, null, 2)}\n`, "utf8");

  heading(replacing >= 0 ? "Updated a rule" : "Added a rule");
  line();
  line(`  ${green("✓")} ${bold(spec.name)}`);
  line(`      ${compileRule(spec).statement}`);
  line(`      ${grey(`in ${CONFIG_FILENAME} — commit it, and the whole team has it`)}`);
  line();

  // ── And make it answer now ────────────────────────────────────────────────
  //
  // Secondary to the file. Somebody who has just written a rule should be able
  // to run `tavik check` immediately, but a database that happens to be down
  // must not lose the rule they wrote.
  try {
    const { rules: store } = runtime(connection());
    await store.save(compileRule(spec));
    line(`  ${grey("Saved to your workspace too. Run `tavik check` to answer it.")}`);
  } catch (error) {
    line(
      `  ${yellow("·")} ${dim(
        `Couldn't reach HydraDB, so it isn't live yet: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )}`,
    );
    line(`  ${dim("The rule is safely in the file. The next `tavik check` will apply it.")}`);
  }
  line();

  return EXIT.OK;
}

async function gather(options: RulesAddOptions): Promise<RuleSpec> {
  // Fully specified on the command line: no questions, which is what a script
  // or a CI job needs.
  if (options.name && options.from && options.to) {
    return validated(options.name, options.from, options.to, options.maxHops);
  }

  if (!process.stdin.isTTY) {
    throw new ConfigError(
      "There's no terminal here to ask questions in. Pass the rule instead:\n" +
        `    tavik rules add --name "No unapproved publishers" --from outside-publishers --to production\n\n` +
        `  from: ${ALL_SOURCES.map((preset) => preset.id).join(", ")}\n` +
        `  to:   ${ALL_TARGETS.map((preset) => preset.id).join(", ")}`,
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    heading("What must never become true?");
    line();
    line(`  ${dim("A rule is one claim: nothing over here should be able to reach")}`);
    line(`  ${dim("anything over there. Tavik proves it, and keeps proving it.")}`);
    line();

    const from = options.from ?? (await choose(rl, "What are you worried about?", ALL_SOURCES));
    const to = options.to ?? (await choose(rl, "What should it never reach?", ALL_TARGETS));

    const suggested = compileRule({ name: "placeholder", from, to }).statement;
    line();
    line(`  ${dim("Your rule reads:")}`);
    line(`  ${bold(suggested)}`);
    line();

    const name = options.name ?? (await ask(rl, "  Call it what?", defaultName(from)));

    const hopsAnswer = await ask(rl, "  How many steps should Tavik follow?", "8");
    const maxHops = Number.parseInt(hopsAnswer, 10);

    return validated(name, from, to, Number.isFinite(maxHops) ? maxHops : 8);
  } finally {
    rl.close();
  }
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
  fallback: string,
): Promise<string> {
  const answer = await rl.question(`${question} ${grey(`(${fallback})`)} `);
  return answer.trim() || fallback;
}

/**
 * A numbered list rather than free text.
 *
 * The vocabulary is closed — every option is backed by a property ingestion
 * actually writes — so offering free text would only let someone describe a rule
 * Tavik cannot answer, which reports `unknown` forever and reads as a broken
 * product rather than an unanswerable question.
 */
async function choose(
  rl: ReturnType<typeof createInterface>,
  question: string,
  presets: readonly { id: string; label: string; hint: string }[],
): Promise<string> {
  line(`  ${bold(question)}`);
  line();
  presets.forEach((preset, index) => {
    line(`    ${bold(String(index + 1))}  ${preset.label}`);
    line(`       ${grey(preset.hint)}`);
  });
  line();

  for (;;) {
    const answer = (await rl.question(`  ${grey("1")}–${grey(String(presets.length))}: `)).trim();
    const index = Number.parseInt(answer, 10) - 1;
    if (index >= 0 && index < presets.length) {
      line();
      return presets[index].id;
    }
    // Named ids work too, for anyone who already knows them.
    const byId = presets.find((preset) => preset.id === answer);
    if (byId) {
      line();
      return byId.id;
    }
    line(`  ${yellow(`Pick a number between 1 and ${presets.length}.`)}`);
  }
}

function defaultName(from: string): string {
  return ALL_SOURCES.find((preset) => preset.id === from)?.label ?? "New rule";
}

function validated(name: string, from: string, to: string, maxHops?: number): RuleSpec {
  if (!ALL_SOURCES.some((preset) => preset.id === from)) {
    throw new ConfigError(
      `"${from}" isn't something Tavik can start a rule from. ` +
        `Options: ${ALL_SOURCES.map((preset) => preset.id).join(", ")}.`,
    );
  }
  if (!ALL_TARGETS.some((preset) => preset.id === to)) {
    throw new ConfigError(
      `"${to}" isn't something Tavik can protect. ` +
        `Options: ${ALL_TARGETS.map((preset) => preset.id).join(", ")}.`,
    );
  }
  const hops = maxHops ?? 8;
  if (hops < 1 || hops > 12) {
    throw new ConfigError(`Steps should be between 1 and 12, got ${hops}.`);
  }
  return { name: name.trim(), from, to, maxHops: hops };
}
