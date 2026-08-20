"use server";

import { revalidatePath } from "next/cache";

import { IamParseError, projectIamExport } from "@/lib/ingest/iam";
import { gate } from "@/lib/server/operator";
import { invalidateSecurityState, seedStarterRules, tavik } from "@/lib/server/tavik";

/**
 * Ingest an AWS IAM account export.
 *
 * The second domain, arriving through the same door as the first. Everything
 * downstream — the graph, the rules, the verifier, the remediation — is
 * unchanged; only the adapter differs. A boundary asking "can CI reach customer
 * data?" is answered by exactly the code that answers "can an outside publisher
 * reach production?".
 */

export interface IamUploadResult {
  readonly ok: boolean;
  readonly message: string;
  readonly roles?: number;
  readonly datastores?: number;
  readonly ciIdentities?: number;
  readonly assumptions?: number;
  readonly elapsedMs?: number;
}

const MAX_BYTES = 25 * 1024 * 1024;

export async function ingestIamExport(formData: FormData): Promise<IamUploadResult> {
  const allowed = await gate("scan");
  if (!allowed.allowed) return { ok: false, message: allowed.reason };

  const file = formData.get("iam");
  const pasted = formData.get("contents");
  const environment = String(formData.get("environment") ?? "production").trim();
  const startedAt = Date.now();

  let raw: string;
  try {
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) {
        return {
          ok: false,
          message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_BYTES / 1024 / 1024} MB.`,
        };
      }
      raw = await file.text();
    } else if (typeof pasted === "string" && pasted.trim().length > 0) {
      raw = pasted;
    } else {
      return {
        ok: false,
        message:
          "Choose the JSON from `aws iam get-account-authorization-details`, or paste it.",
      };
    }
  } catch {
    return { ok: false, message: "That file could not be read." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: "That isn't valid JSON." };
  }

  try {
    const projection = projectIamExport(parsed, {
      environment: environment.length > 0 ? environment : "production",
      observedAt: Date.now(),
    });

    const { store } = tavik();
    await store.upsertEntities(projection.entities);
    await store.insertRelations(projection.relations);
    await seedStarterRules();

    // The held verdict is now out of date. Clearing it before the page
    // cache means the next read re-checks against what just changed.
    invalidateSecurityState();
    revalidatePath("/");
    revalidatePath("/app");
    revalidatePath("/app/boundaries");

    return {
      ok: true,
      message:
        projection.ciIdentities > 0
          ? `Mapped ${projection.roles} roles. ${projection.ciIdentities} CI identit${projection.ciIdentities === 1 ? "y" : "ies"} can assume roles in this account.`
          : `Mapped ${projection.roles} roles. No CI identities found — Tavik looks for trust policies naming GitHub Actions, GitLab, CircleCI, CodeBuild or roles named like pipelines.`,
      roles: projection.roles,
      datastores: projection.datastores,
      ciIdentities: projection.ciIdentities,
      assumptions: projection.assumptions,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof IamParseError) {
      return { ok: false, message: error.message };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The import failed.",
    };
  }
}
