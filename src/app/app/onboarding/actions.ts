"use server";

import { revalidatePath } from "next/cache";

import { parseLockfile } from "@/lib/ingest/lockfile";
import { ingestProject } from "@/lib/ingest/pipeline";
import { tavik } from "@/lib/server/tavik";

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

export async function ingestLockfile(
  formData: FormData,
): Promise<IngestUploadResult> {
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
