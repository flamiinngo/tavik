"use server";

import { revalidatePath } from "next/cache";

import { syncRepo } from "@/lib/engine/repo-sync";
import { fetchLatestSha, fetchLockfile, GitHubError, parseRepoInput } from "@/lib/ingest/github";
import { gate } from "@/lib/server/operator";
import { invalidateSecurityState, tavik } from "@/lib/server/tavik";

/**
 * Watching a repository.
 *
 * Adding a watch does a full read immediately rather than waiting for the next
 * cycle. Someone who has just asked Tavik to watch something expects to see the
 * result, not a promise that it will look in fifteen minutes — and a first read
 * that happens now is also how the watch learns which commit it is starting
 * from.
 */

export interface WatchResult {
  readonly ok: boolean;
  readonly message: string;
  readonly repo?: string;
}

export async function addWatch(formData: FormData): Promise<WatchResult> {
  const allowed = await gate("scan");
  if (!allowed.allowed) return { ok: false, message: allowed.reason };

  const input = String(formData.get("repo") ?? "");
  const ref = parseRepoInput(input);

  if (!ref) {
    return { ok: false, message: "Paste a GitHub repository — a URL, or just owner/name." };
  }

  const name = `${ref.owner}/${ref.repo}`;

  try {
    // Confirm it is readable and has a lockfile before promising to watch it.
    // A watch on something Tavik cannot read is a row that fails quietly
    // forever, which is worse than refusing it now.
    const lockfile = await fetchLockfile(ref);
    const sha = await fetchLatestSha(lockfile.ref, lockfile.path);

    const { watches } = tavik();
    await watches.watch({
      owner: ref.owner,
      repo: ref.repo,
      // Deliberately empty, so the first sync sees a change and reads it in
      // full rather than assuming the current commit is already ingested.
      lastSha: "",
      lastCheckedAt: 0,
      lastChangedAt: 0,
    });

    const outcome = await syncRepo({
      owner: ref.owner,
      repo: ref.repo,
      lastSha: "",
      lastCheckedAt: 0,
      lastChangedAt: 0,
    });

    // The held verdict is now out of date. Clearing it before the page
    // cache means the next read re-checks against what just changed.
    invalidateSecurityState();
    revalidatePath("/app");
    revalidatePath("/app/watches");
    revalidatePath("/app/boundaries");

    if (outcome.error) {
      return { ok: false, message: outcome.error };
    }

    return {
      ok: true,
      repo: name,
      message: `Watching ${name}. Read ${outcome.packages ?? 0} packages from ${
        outcome.publishers ?? 0
      } publishers${sha ? ` at ${sha.slice(0, 7)}` : ""}.`,
    };
  } catch (error) {
    if (error instanceof GitHubError) {
      return { ok: false, message: error.message };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Couldn't watch that repository.",
    };
  }
}

export async function removeWatch(owner: string, repo: string): Promise<WatchResult> {
  const allowed = await gate("scan");
  if (!allowed.allowed) return { ok: false, message: allowed.reason };

  try {
    await tavik().watches.unwatch(owner, repo);
    // The held verdict is now out of date. Clearing it before the page
    // cache means the next read re-checks against what just changed.
    invalidateSecurityState();
    revalidatePath("/app/watches");
    return { ok: true, message: `Stopped watching ${owner}/${repo}.` };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Couldn't stop watching that.",
    };
  }
}

/** Re-read one repository now, rather than waiting for the next cycle. */
export async function syncNow(owner: string, repo: string): Promise<WatchResult> {
  const allowed = await gate("scan");
  if (!allowed.allowed) return { ok: false, message: allowed.reason };

  try {
    const watched = (await tavik().watches.list()).find(
      (candidate) => candidate.owner === owner && candidate.repo === repo,
    );
    if (!watched) return { ok: false, message: "That repository isn't being watched." };

    const outcome = await syncRepo(watched);
    // The held verdict is now out of date. Clearing it before the page
    // cache means the next read re-checks against what just changed.
    invalidateSecurityState();
    revalidatePath("/app");
    revalidatePath("/app/watches");

    return {
      ok: !outcome.error,
      message: outcome.error
        ? outcome.error
        : outcome.changed
          ? `${outcome.repo} had changed — re-read ${outcome.packages} packages.`
          : `${outcome.repo} hasn't changed since Tavik last looked.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Couldn't sync that repository.",
    };
  }
}
