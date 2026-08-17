/**
 * Append-only change log, stored in HydraDB.
 *
 * Entries live under their own `ChangeEvent` label, deliberately separate from
 * the `Entity` label that carries security state. Boundary traversal is keyed on
 * `sourceLabel: 'Entity'` and on an explicit list of traversable relationship
 * types, so log entries can never appear inside a reachability path. The audit
 * trail must not be able to distort the thing it audits.
 *
 * Entries are written, never updated. `recordVerification` is the main entry
 * point: it stores every verification and, when the status differs from the
 * previous one, additionally stores what changed and which paths appeared —
 * which is the root-cause answer the investigation screens are built on.
 */

import { randomUUID } from "node:crypto";

import type { BoundaryStatus, BoundaryVerification, SecurityBoundary } from "@/lib/domain/boundary";
import {
  type ChangeActor,
  type ChangeDetail,
  type ChangeEvent,
  type ChangeEventType,
  describeStatusChange,
  diffPathSummaries,
  type PathSummary,
  summarisePath,
  type VerificationDetail,
} from "@/lib/domain/change";
import type { HydraClient, HydraParam, QueryOptions } from "@/lib/hydra/client";
import { identifier } from "@/lib/hydra/cypher";
import { urnToNodeId } from "@/lib/hydra/node-id";

const EVENT_LABEL = "ChangeEvent";
const WRITE_BATCH_SIZE = 200;

/** Rows as they come back from HydraDB. */
interface EventRow {
  event_id?: unknown;
  type?: unknown;
  at?: unknown;
  actor_kind?: unknown;
  actor_name?: unknown;
  summary?: unknown;
  boundary_id?: unknown;
  environment_id?: unknown;
  detail_json?: unknown;
  [column: string]: unknown;
}

/** A boundary's last recorded verification, enough to diff the next one against. */
export interface PreviousVerification {
  readonly status: BoundaryStatus;
  readonly paths: readonly PathSummary[];
}

export interface ListOptions extends QueryOptions {
  readonly boundaryId?: string;
  /** Only entries at or after this epoch-ms timestamp. */
  readonly since?: number;
  /** Most recent first, capped. */
  readonly limit?: number;
}

export class ChangeLog {
  constructor(private readonly client: HydraClient) {}

  /**
   * Append entries.
   *
   * Node ids are derived from the event id, so a retried append converges on
   * the same node rather than duplicating an entry — an append-only log that
   * double-counts on retry would misreport history.
   */
  async append(
    events: readonly ChangeEvent[],
    options: QueryOptions = {},
  ): Promise<number> {
    if (events.length === 0) return 0;
    const label = identifier(EVENT_LABEL);

    for (let i = 0; i < events.length; i += WRITE_BATCH_SIZE) {
      const batch = events.slice(i, i + WRITE_BATCH_SIZE);
      const rows = batch.map((event) => ({
        id: urnToNodeId(`tavik:event:${event.id}`),
        event_id: event.id,
        type: event.type,
        at: event.at,
        actor_kind: event.actor.kind,
        actor_name: actorName(event.actor),
        summary: event.summary,
        boundary_id: event.boundaryId ?? "",
        environment_id: event.environmentId ?? "",
        // Detail is stored as JSON text. HydraDB property values are scalars
        // only, and the shape varies by event type, so a structured column per
        // variant would mean a schema change for every new event type.
        detail_json: event.detail ? JSON.stringify(event.detail) : "",
      }));

      await this.client.query(
        `UNWIND $rows AS row
         MERGE (n {id: row.id})
         SET n:${label.text}, n.event_id = row.event_id, n.type = row.type,
             n.at = row.at, n.actor_kind = row.actor_kind,
             n.actor_name = row.actor_name, n.summary = row.summary,
             n.boundary_id = row.boundary_id,
             n.environment_id = row.environment_id,
             n.detail_json = row.detail_json`,
        { ...options, parameters: { rows: rows as unknown as HydraParam } },
      );
    }
    return events.length;
  }

  /**
   * Read entries, most recent first.
   *
   * Sorting and limiting happen here rather than in Cypher: HydraDB's `RETURN`
   * supports only `<binding>.<property>` and `count(*)`, and its ordering
   * support is not something to depend on for an audit trail. The log is small
   * relative to the security graph, so reading and sorting in memory is honest
   * and predictable.
   */
  async list(options: ListOptions = {}): Promise<ChangeEvent[]> {
    const label = identifier(EVENT_LABEL);

    const filtered = options.boundaryId !== undefined;
    const cypher = filtered
      ? `MATCH (e:${label.text})
         WHERE e.boundary_id = $boundaryId
         RETURN e.event_id AS event_id, e.type AS type, e.at AS at,
                e.actor_kind AS actor_kind, e.actor_name AS actor_name,
                e.summary AS summary, e.boundary_id AS boundary_id,
                e.environment_id AS environment_id, e.detail_json AS detail_json`
      : `MATCH (e:${label.text})
         RETURN e.event_id AS event_id, e.type AS type, e.at AS at,
                e.actor_kind AS actor_kind, e.actor_name AS actor_name,
                e.summary AS summary, e.boundary_id AS boundary_id,
                e.environment_id AS environment_id, e.detail_json AS detail_json`;

    const result = await this.client.query<EventRow>(cypher, {
      ...options,
      parameters: filtered ? { boundaryId: options.boundaryId } : undefined,
    });

    let events = result.rows
      .map(toChangeEvent)
      .filter((event): event is ChangeEvent => event !== null);

    if (options.since !== undefined) {
      events = events.filter((event) => event.at >= options.since!);
    }

    events.sort((a, b) => b.at - a.at);
    return options.limit ? events.slice(0, options.limit) : events;
  }

