import "server-only";

import type { ReachabilityPath } from "@/lib/domain/entities";
import { buildSubgraph, chokepoints } from "@/lib/domain/subgraph";
import { verifyBoundary } from "@/lib/engine/verify";
import { loadRules, tavik } from "./tavik";

/**
 * Live figures for the landing page.
 *
 * The landing page quotes real, current measurements from whatever this instance
 * has ingested rather than numbers written into the copy. A page that asserts
 * capability is marketing; one that shows its own current state is evidence —
 * and it costs nothing to be honest when the product actually works.
 *
 * Everything is optional. If HydraDB is not running, or nothing has been
 * ingested, the page shows setup instructions instead of inventing numbers. It
 * must never fall back to plausible-looking figures: the entire pitch is that
 * this product does not do that.
 */

export interface LandingProof {
  readonly available: boolean;
  readonly entities: number | null;
  readonly publishers: number | null;
  readonly routes: number | null;
  readonly truncated: boolean;
  readonly elapsedMs: number | null;
  readonly shortestPath: ReachabilityPath | null;
  readonly topPublisher: { readonly name: string; readonly packages: number } | null;
}

const EMPTY: LandingProof = {
  available: false,
  entities: null,
  publishers: null,
  routes: null,
  truncated: false,
  elapsedMs: null,
  shortestPath: null,
  topPublisher: null,
};

export async function loadLandingProof(): Promise<LandingProof> {
  try {
    const { client, store } = tavik();
    const entities = await store.countEntities();
    if (entities === 0) return EMPTY;

    const rules = await loadRules();
    // Prefer the rule about outside publishers — it is the one the landing copy
    // is actually about — but fall back to whichever rule is currently broken so
    // the page still shows something true.
    const rule =
      rules.find((r) => r.id === "production-isolation") ??
      rules[0];
    if (!rule) return { ...EMPTY, available: true, entities };

    const verification = await verifyBoundary(store, client, rule);

    const shortestPath =
      verification.paths.length > 0
        ? [...verification.paths].sort((a, b) => a.length - b.length)[0]
        : null;

    // The heaviest node that is a Package: the account-level concentration the
    // copy refers to.
    let topPublisher: LandingProof["topPublisher"] = null;
    if (verification.paths.length > 0) {
      const subgraph = buildSubgraph(verification.paths);
      const heaviest = chokepoints(subgraph, 12).find(
        (node) => node.kind === "Maintainer",
      );
      // Sources are the publishers themselves, so a maintainer rarely appears as
      // a chokepoint. Fall back to the first hop of the shortest route, which is
      // by definition a publisher who can reach production.
      const publisherName =
        heaviest?.label ?? shortestPath?.hops[0]?.from.name ?? null;

      if (publisherName) {
        const reach = countPackagesFor(publisherName, verification.paths);
        if (reach > 0) topPublisher = { name: publisherName, packages: reach };
      }
    }

    return {
      available: true,
      entities,
      publishers: verification.sourceCount,
      routes: verification.paths.length,
      truncated: verification.truncated,
      elapsedMs: Math.round(verification.elapsedMs),
      shortestPath,
      topPublisher,
    };
  } catch {
    // A landing page must never fail because a database is down.
    return EMPTY;
  }
}

/** How many distinct packages a publisher appears to control across the routes. */
function countPackagesFor(
  publisher: string,
  paths: readonly ReachabilityPath[],
): number {
  const packages = new Set<string>();
  for (const path of paths) {
    if (path.hops[0]?.from.name !== publisher) continue;
    for (const hop of path.hops) {
      if (hop.to.kind === "Package") packages.add(hop.to.name);
    }
  }
  return packages.size;
}
