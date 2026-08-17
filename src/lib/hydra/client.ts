/**
 * HydraDB HTTP client.
 *
 * Written against the contract observed from a live server by
 * `npm run hydra:probe`, not against HydraDB's published documentation — the two
 * differ substantially. See docs/hydra.md. Re-run the probe after any upgrade.
 *
 * Two things this file exists to get right:
 *
 *   1. **Parameters.** The server accepts a `parameters` body field, so values
 *      travel as data rather than being concatenated into query text. Every
 *      value Tavik ingests is attacker-controlled (npm package names are
 *      published by anyone), so this is the primary injection defence.
 *   2. **Typed cells.** Rows come back as arrays of `{type, value}` envelopes,
 *      not bare values. Unwrapping them incorrectly would silently produce empty
 *      or wrong results — and an empty path result is exactly what Tavik reads
 *      as "this boundary is safe".
 */

import { HydraError, HydraProtocolError, HydraQueryError } from "./errors";

export type HydraRow = Record<string, unknown>;

/** Values accepted as query parameters. */
export type HydraParam =
  | string
  | number
  | boolean
  | null
  | readonly HydraParam[]
  | { readonly [key: string]: HydraParam };

/**
 * Read consistency.
 *
 * - `causal` (HydraDB's default) reads the current durable view.
 * - `strong` refreshes from object storage before pinning the query snapshot.
 *
 * Tavik uses `strong` for boundary verification: a verification result is a
 * safety claim, and the re-verification that follows a remediation must observe
 * the deletion that was just applied.
 */
export type ReadConsistency = "causal" | "strong";

export interface HydraClientConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly graphId: string;
  readonly namespace: string;
  readonly cellId: string;
  readonly timeoutMs: number;
}

export interface QueryOptions {
  readonly parameters?: Record<string, HydraParam>;
  readonly consistency?: ReadConsistency;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface QueryResult<T extends HydraRow = HydraRow> {
  readonly rows: readonly T[];
  readonly columns: readonly string[];
  readonly elapsedMs: number;
}

// ── Response envelope ───────────────────────────────────────────────────────

/** A node as returned inside a path value. */
export interface HydraNode {
  readonly id: number;
  readonly labels: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
}

/** A relationship as returned inside a path value. */
export interface HydraRelationship {
  readonly id: number;
  readonly edge_type: string;
  readonly src: number;
  readonly dst: number;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface HydraPath {
  readonly nodes: readonly HydraNode[];
  readonly relationships: readonly HydraRelationship[];
}

interface QueryEnvelope {
  query_id?: string;
  columns?: unknown;
  rows?: unknown;
}

/**
 * Unwrap a property value.
 *
 * Properties arrive tagged by type, e.g. `{"String": "lodash"}` or
 * `{"Integer": 3}`. A single-key object whose key is a known type tag is
 * unwrapped; anything else passes through untouched so unrecognised shapes are
 * visible rather than silently discarded.
 */
const PROPERTY_TAGS = new Set([
  "String",
  "Integer",
  "Float",
  "Boolean",
  "Null",
  "List",
]);

export function unwrapProperty(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 1 && PROPERTY_TAGS.has(keys[0])) {
    return (value as Record<string, unknown>)[keys[0]];
  }
  return value;
}

function unwrapProperties(
  properties: unknown,
): Record<string, unknown> {
  if (typeof properties !== "object" || properties === null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    out[key] = unwrapProperty(value);
  }
  return out;
}

/**
 * Unwrap a result cell.
 *
 * Cells are `{type, value}`. Scalars unwrap to their value; `vertex_id` unwraps
 * to the numeric id; `path` unwraps to a {@link HydraPath} with node and
 * relationship properties themselves unwrapped.
 */
export function unwrapCell(cell: unknown): unknown {
  if (typeof cell !== "object" || cell === null || Array.isArray(cell)) {
    return cell;
  }
  const record = cell as Record<string, unknown>;
  if (!("type" in record) || !("value" in record)) return cell;

  const { type, value } = record;

  if (type === "path" && typeof value === "object" && value !== null) {
    const raw = value as { nodes?: unknown[]; relationships?: unknown[] };
    return {
      nodes: (raw.nodes ?? []).map((node) => {
        const n = node as Record<string, unknown>;
        return {
          id: Number(n.id),
          labels: Array.isArray(n.labels) ? (n.labels as string[]) : [],
          properties: unwrapProperties(n.properties),
        } satisfies HydraNode;
      }),
      relationships: (raw.relationships ?? []).map((rel) => {
        const r = rel as Record<string, unknown>;
        return {
          id: Number(r.id),
          edge_type: String(r.edge_type),
          src: Number(r.src),
          dst: Number(r.dst),
          properties: unwrapProperties(r.properties),
        } satisfies HydraRelationship;
      }),
    } satisfies HydraPath;
  }

  return value;
}

/**
 * Turn a columnar envelope into row objects.
 *
 * Throws on an unrecognised envelope rather than returning `[]`. A silent empty
 * result would make every boundary look verified, which is the most dangerous
 * failure this system can produce.
 */
export function normalizeResult(payload: unknown): {
  rows: HydraRow[];
  columns: string[];
} {
  if (typeof payload !== "object" || payload === null) {
    throw new HydraProtocolError(
      `HydraDB returned a ${typeof payload} where a result envelope was expected.`,
    );
  }

  const envelope = payload as QueryEnvelope;

  if (!Array.isArray(envelope.columns) || !Array.isArray(envelope.rows)) {
    throw new HydraProtocolError(
      `Unrecognised HydraDB response envelope; expected 'columns' and 'rows' arrays. ` +
        `Run \`npm run hydra:probe\` to re-pin the contract. Received keys: ` +
        JSON.stringify(Object.keys(payload)),
    );
  }

  const columns = envelope.columns.map(String);
  const rows = envelope.rows.map((row) => {
    const record: HydraRow = {};
    if (Array.isArray(row)) {
      columns.forEach((column, index) => {
        record[column] = unwrapCell(row[index]);
      });
    }
    return record;
  });

  return { rows, columns };
}

export class HydraClient {
  constructor(private readonly config: HydraClientConfig) {}

