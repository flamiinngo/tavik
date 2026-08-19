/**
 * `tavik check` — do the rules still hold?
 *
 * The command the whole CLI exists for. Run it in CI and a pull request that
 * opens a route into production stops being something someone notices later.
 *
 * It verifies with the same function the dashboard calls, against the same
 * graph, and writes its verdict to the same work log — so a failure here is
 * visible to the whole team on the dashboard within seconds, attributed to
 * whoever pushed.
 */

import { appendFileSync } from "node:fs";

import { summarisePath } from "../../src/lib/domain/change";
import type { SecurityBoundary } from "../../src/lib/domain/boundary";
import { verifyBoundary } from "../../src/lib/engine/verify";
import type { BoundaryVerification } from "../../src/lib/domain/boundary";
import { applyRules, type AppliedRules } from "../apply-rules";
import { connection, CONFIG_FILENAME, type RepoConfig } from "../config";
import {
  bold,
  dim,
  duration,
  green,
  grey,
  heading,
  line,
  plural,
  red,
  renderPath,
  statusBadge,
  yellow,
} from "../output";
import { EXIT, runtime } from "../runtime";
import { renderMarkdownSummary } from "../summary";

export interface CheckOptions {
  readonly config: RepoConfig;
  readonly ruleId?: string;
  readonly json: boolean;
  readonly failOnUnknown: boolean;
  readonly operator: string;
  /** How many routes to print per broken rule. The rest are counted. */
  readonly showPaths: number;
  /**
   * Write a markdown report here as well as printing the usual output.
   *
   * In GitHub Actions this is `$GITHUB_STEP_SUMMARY`, which renders on the run
   * page without needing a token or any permission — so it works on a fork's
   * pull request, where posting a comment would silently fail.
   */
  readonly summaryPath?: string;
}

interface RuleOutcome {
  readonly rule: SecurityBoundary;
  readonly verification: BoundaryVerification;
}

export async function check(options: CheckOptions): Promise<number> {
  const { store, client, rules, changeLog } = runtime(connection());

  // The file first, so what gets checked is what the repository says — a rule
  // added in a pull request takes effect on that build, with no separate step
  // to remember.
  let applied: AppliedRules | null = null;
  if (options.config.rules && options.config.rules.length > 0) {
    applied = await applyRules(rules, options.config.rules);
  }

  let declared: readonly SecurityBoundary[];
  try {
    declared = await rules.list();
  } catch (error) {
    // Cannot reach the graph. Deliberately not reported as "everything holds".
    throw new Error(
      `Couldn't read your rules from HydraDB: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const selected = options.ruleId
    ? declared.filter((rule) => rule.id === options.ruleId)
    : declared;

  if (options.ruleId && selected.length === 0) {
    throw new Error(
      `No rule called "${options.ruleId}". Run \`tavik rules\` to see what this workspace has.`,
    );
  }

  if (selected.length === 0) {
    if (options.json) {
      line(JSON.stringify({ status: "no-rules", rules: [] }, null, 2));
    } else {
      heading("No rules yet");
      line(`  ${dim("Nothing has been declared, so there is nothing to check.")}`);
      line(`  ${dim("Write one on the Rules screen, or run `tavik scan` first.")}`);
      line();
    }
    // Not a pass. Nothing was proven, and a build that goes green on an empty
    // rule set is a build that goes green forever if someone deletes them all.
    return options.failOnUnknown ? EXIT.UNCHECKED : EXIT.OK;
  }

  const startedAt = Date.now();
  const outcomes: RuleOutcome[] = [];

  for (const rule of selected) {
    // verifyBoundary never throws — every failure comes back as `unknown` with
    // a reason — so a database that dies halfway through still produces a
    // report, and the rules it could not reach are visibly unchecked rather
    // than quietly missing.
    const verification = await verifyBoundary(store, client, rule);
    outcomes.push({ rule, verification });

    // Record it, so a CI run shows up on the dashboard beside everything else.
    // Secondary to the answer: a log that cannot be written must not withhold
    // the verdict the build is waiting on.
    try {
      const previous = await changeLog.latestVerification(rule.id);
      await changeLog.recordVerification(rule, verification, previous);
    } catch {
      // Intentionally swallowed — see above.
    }
  }

  // Leave a mark that a check ran from outside the dashboard.
  //
  // The dashboard uses this to tell someone whether Tavik is actually enforcing
  // anything or only being looked at — a distinction it otherwise has no way to
  // make, and the one that separates a tool a team installed from a tool a team
  // uses. Recorded as a fact, not inferred from a guess.
  try {
    await store.setMeta("cli.lastCheckAt", Date.now());
  } catch {
    // A progress marker is never worth failing a build over.
  }

  const broken = outcomes.filter((o) => o.verification.status === "violated");
  const unchecked = outcomes.filter((o) => o.verification.status === "unknown");
  const holding = outcomes.filter((o) => o.verification.status === "verified");

  writeSummary(options, outcomes, Date.now() - startedAt);

  if (options.json) {
    line(
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          operator: options.operator,
          elapsedMs: Date.now() - startedAt,
          summary: {
            total: outcomes.length,
            holding: holding.length,
            broken: broken.length,
            unchecked: unchecked.length,
          },
          rules: outcomes.map(({ rule, verification }) => ({
            id: rule.id,
            name: rule.name,
            statement: rule.statement,
            status: verification.status,
            // Named `routesFound` rather than `routes`, because a truncated
            // result is a sample and calling it a total would be a lie a
            // machine reader could not see through.
            routesFound: verification.paths.length,
            truncated: verification.truncated,
            reason: verification.failureReason,
            routes: verification.paths
              .slice(0, options.showPaths)
              .map((path) => summarisePath(path).hops),
          })),
        },
        null,
        2,
      ),
    );
    return exitCode(broken.length, unchecked.length, options.failOnUnknown);
  }

  renderReport(outcomes, broken, unchecked, holding, Date.now() - startedAt, options, applied);
  return exitCode(broken.length, unchecked.length, options.failOnUnknown);
}

