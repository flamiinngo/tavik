/**
 * Maintainer ingestion — publish rights as graph edges.
 *
 * This is the piece that makes Tavik's supply-chain boundary meaningful. A
 * lockfile tells you which *versions* you depend on today. It does not tell you
 * who can publish the next one, and that is where the risk actually lives: in
 * every large npm compromise, the artifact was malicious because an *account*
 * was taken over, not because a specific version was known-bad in advance.
 *
 * So the edge that matters is `Maintainer -[:MAINTAINS]-> Package`. It is a path
 * to every future release, not only the ones that exist now, and it makes
 * publisher concentration visible: one account holding publish rights over many
 * packages in your tree is a single point of failure regardless of whether
 * anything has gone wrong yet.
 *
 * ── On naming real people ──────────────────────────────────────────────────
 *
 * Real, named, well-regarded maintainers appear in this graph. Tavik never
 * describes any of them as compromised, malicious, or untrustworthy — that would
 * be false and defamatory. It states one capability fact: whether the account is
 * on *this workspace's* allowlist. That is what an allowlist means, it is true by
 * construction, and it is how real supply-chain policy works. The resulting
 * finding is publisher concentration risk, which is a standard metric, fairly
 * stated.
 *
 * `trust` is therefore a Tavik-assigned label reflecting a customer's own policy.
 * It is never a claim by npm and never a judgement about a person.
 */

import {
  type Entity,
  type EntityUrn,
  type Relation,
  entityUrn,
} from "@/lib/domain/entities";
import { fetchPackument, isValidPackageName, RegistryError } from "./npm-registry";

/** Trust is our policy label, not a statement about anyone's conduct. */
export type TrustLabel = "trusted" | "untrusted";

export interface MaintainerIngestOptions {
  /**
   * Accounts this workspace has decided to trust — typically its own
   * organisation's publishers. Everything else is simply "not on the list".
   */
  readonly trustedPublishers: ReadonlySet<string>;
  /** Epoch ms recorded on every relation produced by this run. */
  readonly observedAt: number;
  /**
   * Parallel registry requests. Kept modest by default: the public registry is
   * a shared resource and Tavik is not entitled to saturate it.
   */
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  /** Progress reporting, for the onboarding analysis sequence. */
  readonly onProgress?: (done: number, total: number, packageName: string) => void;
}

export interface MaintainerIngestResult {
  readonly entities: readonly Entity[];
  readonly relations: readonly Relation[];
  /** Packages the registry could not answer for, with the reason. */
  readonly failures: readonly { readonly packageName: string; readonly reason: string }[];
  readonly stats: {
    readonly packagesRequested: number;
    readonly packagesResolved: number;
    readonly maintainersFound: number;
    readonly untrustedMaintainers: number;
  };
}

// Measured rather than guessed. On warm connections, 50 packages took 6802ms at
// a concurrency of 6, 4688ms at 12, and 4224ms at 24 — so 6 was leaving real
// time on the table, and anything past 12 buys almost nothing. Twelve is where
// the registry stops being the bottleneck, which is also where asking it for
// more would be taking without getting.
const DEFAULT_CONCURRENCY = 12;

/**
 * Run an async mapper over items with a bounded number in flight.
 *
 * Written out rather than pulled in as a dependency, and bounded rather than
 * `Promise.all` over the whole list: ingesting a real lockfile means hundreds of
 * packages, and firing hundreds of simultaneous requests at a public registry is
 * both rude and a good way to get rate-limited mid-run.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Fetch publish rights for a set of packages and project them into the graph.
 *
 * Produces:
 *   (:Maintainer) -[:MAINTAINS]->   (:Package)
 *   (:Package)    -[:HAS_RELEASE]-> (:Release)
 *
 * `HAS_RELEASE` is what connects publish rights to the concrete versions a
 * lockfile pinned, completing the chain from a publisher to a running service.
 *
 * A package the registry cannot answer for is recorded in `failures` rather than
 * dropped. Silently omitting it would remove edges from the graph, and a missing
 * edge is a path Tavik will never find — an incomplete graph reports boundaries
 * as verified that may not be.
 */
