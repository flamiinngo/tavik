import "server-only";

import {
  type BoundaryVerification,
  type SecurityBoundary,
  sortByUrgency,
  type BoundaryWithVerification,
} from "@/lib/domain/boundary";
import type { ChangeEvent } from "@/lib/domain/change";
import { ChangeLog } from "@/lib/engine/change-log";
import { RuleStore } from "@/lib/engine/rule-store";
import { verifyBoundary } from "@/lib/engine/verify";
import { hydraEnv } from "@/lib/env";
import { HydraClient } from "@/lib/hydra/client";
import { GraphStore } from "@/lib/hydra/graph-store";

/**
 * Server-side access to Tavik's state.
 *
 * `server-only` is imported at the top so that importing this from a client
 * component is a build error rather than a leaked HydraDB token.
 *
 * Every accessor here is failure-tolerant in a specific way: it returns what it
 * could read plus an explicit note about what it could not. Pages then render
 * degraded rather than blank, and — critically — a boundary whose state could
 * not be read shows as `unknown`, never as verified. A dashboard that goes green
 * because the database is unreachable would be worse than one that fails
 * outright.
 */

let cached: {
  client: HydraClient;
  store: GraphStore;
  changeLog: ChangeLog;
  rules: RuleStore;
} | null = null;

export function tavik() {
  if (!cached) {
    const client = new HydraClient(hydraEnv());
    cached = {
      client,
      store: new GraphStore(client),
      changeLog: new ChangeLog(client),
      rules: new RuleStore(client),
    };
  }
  return cached;
}

/**
 * The rules this workspace has declared.
 *
 * Read from the database, so they are whatever the user actually wrote. The set
 * below is used only to seed a brand-new workspace: without it the first visit
 * would show an empty product and nothing to react to, which teaches nobody
 * anything. Once seeded they are ordinary saved rules — editable and deletable
 * like any other.
 */
export async function loadRules(): Promise<readonly SecurityBoundary[]> {
  const { rules } = tavik();
  const saved = await rules.list();
  if (saved.length > 0) return saved;

  for (const rule of STARTER_RULES) {
    await rules.save(rule);
  }
  return STARTER_RULES;
}

/**
 * Rules seeded into a brand-new workspace.
 *
 * Used once, when nothing has been saved yet. Without them a first visit shows
 * an empty product with nothing to react to. After seeding they are ordinary
 * saved rules, editable and deletable like any the user writes themselves.
 */
const STARTER_RULES: readonly SecurityBoundary[] = [
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
];

export async function findBoundary(id: string): Promise<SecurityBoundary | undefined> {
  const rules = await loadRules();
  return rules.find((rule) => rule.id === id);
}

export interface SecurityStateSummary {
  readonly boundaries: readonly BoundaryWithVerification[];
  readonly counts: Record<"verified" | "violated" | "investigating" | "unknown", number>;
  readonly entityCount: number | null;
  /**
   * Set when Tavik could not reach HydraDB. Rendered verbatim; the UI never
   * replaces it with a generic failure message.
   */
  readonly connectionError: string | null;
}

/**
 * Evaluate every boundary and summarise the result.
 *
 * Verification runs on request rather than from a cache. Continuous scheduled
 * verification is the product's eventual shape, but showing a cached verdict
 * without saying how old it is would be the kind of quiet dishonesty this
 * product exists to avoid.
 *
 * **Reads only — this deliberately does not write to the change log.** Viewing a
 * dashboard is not a work event. Recording one entry per page view would inflate
 * the audit trail with noise, make the timeline unreadable, and misrepresent how
 * often Tavik actually ran. Writing history belongs to the thing that performs
 * scheduled verification (`npm run verify`, and the scheduler that will replace
 * it), not to the thing that displays it.
 */
export async function loadSecurityState(): Promise<SecurityStateSummary> {
  const { client, store } = tavik();

  let entityCount: number | null = null;
  let connectionError: string | null = null;

  try {
    entityCount = await store.countEntities();
  } catch (error) {
    connectionError =
      error instanceof Error ? error.message : "HydraDB could not be reached.";
  }

  const boundaries: BoundaryWithVerification[] = [];

  const rules = connectionError ? STARTER_RULES : await loadRules();

  for (const boundary of rules) {
    if (connectionError) {
      boundaries.push({ boundary, verification: null });
      continue;
    }

    const verification = await verifyBoundary(store, client, boundary);
    boundaries.push({ boundary, verification });
  }

  const counts = { verified: 0, violated: 0, investigating: 0, unknown: 0 };
  for (const entry of boundaries) {
    counts[entry.verification?.status ?? "unknown"] += 1;
  }

  return {
    boundaries: sortByUrgency(boundaries),
    counts,
    entityCount,
    connectionError,
  };
}

/** Verify a single boundary, for its detail page. */
export async function loadBoundary(id: string): Promise<{
  boundary: SecurityBoundary;
  verification: BoundaryVerification | null;
  history: readonly ChangeEvent[];
  connectionError: string | null;
} | null> {
  const boundary = await findBoundary(id);
  if (!boundary) return null;

  const { client, store, changeLog } = tavik();

  try {
    const verification = await verifyBoundary(store, client, boundary);
    let history: readonly ChangeEvent[] = [];
    try {
      history = await changeLog.list({ boundaryId: id, limit: 40 });
    } catch {
      // History is supporting evidence; its absence must not hide current state.
    }
    return { boundary, verification, history, connectionError: null };
  } catch (error) {
    return {
      boundary,
      verification: null,
      history: [],
      connectionError:
        error instanceof Error ? error.message : "HydraDB could not be reached.",
    };
  }
}

/**
 * Publishers currently under review.
 *
 * Read so the demo control can show the right action — putting someone under
 * review versus finishing the review — rather than assuming a starting state
 * that a previous run may already have changed.
 */
export async function quarantinedPublishers(): Promise<string[]> {
  try {
    const urns = await tavik().store.resolveSelector({
      kind: "Maintainer",
      property: "trust",
      value: "quarantined",
      description: "publishers under review",
    });
    // URNs are `tavik:maintainer:<name>`; the caller wants the account name.
    return urns.map((urn) => String(urn).split(":").slice(2).join(":"));
  } catch {
    return [];
  }
}

/** The work log, across all boundaries. */
export async function loadWorkLog(limit = 60): Promise<{
  events: readonly ChangeEvent[];
  connectionError: string | null;
}> {
  try {
    return { events: await tavik().changeLog.list({ limit }), connectionError: null };
  } catch (error) {
    return {
      events: [],
      connectionError:
        error instanceof Error ? error.message : "HydraDB could not be reached.",
    };
  }
}
