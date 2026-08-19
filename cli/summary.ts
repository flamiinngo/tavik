/**
 * The report a pull request sees.
 *
 * GitHub renders whatever a step writes to `$GITHUB_STEP_SUMMARY` as markdown on
 * the run page. That is the right surface for this: it needs no token, no
 * permissions, and no API call, so it works on a fork's pull request where
 * posting a comment would silently fail.
 *
 * Written here rather than assembled in shell, so it is ordinary TypeScript that
 * the test suite can hold to account. A build's only explanation of why it
 * failed should not live in an unquoted string inside a YAML file.
 */

import type { BoundaryVerification, SecurityBoundary } from "../src/lib/domain/boundary";
import { summarisePath } from "../src/lib/domain/change";

export interface SummaryInput {
  readonly outcomes: readonly {
    readonly rule: SecurityBoundary;
    readonly verification: BoundaryVerification;
  }[];
  readonly elapsedMs: number;
  readonly failOnUnknown: boolean;
  /** Routes to show per broken rule. The rest are counted. */
  readonly showPaths: number;
}

export function renderMarkdownSummary(input: SummaryInput): string {
  const broken = input.outcomes.filter((o) => o.verification.status === "violated");
  const unchecked = input.outcomes.filter((o) => o.verification.status === "unknown");
  const holding = input.outcomes.filter((o) => o.verification.status === "verified");

  const out: string[] = [];

  // The verdict first. Somebody opening a failed build wants to know what broke
  // before they want a table.
  if (broken.length > 0) {
    out.push(`## ❌ ${count(broken.length, "rule")} broken`);
    out.push("");
    out.push(
      "A change here opens a route into something you said must never be reachable.",
    );
  } else if (unchecked.length > 0 && input.failOnUnknown) {
    out.push(`## ⚠️ ${count(unchecked.length, "rule")} could not be checked`);
    out.push("");
    out.push(
      'Failing on purpose. "Not checked" is not "safe" — a build that goes green on ' +
        "a rule nobody answered is exactly the false assurance Tavik exists to prevent.",
    );
  } else {
    out.push("## ✅ Every rule holds");
    out.push("");
    out.push(
      `Tavik checked ${count(input.outcomes.length, "rule")} against your real dependency ` +
        `graph in ${(input.elapsedMs / 1000).toFixed(1)}s and found no route through.`,
    );
  }

  out.push("");
  out.push("| | Rule | Result |");
  out.push("|---|---|---|");
  for (const { rule, verification } of input.outcomes) {
    out.push(`| ${icon(verification.status)} | ${escape(rule.name)} | ${result(verification)} |`);
  }
  out.push("");

  // ── The evidence ──────────────────────────────────────────────────────────
  //
  // A build that says "failed" and nothing else teaches nobody anything. Every
  // broken rule gets the actual chain, so the person reading can follow it hop
  // by hop and check it themselves.
  for (const { rule, verification } of broken) {
    out.push(`### ${escape(rule.name)}`);
    out.push("");
    out.push(`> ${escape(rule.statement)}`);
    out.push("");

    const shown = verification.paths.slice(0, input.showPaths);
    for (const [index, path] of shown.entries()) {
      const hops = summarisePath(path).hops;
      out.push(`**Route ${index + 1}** — ${count(path.length, "hop")}`);
      out.push("");
      out.push("```");
      out.push(shortName(hops[0]?.from ?? ""));
      for (const hop of hops) {
        out.push(`  ──${hop.relation.toLowerCase()}──▶ ${shortName(hop.to)}`);
      }
      out.push("```");
      out.push("");
    }

    const remaining = verification.paths.length - shown.length;
    if (remaining > 0 || verification.truncated) {
      // A capped result is a sample. Saying "3 more" where the truth is "at
      // least 3 more" understates it in the one report meant to convey size.
      out.push(`_…and ${remaining}${verification.truncated ? "+" : ""} more._`);
      out.push("");
    }
  }

  for (const { rule, verification } of unchecked) {
    out.push(`### ${escape(rule.name)}`);
    out.push("");
    // The engine's own words. It already says what is missing and what to do.
    out.push(verification.failureReason ?? "Tavik could not check this rule.");
    out.push("");
  }

  out.push("---");
  out.push("");
  out.push(
    `${holding.length} holding · ${broken.length} broken · ${unchecked.length} unchecked · ` +
      `checked in ${(input.elapsedMs / 1000).toFixed(1)}s`,
  );

  return out.join("\n");
}

function icon(status: string): string {
  if (status === "verified") return "✅";
  if (status === "violated") return "❌";
  return "⚠️";
}

function result(verification: BoundaryVerification): string {
  if (verification.status === "verified") return "no way in";
  if (verification.status === "violated") {
    const suffix = verification.truncated ? "+" : "";
    return `**${verification.paths.length}${suffix} ${
      verification.paths.length === 1 && !verification.truncated ? "way" : "ways"
    } in**`;
  }
  return "not checked";
}

/** `tavik:release:lodash@4.17.21` reads better as `lodash@4.17.21`. */
function shortName(urn: string): string {
  return urn.split(":").slice(2).join(":") || urn;
}

/**
 * Neutralise markdown and HTML in text that came from a package name.
 *
 * Package names come from the public registry, where anyone can publish, and
 * they land in a table cell on a page a whole team reads. A name containing a
 * pipe would break the table; one containing a tag would inject markup into
 * somebody else's build summary. Same reasoning as escaping them on the way into
 * Cypher — untrusted input does not become trusted by travelling through Tavik.
 */
function escape(text: string): string {
  return text
    .replace(/[<>]/g, (character) => (character === "<" ? "&lt;" : "&gt;"))
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}
