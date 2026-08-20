"use server";

import { revalidatePath } from "next/cache";

import { parseLockfile } from "@/lib/ingest/lockfile";
import { ingestProject } from "@/lib/ingest/pipeline";
import { gate } from "@/lib/server/operator";
import { scanRepository } from "./github-actions";
import { seedStarterRules, tavik } from "@/lib/server/tavik";

/**
 * The project the sample button reads.
 *
 * Small enough to finish while somebody is still watching — around half a
 * minute — and real enough to find something. It is a widely used package with
 * a deep development tree, so the routes it turns up are genuine multi-hop
 * chains rather than a single direct dependency.
 */
const SAMPLE_REPOSITORY = "motdotla/dotenv";

/**
 * Ingest a project someone brings themselves.
 *
 * This is what makes Tavik a product rather than a demo of one. Everything the
 * engine does — the graph, the routes, the proof — is built from whatever
 * lockfile is handed to it, so anyone can point it at their own repository and
 * get answers about their own dependencies rather than ours.
 *
 * The lockfile is parsed and validated before anything touches the database, and
 * every package name in it is treated as untrusted: names come from the public
 * registry, where anyone can publish, and they flow into Cypher text. See
 * lib/hydra/cypher.ts.
 */

export interface IngestUploadResult {
  readonly ok: boolean;
  readonly message: string;
  readonly serviceName?: string;
  readonly packages?: number;
  readonly publishers?: number;
  readonly relationships?: number;
  readonly elapsedMs?: number;
  /** Registry lookups that failed. Surfaced, never hidden. */
  readonly failures?: number;
}

/** Guard against a paste or upload large enough to stall the server. */
const MAX_LOCKFILE_BYTES = 12 * 1024 * 1024;

/**
 * Scan a public project, as an example.
 *
 * A fresh workspace is genuinely empty, which is right — but someone evaluating
 * Tavik in five minutes should not have to go and find a lockfile before they
 * can see anything work.
 *
 * Labelled as an example everywhere it appears. It is not a fixture: the same
 * pipeline, the same live registry lookups, the same graph — just a project we
 * can point at without asking for one.
 */
export async function ingestSampleProject(): Promise<IngestUploadResult> {
  const allowed = await gate("scan");
  if (!allowed.allowed) return { ok: false, message: allowed.reason };

  // Reads a public repository rather than Tavik's own lockfile off disk.
  //
  // The disk version worked on a developer machine and could not work anywhere
  // else: it resolved `package-lock.json` from the working directory, and a
  // dynamic path like that is invisible to Next's file tracing, so the file
  // never shipped. On the hosted demo the most obvious button on an empty
  // workspace answered "Couldn't read the sample project" — the worst possible
  // first impression, and one that only appears once deployed.
  //
  // Going through the GitHub path fixes it and is better anyway. A named public
  // project is easier to explain than a tool scanning itself, and it is the
  // identical code path someone takes when they paste a repository of their
  // own — so the button demonstrates the thing it is inviting you to do.
  const formData = new FormData();
  formData.set("repo", SAMPLE_REPOSITORY);

  const result = await scanRepository(formData);

  return {
    ok: result.ok,
    message: result.message,
    serviceName: result.repo,
    packages: result.packages,
    publishers: result.publishers,
    elapsedMs: result.elapsedMs,
    failures: result.failures,
  };
}

/**
 * Empty the workspace.
 *
 * Exists so the first-run experience can actually be tried more than once —
 * without it, "what does a new user see?" is unanswerable after the first scan.
 */
export async function resetWorkspace(): Promise<{ ok: boolean; message: string }> {
  const allowed = await gate("manageWorkspace");
  if (!allowed.allowed) return { ok: false, message: allowed.reason };

  try {
    const { store, rules } = tavik();
    for (const rule of await rules.list()) {
      await rules.remove(rule.id);
    }
    await store.clear();

    revalidatePath("/");
    revalidatePath("/app");
    revalidatePath("/app/boundaries");
    return { ok: true, message: "Workspace cleared. Tavik has nothing to watch." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Couldn't clear the workspace.",
    };
  }
}

export async function ingestLockfile(
  formData: FormData,
): Promise<IngestUploadResult> {
  const allowed = await gate("scan");
  if (!allowed.allowed) return { ok: false, message: allowed.reason };

  const file = formData.get("lockfile");
  const pasted = formData.get("contents");
  const serviceName = String(formData.get("serviceName") ?? "").trim();
  const environment = String(formData.get("environment") ?? "production").trim();

  let raw: string;
  try {
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_LOCKFILE_BYTES) {
        return {
          ok: false,
          message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_LOCKFILE_BYTES / 1024 / 1024} MB.`,
        };
      }
      raw = await file.text();
    } else if (typeof pasted === "string" && pasted.trim().length > 0) {
      if (pasted.length > MAX_LOCKFILE_BYTES) {
        return { ok: false, message: "That's too large to paste. Upload the file instead." };
      }
      raw = pasted;
    } else {
      return { ok: false, message: "Choose a package-lock.json file, or paste its contents." };
    }
  } catch {
    return { ok: false, message: "That file could not be read." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      message: "That isn't valid JSON. Make sure it's a package-lock.json, not a package.json.",
    };
  }

  // Fail on the lockfile's own terms before touching the database, so the error
  // names the actual problem rather than surfacing as a graph failure later.
  let graph;
  try {
    graph = parseLockfile(parsed);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "That doesn't look like a package-lock.json.",
    };
  }

  if (graph.packages.length <= 1) {
    return {
      ok: false,
      message:
        "That lockfile has no dependencies in it, so there is nothing to check. " +
        "Try a project with packages installed.",
    };
  }

  try {
    const report = await ingestProject(tavik().store, {
      lockfile: parsed,
      serviceName: serviceName.length > 0 ? serviceName : undefined,
      environment: environment.length > 0 ? environment : "production",
      // Nothing is trusted by default. A new workspace has reviewed nobody yet,
      // which is the honest starting position — and it is what makes the first
      // result meaningful rather than empty.
      trustedPublishers: new Set(),
      lockfilePath: file instanceof File ? file.name : "pasted",
    });

    // Rules arrive with the first scan, not on the first page view. A workspace
    // that has something to protect should have something checking it; one that
    // doesn't should be empty.
    await seedStarterRules();

    revalidatePath("/");
    revalidatePath("/app");
    revalidatePath("/app/boundaries");

    return {
      ok: true,
      message: `Done. Tavik mapped ${report.packagesResolved.toLocaleString()} packages and ${report.maintainersFound.toLocaleString()} publishers.`,
      serviceName: String(report.serviceUrn).split(":").slice(2).join(":"),
      packages: report.packagesResolved,
      publishers: report.maintainersFound,
      relationships: report.relationsWritten + report.relationsUnchanged,
      elapsedMs: report.elapsedMs,
      failures: report.failures.length,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Ingestion failed: ${error.message}`
          : "Ingestion failed.",
    };
  }
}
