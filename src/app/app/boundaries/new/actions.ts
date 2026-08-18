"use server";

import { revalidatePath } from "next/cache";

import { validateBoundary, type SecurityBoundary } from "@/lib/domain/boundary";
import {
  composeStatement,
  findSourcePreset,
  findTargetPreset,
} from "@/lib/domain/rule-presets";
import { ruleIdFromName } from "@/lib/engine/rule-store";
import { verifyBoundary } from "@/lib/engine/verify";
import { tavik } from "@/lib/server/tavik";

/**
 * Create a rule, then answer it immediately.
 *
 * The answer matters as much as the saving. A rule that appears in a list with
 * no verdict teaches nobody anything; checking it on creation means someone sees
 * what their own words actually mean about their own code, straight away.
 */

export interface CreateRuleResult {
  readonly ok: boolean;
  readonly message: string;
  readonly ruleId?: string;
  readonly status?: string;
  readonly routes?: number;
  readonly truncated?: boolean;
  readonly elapsedMs?: number;
}

export async function createRule(formData: FormData): Promise<CreateRuleResult> {
  const name = String(formData.get("name") ?? "").trim();
  const sourceId = String(formData.get("source") ?? "");
  const targetId = String(formData.get("target") ?? "");
  const maxHops = Number(formData.get("maxHops") ?? 8);

  if (name.length === 0) {
    return { ok: false, message: "Give the rule a short name so you can find it later." };
  }

  const source = findSourcePreset(sourceId);
  const target = findTargetPreset(targetId);
  if (!source || !target) {
    return { ok: false, message: "Choose what the rule checks from and what it protects." };
  }

  const rule: SecurityBoundary = {
    id: ruleIdFromName(name),
    name,
    statement: composeStatement(source, target),
    source: source.selector,
    target: target.selector,
    // Relationships come from the source preset rather than from the person
    // writing the rule: which links have to be crossed is a consequence of what
    // the source *is*, not a separate choice they should have to reason about.
    relations: source.relations,
    maxHops: Number.isFinite(maxHops) ? Math.min(Math.max(Math.trunc(maxHops), 1), 12) : 8,
    createdAt: Date.now(),
    environmentId: "env-local",
  };

  const problems = validateBoundary(rule);
  if (problems.length > 0) {
    return { ok: false, message: problems.join(" ") };
  }

  try {
    const { client, store, rules } = tavik();
    await rules.save(rule);

    // Answer it straight away, with the same engine used everywhere else.
    const verification = await verifyBoundary(store, client, rule);

    revalidatePath("/app");
    revalidatePath("/app/boundaries");

    return {
      ok: true,
      message:
        verification.status === "violated"
          ? `Saved — and there are already ${verification.paths.length}${verification.truncated ? "+" : ""} ways through it.`
          : verification.status === "verified"
            ? "Saved. Nothing can get through it right now."
            : "Saved, but Tavik couldn't check it yet.",
      ruleId: rule.id,
      status: verification.status,
      routes: verification.paths.length,
      truncated: verification.truncated,
      elapsedMs: Math.round(verification.elapsedMs),
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? `Couldn't save the rule: ${error.message}` : "Couldn't save the rule.",
    };
  }
}

/** Remove a rule. The graph it asked about is untouched. */
export async function deleteRule(ruleId: string): Promise<{ ok: boolean; message: string }> {
  try {
    await tavik().rules.remove(ruleId);
    revalidatePath("/app");
    revalidatePath("/app/boundaries");
    return { ok: true, message: "Rule deleted." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Couldn't delete the rule.",
    };
  }
}