  get endpoint(): string {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    return `${base}/v1/graphs/${encodeURIComponent(this.config.graphId)}/query`;
  }

  /**
   * Execute a single Cypher statement.
   *
   * HydraDB permits exactly one statement per request, so callers needing
   * several must sequence them — there is no transaction spanning calls. Batch
   * with `UNWIND $rows` instead.
   */
  async query<T extends HydraRow = HydraRow>(
    cypher: string,
    options: QueryOptions = {},
  ): Promise<QueryResult<T>> {
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });

    const startedAt = performance.now();
    try {
      const body: Record<string, unknown> = {
        cell_id: this.config.cellId,
        query: cypher,
      };
      if (options.parameters) body.parameters = options.parameters;
      if (options.consistency) body.consistency = options.consistency;

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "X-Graph-Namespace": this.config.namespace,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });

      const text = await response.text();

      if (!response.ok) {
        // HydraDB reports refusals as {error: {code, message}}. Its messages are
        // unusually specific about which clause is unsupported, so they are
        // surfaced verbatim rather than replaced with a generic failure.
        let serverMessage = text.slice(0, 500);
        try {
          const parsed = JSON.parse(text) as { error?: { message?: string } };
          if (parsed.error?.message) serverMessage = parsed.error.message;
        } catch {
          // keep the raw body
        }
        throw new HydraQueryError(
          `HydraDB refused the query (${response.status}): ${serverMessage}`,
          { status: response.status, cypher, responseBody: text },
        );
      }

      let payload: unknown;
      try {
        payload = text.length === 0 ? {} : JSON.parse(text);
      } catch {
        throw new HydraProtocolError(
          `HydraDB returned a non-JSON body (${response.status}): ${text.slice(0, 500)}`,
        );
      }

      const { rows, columns } = normalizeResult(payload);
      return {
        rows: rows as T[],
        columns,
        elapsedMs: performance.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof HydraError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new HydraQueryError(
          `HydraDB query exceeded ${timeoutMs}ms and was aborted.`,
          { cypher },
        );
      }
      throw new HydraQueryError(
        `Could not reach HydraDB at ${this.endpoint}. Is it running? ` +
          `Start it with \`npm run hydra:up\`.`,
        { cypher, cause: error },
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  /**
   * Liveness probe.
   *
   * A bare `RETURN 1` is rejected — the server only executes `MATCH ... RETURN`
   * — so this counts nodes of Tavik's label instead. An empty graph legitimately
   * returns zero, so success is "the query executed", not "rows came back".
   */
  async ping(options: QueryOptions = {}): Promise<boolean> {
    const result = await this.query("MATCH (n:Entity) RETURN count(*) AS total", {
      ...options,
      timeoutMs: options.timeoutMs ?? 5_000,
    });
    return result.columns.includes("total");
  }
}
