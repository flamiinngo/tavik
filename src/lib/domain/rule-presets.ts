import type { EntitySelector } from "./boundary";
import type { RelationKind } from "./entities";

/**
 * The vocabulary people write rules in.
 *
 * A rule is a reachability question, but nobody should have to know that to
 * write one. These presets are the sentence fragments a team actually uses —
 * "packages only one person can publish", "anything running in production" —
 * each mapped to the selector that answers it.
 *
 * Deliberately a closed vocabulary rather than a free-form query builder. Every
 * option here is backed by a property ingestion actually writes, so a rule
 * someone composes can always be answered. A builder that let people select
 * anything would mostly produce rules that silently match nothing and report
 * `unknown` forever, which teaches them the product is broken.
 */

export interface SelectorPreset {
  readonly id: string;
  /** Reads as the subject of a sentence. */
  readonly label: string;
  /** One line explaining what it covers, shown under the option. */
  readonly hint: string;
  readonly selector: EntitySelector;
  /**
   * Relationship types a rule starting from this preset should traverse.
   *
   * Tied to the preset because it is a consequence of *what* the source is, not
   * a separate decision: a rule about publishers has to cross publish rights to
   * reach anything, whereas one about versions does not.
   */
  readonly relations: readonly RelationKind[];
}

export const SOURCE_PRESETS: readonly SelectorPreset[] = [
  {
    id: "outside-publishers",
    label: "Publishers not on our approved list",
    hint: "Anyone who can publish a package you depend on, who you haven't approved.",
    selector: {
      kind: "Maintainer",
      property: "trust",
      value: "untrusted",
      description: "people not on our approved list",
    },
    relations: ["MAINTAINS", "HAS_RELEASE", "SUPPLIES"],
  },
  {
    id: "under-review",
    label: "Publishers we've paused pending review",
    hint: "Accounts you've quarantined while you take a closer look.",
    selector: {
      kind: "Maintainer",
      property: "trust",
      value: "quarantined",
      description: "publishers we have paused pending review",
    },
    relations: ["MAINTAINS", "HAS_RELEASE", "SUPPLIES"],
  },
  {
    id: "one-person-packages",
    label: "Packages only one person can publish",
    hint: "No second pair of eyes, and no recovery path if that account is lost.",
    selector: {
      kind: "Package",
      property: "sole_publisher",
      value: "true",
      description: "packages with exactly one person able to publish",
    },
    relations: ["HAS_RELEASE", "SUPPLIES"],
  },
  {
    id: "abandoned-versions",
    label: "Versions the author marked abandoned",
    hint: "The publisher's own signal that a version should no longer be used.",
    selector: {
      kind: "Release",
      property: "deprecated",
      value: "true",
      description: "versions the publisher marked deprecated",
    },
    relations: ["SUPPLIES"],
  },
];

// ── Cloud ────────────────────────────────────────────────────────────────
// The same vocabulary, over infrastructure rather than packages. Nothing about
// the engine changes; only which adapter produced the graph.

export const CLOUD_SOURCE_PRESETS: readonly SelectorPreset[] = [
  {
    id: "ci-identities",
    label: "Anything running in CI",
    hint: "Build and deploy pipelines, and the roles they are allowed to assume.",
    selector: {
      kind: "CiJob",
      property: "tag",
      value: "ci",
      description: "anything running in CI",
    },
    relations: ["RUNS_AS", "CAN_ASSUME", "CAN_ACCESS"],
  },
];

export const CLOUD_TARGET_PRESETS: readonly SelectorPreset[] = [
  {
    id: "customer-data",
    label: "Stores holding customer data",
    hint: "Buckets, tables and databases whose names indicate customer or payment data.",
    selector: {
      kind: "Datastore",
      property: "tag",
      value: "customer-data",
      description: "stores holding customer data",
    },
    relations: [],
  },
];

export const TARGET_PRESETS: readonly SelectorPreset[] = [
  {
    id: "production",
    label: "Anything running in production",
    hint: "Services you've marked as production when scanning them.",
    selector: {
      kind: "Service",
      property: "environment",
      value: "production",
      description: "anything running in production",
    },
    relations: [],
  },
  {
    id: "staging",
    label: "Anything running in staging",
    hint: "Services you've marked as staging.",
    selector: {
      kind: "Service",
      property: "environment",
      value: "staging",
      description: "anything running in staging",
    },
    relations: [],
  },
];

export function findSourcePreset(id: string): SelectorPreset | undefined {
  return [...SOURCE_PRESETS, ...CLOUD_SOURCE_PRESETS].find((preset) => preset.id === id);
}

export function findTargetPreset(id: string): SelectorPreset | undefined {
  return [...TARGET_PRESETS, ...CLOUD_TARGET_PRESETS].find((preset) => preset.id === id);
}

/**
 * The rule as a sentence, for previewing it before saving.
 *
 * Shown live as the form is filled in, so someone can read back what they are
 * about to create in the same words they would have used to describe it.
 */
export function composeStatement(source: SelectorPreset, target: SelectorPreset): string {
  return `${capitalise(source.label)} should never be able to reach ${target.label.toLowerCase()}.`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
