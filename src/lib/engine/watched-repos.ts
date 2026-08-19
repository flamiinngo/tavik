import type { HydraClient, HydraParam, QueryOptions } from "@/lib/hydra/client";
import { identifier } from "@/lib/hydra/cypher";
import { urnToNodeId } from "@/lib/hydra/node-id";

/**
 * Repositories Tavik re-reads on its own.
 *
 * Rules are already re-checked every minute, but against a graph that only
 * changes when somebody scans. So Tavik would notice a rule breaking within a
 * minute of the *graph* changing, and never notice the graph needing to change
 * at all. Someone shipping a new dependency was invisible until a human
 * remembered to press a button, which is exactly the manual step the product
 * exists to remove.
 *
 * Watching a repository closes that. Tavik checks the commit its lockfile sits
 * on, and re-reads only when it has actually moved — the cheap question first,
 * so a quiet repository costs one small request rather than hundreds.
 *
 * Stored under their own `Watch` label, out of the `Entity` label that holds
 * security state, so a watch can never turn up inside a path.
 */

const WATCH_LABEL = "Watch";

export interface WatchedRepo {
  readonly owner: string;
  readonly repo: string;
  /** The commit its lockfile was last read at. */
  readonly lastSha: string;
  readonly lastCheckedAt: number;
  readonly lastChangedAt: number;
  /** Set when the most recent sync failed, so it can be shown rather than hidden. */
  readonly lastError?: string;
}

interface WatchRow {
  owner?: unknown;
  repo?: unknown;
  last_sha?: unknown;
  last_checked_at?: unknown;
  last_changed_at?: unknown;
  last_error?: unknown;
  [column: string]: unknown;
}

export class WatchStore {
  constructor(private readonly client: HydraClient) {}

  private key(owner: string, repo: string): string {
    return `tavik:watch:${owner}/${repo}`;
  }

  async watch(watched: WatchedRepo, options: QueryOptions = {}): Promise<void> {
    const label = identifier(WATCH_LABEL);
    await this.client.query(
      `UNWIND $rows AS row
       MERGE (n {id: row.id})
       SET n:${label.text}, n.owner = row.owner, n.repo = row.repo,
           n.last_sha = row.last_sha, n.last_checked_at = row.last_checked_at,
           n.last_changed_at = row.last_changed_at, n.last_error = row.last_error`,
      {
        ...options,
        parameters: {
          rows: [
            {
              id: urnToNodeId(this.key(watched.owner, watched.repo)),
              owner: watched.owner,
              repo: watched.repo,
              last_sha: watched.lastSha,
              last_checked_at: watched.lastCheckedAt,
              last_changed_at: watched.lastChangedAt,
              last_error: watched.lastError ?? "",
            },
          ] as unknown as HydraParam,
        },
      },
    );
  }

  async list(options: QueryOptions = {}): Promise<WatchedRepo[]> {
    const label = identifier(WATCH_LABEL);
    try {
      const result = await this.client.query<WatchRow>(
        `MATCH (w:${label.text})
         RETURN w.owner AS owner, w.repo AS repo, w.last_sha AS last_sha,
                w.last_checked_at AS last_checked_at,
                w.last_changed_at AS last_changed_at, w.last_error AS last_error`,
        options,
      );

      return result.rows
        .map((row): WatchedRepo | null => {
          const owner = String(row.owner ?? "");
          const repo = String(row.repo ?? "");
          if (!owner || !repo) return null;
          const error = String(row.last_error ?? "");
          return {
            owner,
            repo,
            lastSha: String(row.last_sha ?? ""),
            lastCheckedAt: Number(row.last_checked_at) || 0,
            lastChangedAt: Number(row.last_changed_at) || 0,
            lastError: error.length > 0 ? error : undefined,
          };
        })
        .filter((watched): watched is WatchedRepo => watched !== null)
        .sort((a, b) => a.owner.localeCompare(b.owner) || a.repo.localeCompare(b.repo));
    } catch {
      // A failure to read watches must not take down a sweep that can still
      // check every rule against the graph it already has.
      return [];
    }
  }

  async unwatch(owner: string, repo: string, options: QueryOptions = {}): Promise<void> {
    await this.client.query("MATCH (n {id: $id}) DETACH DELETE n", {
      ...options,
      parameters: { id: urnToNodeId(this.key(owner, repo)) },
    });
  }
}
