import "server-only";

import {
  type BoundaryVerification,
  type SecurityBoundary,
  sortByUrgency,
  type BoundaryWithVerification,
} from "@/lib/domain/boundary";
import type { ChangeEvent } from "@/lib/domain/change";
import { ChangeLog } from "@/lib/engine/change-log";
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

let cached: { client: HydraClient; store: GraphStore; changeLog: ChangeLog } | null = null;

export function tavik() {
  if (!cached) {
    const client = new HydraClient(hydraEnv());
    cached = { client, store: new GraphStore(client), changeLog: new ChangeLog(client) };
  }
  return cached;
}

/**
 * The boundaries this workspace has declared.
 *
 * Defined in code for now. Boundary authoring — the UI where a team writes a
 * rule in plain language — is not built yet, and seeding a fake "saved" boundary
 * into the database would misrepresent a feature that does not exist. These are
 * real definitions evaluated against real state; only their authoring is
 * pending.
 */
export const BOUNDARIES: readonly SecurityBoundary[] = [
  {
    id: "production-isolation",
    name: "Production Isolation",
    statement:
      "No production service may depend on a package whose publish rights sit outside our trusted publisher set.",
    source: {
      kind: "Maintainer",
      property: "trust",
      value: "untrusted",
      description: "publishers not on this workspace's allowlist",
    },
    target: {
      kind: "Service",
      property: "environment",
      value: "production",
      description: "services running in production",
    },
    relations: ["MAINTAINS", "HAS_RELEASE", "SUPPLIES"],
    maxHops: 8,
    createdAt: 1_755_400_000_000,
    environmentId: "env-local",
  },
];

export function findBoundary(id: string): SecurityBoundary | undefined {
  return BOUNDARIES.find((boundary) => boundary.id === id);
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

  for (const boundary of BOUNDARIES) {
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
  const boundary = findBoundary(id);
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
