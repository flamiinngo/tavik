"use server";

import { revalidatePath } from "next/cache";

import { entityUrn } from "@/lib/domain/entities";
import {
  fetchLockfile,
  fetchWorkflows,
  GitHubError,
  parseRepoInput,
} from "@/lib/ingest/github";
import { parseLockfile } from "@/lib/ingest/lockfile";
import { ingestProject } from "@/lib/ingest/pipeline";
import { projectWorkflows } from "@/lib/ingest/workflows";
import { gate } from "@/lib/server/operator";
import { seedStarterRules, tavik } from "@/lib/server/tavik";

/**
 * Scan a GitHub repository.
 *
 * Uploading a file proves the engine works; pointing Tavik at a repository is
 * how anyone would actually use it — and it lets someone evaluate this against
 * code they already know rather than code we handed them.
 *
 * Two surfaces are read, not one:
 *
 *   the lockfile   — what the project installs and runs
 *   the workflows  — whose code executes in CI, holding CI's secrets
 *
 * The second is the more under-watched of the two and shares the same shape, so
 * a single rule covers both without needing to know they are different things.
 */

export interface ScanRepoResult {
  readonly ok: boolean;
  readonly message: string;
  readonly repo?: string;
  readonly packages?: number;
  readonly publishers?: number;
  readonly actions?: number;
  readonly actionPublishers?: number;
  readonly unpinnedActions?: number;
  readonly elapsedMs?: number;
  readonly failures?: number;
}

export async function scanRepository(formData: FormData): Promise<ScanRepoResult> {
  const allowed = await gate("scan");
  if (!allowed.allowed) return { ok: false, message: allowed.reason };

  const input = String(formData.get("repo") ?? "");
  const ref = parseRepoInput(input);

  if (!ref) {
    return {
      ok: false,
      message: "Paste a GitHub repository — a URL, or just owner/name.",
    };
  }

  const startedAt = Date.now();

  try {
    const lockfile = await fetchLockfile(ref);
    const parsed = JSON.parse(lockfile.contents) as unknown;

    // Fail on the lockfile's own terms before touching the database.
    parseLockfile(parsed);

    const serviceName = `${ref.owner}/${ref.repo}`;
    const report = await ingestProject(tavik().store, {
      lockfile: parsed,
      serviceName,
      environment: "production",
      trustedPublishers: new Set(),
      lockfilePath: `github.com/${serviceName}/${lockfile.path}`,
    });

    // ── The second surface ────────────────────────────────────────────────
    let actions = 0;
    let actionPublishers = 0;
    let unpinnedActions = 0;

    const workflowActions = await fetchWorkflows(lockfile.ref);
    if (workflowActions.length > 0) {
      const projection = projectWorkflows(workflowActions, {
        serviceUrn: entityUrn("Service", serviceName),
        observedAt: Date.now(),
        trustedPublishers: new Set(),
      });

      const { store } = tavik();
      await store.upsertEntities(projection.entities);
      await store.insertRelations(projection.relations);

      actions = projection.actionCount;
      actionPublishers = projection.publisherCount;
      unpinnedActions = projection.unpinnedCount;
    }

    await seedStarterRules();

    revalidatePath("/");
    revalidatePath("/app");
    revalidatePath("/app/boundaries");

    return {
      ok: true,
      message: `Scanned ${serviceName}.`,
      repo: serviceName,
      packages: report.packagesResolved,
      publishers: report.maintainersFound,
      actions,
      actionPublishers,
      unpinnedActions,
      elapsedMs: Date.now() - startedAt,
      failures: report.failures.length,
    };
  } catch (error) {
    if (error instanceof GitHubError) {
      // These messages are written to be actionable — which repository, what was
      // found instead, what to do about it — so they are shown as-is.
      return { ok: false, message: error.message };
    }
    if (error instanceof SyntaxError) {
      return { ok: false, message: "That repository's lockfile isn't valid JSON." };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The scan failed.",
    };
  }
}
