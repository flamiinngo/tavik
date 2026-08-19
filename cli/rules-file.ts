/**
 * Rules that live in the repository.
 *
 * A boundary is a claim a team makes about its own system, so it belongs where
 * the team's other decisions live: in a file, in a pull request, with a diff
 * somebody reviews. `tavik.config.json` carries them, `tavik check` applies
 * them, and adding a rule becomes a reviewable change rather than something one
 * person clicked once.
 *
 * The `from` and `to` values are the same closed vocabulary the dashboard's rule
 * builder offers. That is deliberate: every option is backed by a property
 * ingestion actually writes, so a rule in this file can always be answered.
 * Free-form selectors would let someone write a rule that silently matches
 * nothing and reports `unknown` forever, which teaches them the product is
 * broken rather than that their rule is.
 */

import type { SecurityBoundary } from "../src/lib/domain/boundary";
import {
  CLOUD_SOURCE_PRESETS,
  CLOUD_TARGET_PRESETS,
  composeStatement,
  findSourcePreset,
  findTargetPreset,
  SOURCE_PRESETS,
  TARGET_PRESETS,
  type SelectorPreset,
} from "../src/lib/domain/rule-presets";
import { ruleIdFromName } from "../src/lib/engine/rule-store";
import { ConfigError } from "./config";

export interface RuleSpec {
  readonly name: string;
  /** Preset id — what must not be able to reach. */
  readonly from: string;
  /** Preset id — what must not be reached. */
  readonly to: string;
  readonly maxHops?: number;
}

export const ALL_SOURCES: readonly SelectorPreset[] = [...SOURCE_PRESETS, ...CLOUD_SOURCE_PRESETS];
export const ALL_TARGETS: readonly SelectorPreset[] = [...TARGET_PRESETS, ...CLOUD_TARGET_PRESETS];

/**
 * Read the `rules` array out of a parsed config file.
 *
 * Every failure names the file, the rule, and what the valid options are. A
 * config error that just says "invalid" sends someone hunting through a file
 * their colleague wrote, and this is the file that decides what gets checked —
 * a rule silently dropped for a typo is coverage nobody knows they lost.
 */
export function parseRules(value: unknown, path: string): RuleSpec[] {
  if (value === undefined) return [];

  if (!Array.isArray(value)) {
    throw new ConfigError(`${path}: "rules" should be a list.`);
  }

  return value.map((entry, index) => {
    const where = `${path}: rules[${index}]`;

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ConfigError(`${where} should be an object.`);
    }

    const rule = entry as Record<string, unknown>;
    const name = rule.name;
    const from = rule.from;
    const to = rule.to;

    if (typeof name !== "string" || name.trim().length === 0) {
      throw new ConfigError(`${where} needs a "name".`);
    }
    if (typeof from !== "string") {
      throw new ConfigError(`${where} ("${name}") needs a "from". ${sourceOptions()}`);
    }
    if (typeof to !== "string") {
      throw new ConfigError(`${where} ("${name}") needs a "to". ${targetOptions()}`);
    }

    if (!findSourcePreset(from)) {
      throw new ConfigError(
        `${where} ("${name}") has an unknown "from": "${from}". ${sourceOptions()}`,
      );
    }
    if (!findTargetPreset(to)) {
      throw new ConfigError(`${where} ("${name}") has an unknown "to": "${to}". ${targetOptions()}`);
    }

    if (rule.maxHops !== undefined) {
      if (typeof rule.maxHops !== "number" || !Number.isInteger(rule.maxHops)) {
        throw new ConfigError(`${where} ("${name}"): "maxHops" should be a whole number.`);
      }
      if (rule.maxHops < 1 || rule.maxHops > 12) {
        // Bounded on both ends. HydraDB refuses unbounded traversal outright,
        // and a very deep bound turns a fast check into one that times out and
        // reports `unknown` — which looks like a broken rule, not a slow one.
        throw new ConfigError(
          `${where} ("${name}"): "maxHops" should be between 1 and 12, got ${rule.maxHops}.`,
        );
      }
    }

    const known = new Set(["name", "from", "to", "maxHops"]);
    const extra = Object.keys(rule).filter((key) => !known.has(key));
    if (extra.length > 0) {
      throw new ConfigError(
        `${where} ("${name}") has ${extra.length === 1 ? "a setting" : "settings"} Tavik ` +
          `doesn't recognise: ${extra.join(", ")}. A rule takes name, from, to, maxHops.`,
      );
    }

    return { name: name.trim(), from, to, maxHops: rule.maxHops as number | undefined };
  });
}

/** Turn a file entry into the rule the engine actually evaluates. */
export function compileRule(spec: RuleSpec, environmentId = "env-local"): SecurityBoundary {
  const source = findSourcePreset(spec.from);
  const target = findTargetPreset(spec.to);

  // parseRules already refused unknown ids. This is here so a future caller
  // that skips validation fails loudly rather than writing a rule that matches
  // nothing.
  if (!source || !target) {
    throw new ConfigError(`Rule "${spec.name}" refers to something Tavik doesn't know about.`);
  }

  return {
    // Derived from the name, so editing a rule in the file updates it in place
    // rather than leaving the old one behind to keep failing builds.
    id: ruleIdFromName(spec.name),
    name: spec.name,
    statement: composeStatement(source, target),
    source: source.selector,
    target: target.selector,
    // Which links have to be crossed is a consequence of what the source *is*,
    // not a separate choice the person writing the rule should have to reason
    // about.
    relations: source.relations,
    maxHops: spec.maxHops ?? 8,
    createdAt: Date.now(),
    environmentId,
  };
}

function sourceOptions(): string {
  return `Valid options: ${ALL_SOURCES.map((preset) => `"${preset.id}"`).join(", ")}.`;
}

function targetOptions(): string {
  return `Valid options: ${ALL_TARGETS.map((preset) => `"${preset.id}"`).join(", ")}.`;
}