/**
 * Hand the build a readable explanation of itself.
 *
 * Never allowed to fail the run. A report is an explanation of the verdict, not
 * the verdict — losing it because a path was unwritable must not turn a passing
 * build red or a failing one green.
 */
function writeSummary(
  options: CheckOptions,
  outcomes: readonly RuleOutcome[],
  elapsedMs: number,
): void {
  if (!options.summaryPath) return;
  try {
    appendFileSync(
      options.summaryPath,
      `${renderMarkdownSummary({
        outcomes,
        elapsedMs,
        failOnUnknown: options.failOnUnknown,
        showPaths: options.showPaths,
      })}
`,
      "utf8",
    );
  } catch {
    // Intentionally swallowed — see above.
  }
}

function exitCode(broken: number, unchecked: number, failOnUnknown: boolean): number {
  // Broken outranks unchecked: a proven way in is a worse fact than an
  // unanswered question, and a build log should lead with the worse one.
  if (broken > 0) return EXIT.BROKEN;
  if (unchecked > 0 && failOnUnknown) return EXIT.UNCHECKED;
  return EXIT.OK;
}

function renderReport(
  outcomes: readonly RuleOutcome[],
  broken: readonly RuleOutcome[],
  unchecked: readonly RuleOutcome[],
  holding: readonly RuleOutcome[],
  elapsedMs: number,
  options: CheckOptions,
  applied: AppliedRules | null,
): void {
  if (applied) {
    // Says where the rules came from, and names the ones that came from
    // somewhere else. A rule failing a build that nobody can find in the file
    // is the kind of thing that gets a whole tool switched off.
    heading(
      `Applying ${plural(applied.fromFile.length, "rule")} from ${CONFIG_FILENAME}` +
        (applied.written.length > 0 ? ` (${applied.written.length} updated)` : ""),
    );
    // Only when this run is actually checking them. With --rule the report
    // covers one rule, and claiming five others are "also being checked" in the
    // same breath as "checked 1 rule" is simply untrue.
    if (applied.alsoInWorkspace.length > 0 && options.ruleId === undefined) {
      line(
        `  ${grey(
          `Also checking ${plural(applied.alsoInWorkspace.length, "rule")} this workspace ` +
            `already had: ${applied.alsoInWorkspace.map((rule) => rule.name).join(", ")}.`,
        )}`,
      );
      line(`  ${grey("Remove one with `tavik rules remove <id>`.")}`);
    }
  }

  heading(`Checked ${plural(outcomes.length, "rule")} in ${duration(elapsedMs)}`);
  line();

  for (const { rule, verification } of outcomes) {
    const count =
      verification.status === "violated"
        ? // A capped result is a sample. Printing "25" where the truth is "at
          // least 25" understates the problem in the one report meant to convey
          // its size.
          `${verification.paths.length}${verification.truncated ? "+" : ""} way${
            verification.paths.length === 1 && !verification.truncated ? "" : "s"
          } in`
        : verification.status === "verified"
          ? "no way in"
          : "not checked";

    line(`  ${statusBadge(verification.status)}  ${bold(rule.name)}  ${grey(count)}`);
  }

  for (const { rule, verification } of broken) {
    line();
    line(`  ${red("─".repeat(3))} ${bold(rule.name)}`);
    line(`  ${dim(rule.statement)}`);
    line();

    const shown = verification.paths.slice(0, options.showPaths);
    for (const [index, path] of shown.entries()) {
      line(`  ${grey(`route ${index + 1} · ${plural(path.length, "hop")}`)}`);
      renderPath(
        summarisePath(path).hops.map((hop) => ({
          from: shortName(hop.from),
          relation: hop.relation.toLowerCase(),
          to: shortName(hop.to),
        })),
      );
      line();
    }

    const remaining = verification.paths.length - shown.length;
    if (remaining > 0 || verification.truncated) {
      line(
        `  ${grey(`and ${remaining}${verification.truncated ? "+" : ""} more.`)}`,
      );
      line();
    }
  }

  for (const { rule, verification } of unchecked) {
    line();
    line(`  ${yellow("─".repeat(3))} ${bold(rule.name)}`);
    // The engine's own words. It already explains what is missing and what to
    // do about it, and paraphrasing here would let the two drift apart.
    line(`  ${verification.failureReason ?? "Tavik could not check this rule."}`);
    line();
  }

  line();
  if (broken.length > 0) {
    line(
      `  ${red(bold(`${plural(broken.length, "rule")} broken.`))} ` +
        `${grey(`${holding.length} holding, ${unchecked.length} unchecked.`)}`,
    );
    line(`  ${grey("Open the dashboard to see the full picture and approve a fix.")}`);
  } else if (unchecked.length > 0 && options.failOnUnknown) {
    line(`  ${yellow(bold(`${plural(unchecked.length, "rule")} could not be checked.`))}`);
    line(
      `  ${grey("Failing on purpose: \"not checked\" is not \"safe\". Pass --allow-unchecked to change that.")}`,
    );
  } else {
    line(`  ${green(bold("Every rule holds."))} ${grey(`Proved in ${duration(elapsedMs)}.`)}`);
  }
  line();
}

/** `tavik:release:lodash@4.17.21` reads better as `lodash@4.17.21`. */
function shortName(urn: string): string {
  return urn.split(":").slice(2).join(":") || urn;
}
