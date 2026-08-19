/**
 * Getting the file's rules into the workspace.
 *
 * Called before every scan and every check, so the two can never disagree about
 * what is being enforced. A team that edits `tavik.config.json` in a pull
 * request should see the new rule take effect the moment that build runs, with
 * no separate step to remember.
 *
 * Additive on purpose. Rules the file does not mention are left alone rather
 * than deleted, because the workspace is shared: the dashboard is a legitimate
 * place to write a rule, one repository's config file has no business silently
 * removing another team's boundary, and a config that could delete rules turns
 * a merge conflict into lost coverage. `tavik rules remove` deletes, visibly and
 * on purpose.
 */

import type { SecurityBoundary } from "../src/lib/domain/boundary";
import type { RuleStore } from "../src/lib/engine/rule-store";
import { compileRule, type RuleSpec } from "./rules-file";

export interface AppliedRules {
  /** Rules this file declares, compiled. */
  readonly fromFile: readonly SecurityBoundary[];
  /** Written because they were new or had changed. */
  readonly written: readonly SecurityBoundary[];
  /**
   * Rules in the workspace that this file does not mention.
   *
   * Reported rather than removed, so nobody is surprised by a rule they cannot
   * find in the file that is nonetheless failing their build.
   */
  readonly alsoInWorkspace: readonly SecurityBoundary[];
}

export async function applyRules(
  rules: RuleStore,
  specs: readonly RuleSpec[],
): Promise<AppliedRules> {
  const existing = await rules.list();
  const byId = new Map(existing.map((rule) => [rule.id, rule]));

  const fromFile = specs.map((spec) => compileRule(spec));
  const written: SecurityBoundary[] = [];

  for (const rule of fromFile) {
    const current = byId.get(rule.id);

    // Only write a genuine change. Re-saving an identical rule on every check
    // is pure write churn, and churn is not free here — HydraDB is
    // log-structured, and enough of it slows every subsequent read.
    if (current && sameRule(current, rule)) continue;

    // Keep the original creation time. A rule that was first declared months
    // ago has not just been created because someone corrected its hop count,
    // and the timeline should not claim otherwise.
    await rules.save(current ? { ...rule, createdAt: current.createdAt } : rule);
    written.push(rule);
  }

  const declaredIds = new Set(fromFile.map((rule) => rule.id));

  return {
    fromFile,
    written,
    alsoInWorkspace: existing.filter((rule) => !declaredIds.has(rule.id)),
  };
}

function sameRule(a: SecurityBoundary, b: SecurityBoundary): boolean {
  return (
    a.name === b.name &&
    a.statement === b.statement &&
    a.maxHops === b.maxHops &&
    sameSelector(a.source, b.source) &&
    sameSelector(a.target, b.target) &&
    a.relations.length === b.relations.length &&
    a.relations.every((relation, index) => relation === b.relations[index])
  );
}

function sameSelector(a: SecurityBoundary["source"], b: SecurityBoundary["source"]): boolean {
  return a.kind === b.kind && a.property === b.property && a.value === b.value;
}
