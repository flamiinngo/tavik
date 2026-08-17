/**
 * Ingestion pipeline: real sources in, security state graph out.
 *
 * Combines the two halves of the supply-chain picture. A lockfile gives the
 * versions actually resolved and which service consumes them; the registry gives
 * who can publish those packages. Neither alone answers the product's question.
 * Together they complete the chain:
 *
 *   Maintainer -[:MAINTAINS]-> Package -[:HAS_RELEASE]-> Release -[:SUPPLIES]-> Service
 *
 * which is exactly what a boundary traverses to ask "can an untrusted publisher
 * reach production?"
 *
 * Ordering matters: entities are written before relations, because HydraDB
 * matches edge endpoints by id and silently writes nothing for an endpoint that
 * does not exist yet. A missing edge is a path Tavik will never find, and an
 * incomplete graph reports boundaries as verified that may not be.
 */

import type { Entity, EntityUrn, Relation } from "@/lib/domain/entities";
import type { GraphStore } from "@/lib/hydra/graph-store";
import { parseLockfile, projectLockfile } from "./lockfile";
import {
  ingestMaintainers,
  publisherConcentration,
  type PublisherConcentration,
} from "./maintainers";

export interface IngestOptions {
  /** Raw contents of a `package-lock.json`. */
  readonly lockfile: unknown;
  /** Name for the service this lockfile belongs to. Defaults to the project name. */
  readonly serviceName?: string;
  /** Environment the service runs in — what a boundary's target selector matches. */
  readonly environment: string;
  /** Accounts this workspace trusts. See the note in maintainers.ts. */
  readonly trustedPublishers: ReadonlySet<string>;
  readonly lockfilePath: string;
  readonly observedAt?: number;
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (stage: IngestStage, done: number, total: number) => void;
}

/** Stages, in the order they run. Rendered by the onboarding sequence. */
export type IngestStage =
  | "reading-lockfile"
  | "resolving-publishers"
  | "writing-entities"
  | "writing-relations";

export interface IngestReport {
  readonly serviceUrn: EntityUrn;
  readonly entitiesWritten: number;
  readonly relationsWritten: number;
  readonly packagesResolved: number;
  readonly maintainersFound: number;
  readonly untrustedMaintainers: number;
  /** Packages the registry could not answer for. Surfaced, never hidden. */
  readonly failures: readonly { readonly packageName: string; readonly reason: string }[];
  /** Dependencies present in the lockfile that did not resolve to an entry. */
  readonly unresolvedDependencies: number;
  /** Publishers ranked by how many packages in the tree they can push to. */
  readonly concentration: readonly PublisherConcentration[];
  readonly elapsedMs: number;
}

/**
 * Build the security state for one service and write it to HydraDB.
 *
 * Idempotent: entities upsert on a derived id, so re-running converges rather
 * than duplicating.
 */
export async function ingestProject(
  store: GraphStore,
  options: IngestOptions,
): Promise<IngestReport> {
  const startedAt = Date.now();
  const observedAt = options.observedAt ?? startedAt;

  // ── 1. Lockfile: services, releases, and who supplies whom ────────────────
  options.onProgress?.("reading-lockfile", 0, 1);
  const graph = parseLockfile(options.lockfile);
  const projection = projectLockfile(graph, {
    serviceName: options.serviceName,
    environment: options.environment,
    observedAt,
    lockfilePath: options.lockfilePath,
  });
  options.onProgress?.("reading-lockfile", 1, 1);

  // Which versions of each package the lockfile actually pinned. Grouped so the
  // registry is asked once per package rather than once per resolved version —
  // a real tree repeats the same package name many times.
  const packageVersions = new Map<string, Set<string>>();
  for (const pkg of graph.packages) {
    if (pkg.path === "") continue;
    const versions = packageVersions.get(pkg.name);
    if (versions) versions.add(pkg.version);
    else packageVersions.set(pkg.name, new Set([pkg.version]));
  }

  // ── 2. Registry: publish rights ───────────────────────────────────────────
  const maintainers = await ingestMaintainers(packageVersions, {
    trustedPublishers: options.trustedPublishers,
    observedAt,
    concurrency: options.concurrency,
    signal: options.signal,
    onProgress: (done, total) => options.onProgress?.("resolving-publishers", done, total),
  });

  // ── 3. Write ──────────────────────────────────────────────────────────────
  const entities: Entity[] = [...projection.entities, ...maintainers.entities];
  const relations: Relation[] = [...projection.relations, ...maintainers.relations];

  options.onProgress?.("writing-entities", 0, entities.length);
  const entitiesWritten = await store.upsertEntities(entities, { signal: options.signal });
  options.onProgress?.("writing-entities", entities.length, entities.length);

  options.onProgress?.("writing-relations", 0, relations.length);
  const relationsWritten = await store.insertRelations(relations, { signal: options.signal });
  options.onProgress?.("writing-relations", relations.length, relations.length);

  return {
    serviceUrn: projection.serviceUrn,
    entitiesWritten,
    relationsWritten,
    packagesResolved: maintainers.stats.packagesResolved,
    maintainersFound: maintainers.stats.maintainersFound,
    untrustedMaintainers: maintainers.stats.untrustedMaintainers,
    failures: maintainers.failures,
    unresolvedDependencies: graph.unresolved.length,
    concentration: publisherConcentration(maintainers),
    elapsedMs: Date.now() - startedAt,
  };
}