export async function ingestMaintainers(
  packageVersions: ReadonlyMap<string, ReadonlySet<string>>,
  options: MaintainerIngestOptions,
): Promise<MaintainerIngestResult> {
  const packageNames = [...packageVersions.keys()].filter(isValidPackageName);

  const entities = new Map<EntityUrn, Entity>();
  const relations: Relation[] = [];
  const failures: { packageName: string; reason: string }[] = [];
  const maintainerHandles = new Set<string>();

  let completed = 0;

  await mapWithConcurrency(
    packageNames,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async (packageName) => {
      try {
        // `includeMetadata` costs a larger document but is the only way to get
        // maintainers — the abbreviated packument omits them entirely.
        const packument = await fetchPackument(packageName, {
          includeMetadata: true,
          signal: options.signal,
        });

        const packageUrn = entityUrn("Package", packageName);
        entities.set(packageUrn, {
          urn: packageUrn,
          kind: "Package",
          name: packageName,
          source: "npm-registry",
          attributes: {
            maintainerCount: packument.maintainers.length,
            latest: packument.distTags.latest ?? "",
            // Bus factor. A package only one account can publish to has no
            // second pair of eyes and no recovery path if that account is lost
            // or taken over — a real, standard supply-chain concern, and one
            // that is a fact about the registry rather than a judgement.
            sole_publisher: packument.maintainers.length === 1,
          },
        });

        // Publish rights.
        for (const handle of packument.maintainers) {
          maintainerHandles.add(handle);
          const maintainerUrn = entityUrn("Maintainer", handle);
          const trust: TrustLabel = options.trustedPublishers.has(handle)
            ? "trusted"
            : "untrusted";

          entities.set(maintainerUrn, {
            urn: maintainerUrn,
            kind: "Maintainer",
            name: handle,
            source: "npm-registry",
            attributes: { trust, registry: "npmjs.org" },
          });

          relations.push({
            from: maintainerUrn,
            to: packageUrn,
            kind: "MAINTAINS",
            source: "npm-registry",
            observedAt: options.observedAt,
            evidence: `npm maintainer of ${packageName}`,
          });
        }

        // Connect the package to the exact versions the lockfile pinned. Only
        // versions actually present in the registry are linked, so a yanked or
        // renamed version does not create a dangling edge.
        for (const version of packageVersions.get(packageName) ?? []) {
          const registryVersion = packument.versions[version];
          if (!registryVersion) continue;
          const releaseUrn = entityUrn("Release", packageName, version);

          // Enrich the release the lockfile already created with facts only the
          // registry knows. Deprecation is the maintainer's own signal that a
          // version should no longer be used, so a deprecated release running in
          // production is a finding stated in the publisher's own words.
          entities.set(releaseUrn, {
            urn: releaseUrn,
            kind: "Release",
            name: `${packageName}@${version}`,
            displayName: packageName,
            source: "npm-registry",
            attributes: {
              package: packageName,
              version,
              deprecated: Boolean(registryVersion.deprecated),
              ...(registryVersion.deprecated
                ? { deprecationNotice: registryVersion.deprecated.slice(0, 160) }
                : {}),
            },
          });

          relations.push({
            from: packageUrn,
            to: releaseUrn,
            kind: "HAS_RELEASE",
            source: "npm-registry",
            observedAt: options.observedAt,
            evidence: packument.publishedAt[version]
              ? `published ${packument.publishedAt[version]}`
              : undefined,
          });
        }
      } catch (error) {
        failures.push({
          packageName,
          reason:
            error instanceof RegistryError
              ? error.message
              : error instanceof Error
                ? error.message
                : String(error),
        });
      } finally {
        completed++;
        options.onProgress?.(completed, packageNames.length, packageName);
      }
    },
  );

  const untrusted = [...entities.values()].filter(
    (entity) => entity.kind === "Maintainer" && entity.attributes?.trust === "untrusted",
  ).length;

  return {
    entities: [...entities.values()],
    relations,
    failures,
    stats: {
      packagesRequested: packageNames.length,
      packagesResolved: packageNames.length - failures.length,
      maintainersFound: maintainerHandles.size,
      untrustedMaintainers: untrusted,
    },
  };
}

export interface PublisherConcentration {
  readonly maintainer: string;
  readonly trust: TrustLabel;
  readonly packages: readonly string[];
}

/**
 * Rank publishers by how many packages in the tree they can push to.
 *
 * This is the headline finding, and it is factual rather than accusatory: an
 * account with publish rights over many of your dependencies is a single point
 * of failure. Sorted descending, because the first row is the answer.
 */
export function publisherConcentration(
  result: MaintainerIngestResult,
): PublisherConcentration[] {
  const byMaintainer = new Map<EntityUrn, string[]>();
  const packageNameByUrn = new Map<EntityUrn, string>();
  const maintainerByUrn = new Map<EntityUrn, Entity>();

  for (const entity of result.entities) {
    if (entity.kind === "Package") packageNameByUrn.set(entity.urn, entity.name);
    if (entity.kind === "Maintainer") maintainerByUrn.set(entity.urn, entity);
  }

  for (const relation of result.relations) {
    if (relation.kind !== "MAINTAINS") continue;
    const packageName = packageNameByUrn.get(relation.to);
    if (!packageName) continue;
    const existing = byMaintainer.get(relation.from);
    if (existing) existing.push(packageName);
    else byMaintainer.set(relation.from, [packageName]);
  }

  const rows: PublisherConcentration[] = [];
  for (const [urn, packages] of byMaintainer) {
    const maintainer = maintainerByUrn.get(urn);
    if (!maintainer) continue;
    rows.push({
      maintainer: maintainer.name,
      trust: (maintainer.attributes?.trust as TrustLabel) ?? "untrusted",
      packages: [...new Set(packages)].sort(),
    });
  }

  return rows.sort(
    (a, b) => b.packages.length - a.packages.length || a.maintainer.localeCompare(b.maintainer),
  );
}
