import type { SecurityBoundary } from "./boundary";

/**
 * Rules seeded into a brand-new workspace, on its first scan.
 *
 * Lives in the domain rather than the server layer so every entry point can seed
 * identically — the upload action, the CLI, and anything added later. When this
 * lived behind `server-only`, scanning from the command line produced a
 * workspace with data and no rules watching it, which looks like the product is
 * broken.
 *
 * These are ordinary saved rules once written: editable and deletable like any
 * the user writes themselves.
 */
export const STARTER_RULES: readonly SecurityBoundary[] = [
  {
    id: "production-isolation",
    name: "Outside publishers",
    statement:
      "Nobody outside our approved list should be able to get code into production.",
    source: {
      kind: "Maintainer",
      property: "trust",
      value: "untrusted",
      description: "people not on our approved list",
    },
    target: {
      kind: "Service",
      property: "environment",
      value: "production",
      description: "anything running in production",
    },
    relations: ["MAINTAINS", "HAS_RELEASE", "SUPPLIES"],
    maxHops: 8,
    createdAt: 1_755_400_000_000,
    environmentId: "env-local",
  },
  {
    id: "sole-publisher-exposure",
    name: "One-person packages",
    statement:
      "Production shouldn't depend on packages only one person can publish.",
    source: {
      kind: "Package",
      property: "sole_publisher",
      value: "true",
      description: "packages with exactly one person able to publish",
    },
    target: {
      kind: "Service",
      property: "environment",
      value: "production",
      description: "anything running in production",
    },
    relations: ["HAS_RELEASE", "SUPPLIES"],
    maxHops: 8,
    createdAt: 1_755_400_000_000,
    environmentId: "env-local",
  },
  {
    id: "deprecated-in-production",
    name: "Abandoned code",
    statement:
      "Production shouldn't run versions the author has marked as abandoned.",
    source: {
      kind: "Release",
      property: "deprecated",
      value: "true",
      description: "versions the publisher marked deprecated",
    },
    target: {
      kind: "Service",
      property: "environment",
      value: "production",
      description: "anything running in production",
    },
    relations: ["SUPPLIES"],
    maxHops: 8,
    createdAt: 1_755_400_000_000,
    environmentId: "env-local",
  },
  {
    // Quarantine, not a ban. A team isolating a publisher pending review is a
    // statement about the team's own process, not about anyone's conduct — and
    // these are real, named accounts. Nothing in this product may imply
    // wrongdoing by a real person. See docs/decisions.md D6.
    id: "blocked-publishers",
    name: "Quarantined publishers",
    statement:
      "While a publisher is under review, none of their code should be reaching production.",
    source: {
      kind: "Maintainer",
      property: "trust",
      value: "quarantined",
      description: "publishers we have paused pending review",
    },
    target: {
      kind: "Service",
      property: "environment",
      value: "production",
      description: "anything running in production",
    },
    relations: ["MAINTAINS", "HAS_RELEASE", "SUPPLIES"],
    maxHops: 8,
    createdAt: 1_755_400_000_000,
    environmentId: "env-local",
  },
  {
    // The rule this product was originally conceived around: CI must never be
    // able to reach production customer data. Answered by the same engine, over
    // the same relationship vocabulary, as every supply-chain rule — which is
    // the strongest evidence the model is right rather than fitted to one
    // dataset.
    id: "ci-to-customer-data",
    name: "CI reaching customer data",
    statement:
      "Nothing in CI should be able to reach production customer data, at any number of steps.",
    source: {
      kind: "CiJob",
      property: "tag",
      value: "ci",
      description: "anything running in CI",
    },
    target: {
      kind: "Datastore",
      property: "tag",
      value: "customer-data",
      description: "stores holding customer data",
    },
    relations: ["RUNS_AS", "CAN_ASSUME", "CAN_ACCESS"],
    maxHops: 8,
    createdAt: 1_755_400_000_000,
    environmentId: "env-local",
  },
];
