/**
 * `tavik rules remove <id>` — stop enforcing something.
 *
 * Deleting is deliberate and separate. Applying the config file never removes a
 * rule, because a shared workspace holds boundaries other people declared and
 * one repository's file has no business silently dropping them — a merge
 * conflict would become lost coverage nobody noticed.
 *
 * Removes it from the file and from the workspace, in that order. The file is
 * where the decision lives; leaving it there would mean the next `tavik check`
 * put the rule straight back and nobody could work out why.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { ruleIdFromName } from "../../src/lib/engine/rule-store";
import { connection, CONFIG_FILENAME, findConfig } from "../config";
import { bold, dim, green, grey, heading, line, yellow } from "../output";
import { EXIT, runtime } from "../runtime";
import type { RuleSpec } from "../rules-file";

export async function removeRule(cwd: string, ruleId: string): Promise<number> {
  heading(`Removing ${bold(ruleId)}`);
  line();

  let removedFromFile = false;
  const configPath = findConfig(cwd);

  if (configPath && existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const rules = Array.isArray(config.rules) ? (config.rules as RuleSpec[]) : [];
    const kept = rules.filter((rule) => ruleIdFromName(rule.name) !== ruleId);

    if (kept.length !== rules.length) {
      writeFileSync(configPath, `${JSON.stringify({ ...config, rules: kept }, null, 2)}\n`, "utf8");
      removedFromFile = true;
      line(`  ${green("✓")} removed from ${CONFIG_FILENAME}`);
    }
  }

  let removedFromWorkspace = false;
  try {
    const { rules } = runtime(connection());
    const before = await rules.list();
    if (before.some((rule) => rule.id === ruleId)) {
      await rules.remove(ruleId);
      removedFromWorkspace = true;
      line(`  ${green("✓")} removed from your workspace`);
    }
  } catch (error) {
    line(
      `  ${yellow("·")} ${dim(
        `Couldn't reach HydraDB: ${error instanceof Error ? error.message : String(error)}`,
      )}`,
    );
  }

  line();

  if (!removedFromFile && !removedFromWorkspace) {
    line(`  ${dim(`Nothing called "${ruleId}" here. Run \`tavik rules\` to see what there is.`)}`);
    line();
    return EXIT.ERROR;
  }

  if (removedFromFile && !removedFromWorkspace) {
    // Worth saying, because the rule will still appear on the dashboard until
    // someone reconnects — and a rule that looks deleted but is not is exactly
    // the sort of thing that erodes trust in the whole tool.
    line(`  ${grey("Still in the workspace until Tavik can reach the database again.")}`);
    line();
  }

  return EXIT.OK;
}
