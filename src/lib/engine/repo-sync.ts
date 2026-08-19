import "server-only";

import { entityUrn } from "@/lib/domain/entities";
import {
  fetchLatestSha,
  fetchLockfile,
  fetchWorkflows,
  resolveDefaultBranch,
} from "@/lib/ingest/github";
import { parseAnyLockfile } from "@/lib/ingest/lockfiles/index";
import { ingestProject } from "@/lib/ingest/pipeline";
import { projectWorkflows } from "@/lib/ingest/workflows";
import { tavik } from "@/lib/server/tavik";
import type { WatchedRepo } from "./watched-repos";

/**
 * Re-reading watched repositories.
 *
 * This is what makes Tavik react to someone shipping code, rather than to
 * someone remembering to scan. Without it the rules were re-checked constantly
 * against a graph that only ever changed by hand — so a new dependency was
 * invisible until a human intervened, which is the manual step the product
 * exists to remove.
 *
 * Every sync asks the cheap question first: has the lockfile's commit moved? A
 * repository that has not changed costs one small request. Only when the answer
 * is yes does it pay for hundreds of registry lookups.
 */

export interface SyncOutcome {
  readonly repo: string;
  readonly changed: boolean;
  readonly error?: string;
  readonly packages?: number;
  readonly publishers?: number;
}

/**
 * Sync one repository.
 *
 * Never throws. A repository that has been deleted, renamed or made private must
 * not stop the others from syncing, and the failure is recorded on the watch so
 * it can be shown rather than silently retried forever.
 */
export async function syncRepo(watched: WatchedRepo): Promise<SyncOutcome> {
  const name = `${watched.owner}/${watched.repo}`;
  const { store, watches } = tavik();
  const now = Date.now();

  try {
    const branch = await resolveDefaultBranch({
      owner: watched.owner,
      repo: watched.repo,
    });
    const ref = { owner: watched.owner, repo: watched.repo, ref: branch };

    // Which lockfile this repository uses, and where its commit sits now.
    const lockfile = await fetchLockfile(ref);
    const sha = await fetchLatestSha(lockfile.ref, lockfile.path);

    // A null sha means "cannot tell", not "unchanged". Treating it as unchanged
    // would let a broken watch look healthy indefinitely.
    if (sha !== null && sha === watched.lastSha) {
      await watches.watch({ ...watched, lastCheckedAt: now, lastError: undefined });
      return { repo: name, changed: false };
    }

    const detected = parseAnyLockfile(lockfile.contents, lockfile.path);
    const report = await ingestProject(store, {
      lockfile: detected.graph,
      serviceName: name,
      environment: "production",
      trustedPublishers: new Set(),
      lockfilePath: `github.com/${name}/${lockfile.path}`,
    });

    // CI is part of the same picture, so a sync that skipped it would leave the
    // graph half fresh.
    const actions = await fetchWorkflows(lockfile.ref);
    if (actions.length > 0) {
      const projection = projectWorkflows(actions, {
        serviceUrn: entityUrn("Service", name),
        observedAt: now,
        trustedPublishers: new Set(),
      });
      await store.upsertEntities(projection.entities);
      await store.insertRelations(projection.relations);
    }

    await watches.watch({
      ...watched,
      lastSha: sha ?? watched.lastSha,
      lastCheckedAt: now,
      lastChangedAt: now,
      lastError: undefined,
    });

    return {
      repo: name,
      changed: true,
      packages: report.packagesResolved,
      publishers: report.maintainersFound,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    // Record the failure rather than swallowing it: a watch that has been
    // failing for a week should say so, not look like a quiet repository.
    await watches.watch({ ...watched, lastCheckedAt: now, lastError: message });
    return { repo: name, changed: false, error: message };
  }
}

/**
 * Sync every watched repository.
 *
 * Sequential on purpose. Each sync makes hundreds of registry requests, and
 * running several at once would hammer a public service that is being used for
 * free — the same restraint ingestion already applies within a single scan.
 */
export async function syncAllRepos(): Promise<SyncOutcome[]> {
  const watched = await tavik().watches.list();
  const outcomes: SyncOutcome[] = [];
  for (const repo of watched) {
    outcomes.push(await syncRepo(repo));
  }
  return outcomes;
}
