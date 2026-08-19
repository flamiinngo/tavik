import "server-only";

import {
  type BoundaryVerification,
  type SecurityBoundary,
  sortByUrgency,
  type BoundaryWithVerification,
} from "@/lib/domain/boundary";
import type { ChangeEvent } from "@/lib/domain/change";
import { STARTER_RULES } from "@/lib/domain/starter-rules";
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
 * Whether anything has been scanned yet.
 *
 * A workspace with no services has nothing to protect, so every screen should be
 * routing the user into onboarding rather than showing empty panels. Keyed on
 * services rather than total entities because that is what a person actually
 * added — the packages and publishers are consequences of it.
 */
export async function isWorkspaceEmpty(): Promise<boolean> {
  try {
    return (await tavik().store.countEntitiesOfKind("Service")) === 0;
  } catch {
    // If the database cannot be reached, the workspace is not empty — it is
    // unknown, and the caller will surface a connection error rather than an
    // invitation to start.
    return false;
  }
}

/**
 * The rules this workspace has declared.
 *
 * Read from the database, so they are whatever the user actually wrote.
 *
 * Starter rules are seeded on the first *scan*, not on the first page view. A
 * fresh install should be genuinely empty: someone landing on a dashboard
 * already full of rules and numbers they did not create cannot tell the product
 * from a screenshot, and reasonably assumes the whole thing is staged. Seeding
 * at scan time means the first numbers they see are their own.
 */
export async function loadRules(): Promise<readonly SecurityBoundary[]> {
  return tavik().rules.list();
}

/** Seed the starter rules. Called once, after a workspace's first scan. */
export async function seedStarterRules(): Promise<void> {
  const { rules } = tavik();
  if ((await rules.list()).length > 0) return;
  for (const rule of STARTER_RULES) {
    await rules.save(rule);
  }
}

/**
 * Rules seeded into a brand-new workspace.
 *
 * Used once, when nothing has been saved yet. Without them a first visit shows
 * an empty product with nothing to react to. After seeding they are ordinary
 * saved rules, editable and deletable like any the user writes themselves.
 */


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

  const rules = connectionError ? [] : await loadRules();

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
