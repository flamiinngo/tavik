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
import { type LockfileGraph, parseLockfile, projectLockfile } from "./lockfile";

/** A value that has already been parsed into a lockfile graph. */
function isLockfileGraph(value: unknown): value is LockfileGraph {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as LockfileGraph).packages) &&
    Array.isArray((value as LockfileGraph).edges)
  );
}
import {
  ingestMaintainers,
  publisherConcentration,
  type PublisherConcentration,
} from "./maintainers";

export interface IngestOptions {
  /**
   * A parsed lockfile graph, or the raw contents of one.
   *
   * Accepting both lets callers that already know the format hand over a parsed
   * graph, while simpler ones pass the file through and let detection sort it
   * out. Everything downstream sees the same shape either way.
   */
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
  /** Relationships newly created by this run. */
  readonly relationsWritten: number;
  /** Relationships that already existed and were left untouched. */
  readonly relationsUnchanged: number;
  /**
   * Dependencies this project used to have and no longer does.
   *
   * Reported because it is the number that proves a fix worked. A team that
   * removes a bad package wants to see Tavik notice, not just stop complaining.
   */
  readonly relationsRemoved: number;
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
  const graph = isLockfileGraph(options.lockfile)
    ? options.lockfile
    : parseLockfile(options.lockfile);
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

  // Write only the edges that are not already present.
  //
  // HydraDB refuses `MERGE` for batched edge writes, so a re-run using `CREATE`
  // would duplicate every edge. The obvious alternative — delete each type and
  // rewrite it — was tried and is far worse: HydraDB is log-structured, and
  // deleting several thousand edges left enough tombstones to slow every
  // subsequent read, taking a boundary check from 420ms to 31s until it timed
  // out and reported `unknown`. A clean rebuild restored 420ms, confirming the
  // churn rather than the data volume was the cause.
  //
  // So ingestion diffs instead. It is also better product behaviour: the
  // difference is the change, and the change is what the log wants to record.
  const kinds = new Set(relations.map((relation) => relation.kind));
  const existing = new Map<string, Set<string>>();
  for (const kind of kinds) {
    existing.set(kind, await store.listRelationsOfKind(kind, { signal: options.signal }));
  }

  // Deduplicate within the batch as well as against what is stored. The same
  // edge is frequently produced twice in one run — a package supplying two
  // dependents, a workflow used by several jobs — and writing it twice creates
  // exactly the duplicate edges this diff exists to prevent.
  const emitted = new Set<string>();
  const newRelations = relations.filter((relation) => {
    const key = `${relation.from}|${relation.to}`;
    if (existing.get(relation.kind)?.has(key)) return false;
    const batchKey = `${relation.kind}|${key}`;
    if (emitted.has(batchKey)) return false;
    emitted.add(batchKey);
    return true;
  });

  const relationsWritten = await store.insertRelations(newRelations, {
    signal: options.signal,
  });
  options.onProgress?.("writing-relations", relations.length, relations.length);

  const relationsUnchanged = relations.length - newRelations.length;

  // ── 4. Forget what this project no longer depends on ──────────────────────
  //
  // Without this, ingestion only ever adds. A team that removes a bad
  // dependency and re-scans is still told it is there, because the edge from
  // the old release into their service was never taken away. The rule stays red
  // forever, and the product's central promise — fix it, re-scan, watch it go
  // green — quietly stops being true. Measured: dependency deleted from
  // package.json, lockfile rebuilt, re-scan clean, and Tavik still reported the
  // route.
  //
  // Scoped to edges pointing *at this service*, and nothing else. The rest of
  // the graph is shared: `flatten supplies postcss-values-parser` is a fact
  // about the ecosystem that stays true no matter who scans, and one project's
  // scan has no business deleting another project's routes. What a lockfile is
  // authoritative about is which releases supply *its own* service — so that,
  // and only that, is reconciled.
  const relationsRemoved = await forgetDepartedDependencies(
    store,
    projection.serviceUrn,
    relations,
    // Read separately rather than reusing the diff above, which only fetched the
    // kinds this scan happens to produce. A project that removed its last
    // dependency emits no SUPPLIES edges at all — so the lookup was skipped in
    // precisely the case where there is most to forget, and the graph kept every
    // route into a service that now depends on nothing.
    await store.listRelationsOfKind("SUPPLIES", { signal: options.signal }),
    options.signal,
  );

  return {
    serviceUrn: projection.serviceUrn,
    entitiesWritten,
    relationsWritten,
    relationsUnchanged,
    relationsRemoved,
    packagesResolved: maintainers.stats.packagesResolved,
    maintainersFound: maintainers.stats.maintainersFound,
    untrustedMaintainers: maintainers.stats.untrustedMaintainers,
    failures: maintainers.failures,
    unresolvedDependencies: graph.unresolved.length,
    concentration: publisherConcentration(maintainers),
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * Remove edges into this service that its lockfile no longer produces.
 *
 * Deliberately narrow. Deleting is the dangerous direction — a route wrongly
 * removed is a boundary reported safe that is not, which is the worst thing this
 * system can do — so this only touches `SUPPLIES` edges whose target is the
 * service being scanned. Those are exactly the edges the lockfile in hand is
 * authoritative about: it is the complete statement of what this project
 * installs. Everything else in the graph belongs to someone else's scan or is a
 * fact about the wider ecosystem, and is left alone.
 *
 * A removed transitive dependency is handled by the same rule without needing a
 * special case: whichever release stops supplying the service loses its edge,
 * and every route that ran through it disappears with it.
 */
async function forgetDepartedDependencies(
  store: GraphStore,
  serviceUrn: EntityUrn,
  relations: readonly Relation[],
  storedSupplies: ReadonlySet<string> | undefined,
  signal: AbortSignal | undefined,
): Promise<number> {
  if (!storedSupplies) return 0;

  // What this scan says supplies the service.
  const current = new Set<string>();
  for (const relation of relations) {
    if (relation.kind === "SUPPLIES" && relation.to === serviceUrn) {
      current.add(`${relation.from}|${relation.to}`);
    }
  }

  const suffix = `|${serviceUrn}`;
  const departed: string[] = [];
  for (const key of storedSupplies) {
    if (key.endsWith(suffix) && !current.has(key)) departed.push(key);
  }

  let removed = 0;
  for (const key of departed) {
    const from = key.slice(0, key.length - suffix.length) as EntityUrn;
    try {
      await store.deleteRelation(from, serviceUrn, "SUPPLIES", { signal });
      removed++;
    } catch {
      // One failed delete must not abandon a scan that has already written
      // everything else. The stale edge produces a route that no longer exists —
      // a false alarm, not a false all-clear — and the next scan tries again.
    }
  }

  return removed;
}