  /**
   * The most recent verification recorded for a boundary, if any.
   *
   * Returns stored path summaries rather than full paths — enough to diff
   * against the next run, which is all the caller needs and all that survives
   * being written down.
   */
  async latestVerification(
    boundaryId: string,
    options: QueryOptions = {},
  ): Promise<PreviousVerification | null> {
    const events = await this.list({ ...options, boundaryId });
    const latest = events.find((event) => event.type === "boundary.verified");
    if (!latest || latest.detail?.kind !== "verification") return null;
    return { status: latest.detail.status, paths: latest.detail.paths ?? [] };
  }

  /**
   * Record a verification, and the transition if there is one.
   *
   * The previous verification is passed in rather than re-read, because the
   * caller (the scheduler, or the remediation flow) already holds it and
   * re-reading would race with a concurrent run.
   *
   * Returns the entries written, so a caller can surface them immediately
   * without a second round trip.
   */
  async recordVerification(
    boundary: SecurityBoundary,
    verification: BoundaryVerification,
    previous: PreviousVerification | null,
    options: QueryOptions = {},
  ): Promise<ChangeEvent[]> {
    const currentPaths = verification.paths.map(summarisePath);

    const detail: VerificationDetail = {
      kind: "verification",
      status: verification.status,
      pathCount: verification.paths.length,
      sourceCount: verification.sourceCount,
      targetCount: verification.targetCount,
      elapsedMs: Math.round(verification.elapsedMs),
      failureReason: verification.failureReason,
      paths: currentPaths,
    };

    const events: ChangeEvent[] = [
      event("boundary.verified", verification.verifiedAt, {
        actor: { kind: "tavik" },
        summary: verificationSummary(boundary, verification),
        boundaryId: boundary.id,
        environmentId: boundary.environmentId,
        detail,
      }),
    ];

    if (previous && previous.status !== verification.status) {
      const { appeared, resolved } = diffPathSummaries(previous.paths, currentPaths);
      events.push(
        event("boundary.status_changed", verification.verifiedAt, {
          actor: { kind: "tavik" },
          summary: describeStatusChange(
            boundary.name,
            previous.status,
            verification.status,
            appeared.length,
          ),
          boundaryId: boundary.id,
          environmentId: boundary.environmentId,
          detail: {
            kind: "status_change",
            from: previous.status,
            to: verification.status,
            appearedPaths: appeared,
            resolvedPaths: resolved,
          },
        }),
      );
    } else if (!previous) {
      // First evaluation is a transition from "not yet known".
      events.push(
        event("boundary.status_changed", verification.verifiedAt, {
          actor: { kind: "tavik" },
          summary: describeStatusChange(
            boundary.name,
            "unknown",
            verification.status,
            verification.paths.length,
          ),
          boundaryId: boundary.id,
          environmentId: boundary.environmentId,
          detail: {
            kind: "status_change",
            from: "unknown",
            to: verification.status,
            appearedPaths: currentPaths,
            resolvedPaths: [],
          },
        }),
      );
    }

    await this.append(events, options);
    return events;
  }
}

/** Build an event with a generated id. */
export function event(
  type: ChangeEventType,
  at: number,
  fields: {
    actor: ChangeActor;
    summary: string;
    boundaryId?: string;
    environmentId?: string;
    detail?: ChangeDetail;
  },
): ChangeEvent {
  return { id: randomUUID(), type, at, ...fields };
}

function actorName(actor: ChangeActor): string {
  switch (actor.kind) {
    case "tavik":
      return "Tavik";
    case "user":
      return actor.name;
    case "system":
      return actor.reason;
  }
}

function verificationSummary(
  boundary: SecurityBoundary,
  verification: BoundaryVerification,
): string {
  switch (verification.status) {
    case "verified":
      return `${boundary.name} verified. No path exists.`;
    case "violated":
      return verification.paths.length === 1
        ? `${boundary.name} violated. One reachable path.`
        : `${boundary.name} violated. ${verification.paths.length} reachable paths.`;
    case "investigating":
      return `${boundary.name} is under investigation.`;
    case "unknown":
      return `${boundary.name} could not be evaluated.`;
  }
}

function toChangeEvent(row: EventRow): ChangeEvent | null {
  const id = row.event_id;
  const type = row.type;
  if (typeof id !== "string" || typeof type !== "string") return null;

  const at = Number(row.at);
  if (!Number.isFinite(at)) return null;

  let detail: ChangeDetail | undefined;
  if (typeof row.detail_json === "string" && row.detail_json.length > 0) {
    try {
      detail = JSON.parse(row.detail_json) as ChangeDetail;
    } catch {
      // A corrupt payload must not discard the entry: the fact that something
      // happened, and when, is the part that matters for an audit trail.
      detail = undefined;
    }
  }

  const actorKind = String(row.actor_kind ?? "system");
  const actorLabel = String(row.actor_name ?? "");
  const actor: ChangeActor =
    actorKind === "tavik"
      ? { kind: "tavik" }
      : actorKind === "user"
        ? { kind: "user", id: actorLabel, name: actorLabel }
        : { kind: "system", reason: actorLabel };

  const boundaryId = String(row.boundary_id ?? "");
  const environmentId = String(row.environment_id ?? "");

  return {
    id,
    type: type as ChangeEventType,
    at,
    actor,
    summary: String(row.summary ?? ""),
    boundaryId: boundaryId.length > 0 ? boundaryId : undefined,
    environmentId: environmentId.length > 0 ? environmentId : undefined,
    detail,
  };
}
