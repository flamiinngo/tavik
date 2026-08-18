import type { BoundaryVerification, SecurityBoundary } from "@/lib/domain/boundary";
import type { EntityUrn, ReachabilityPath, RelationKind } from "@/lib/domain/entities";
import { buildSubgraph, chokepoints } from "@/lib/domain/subgraph";

/**
 * Remediation — proposing a fix, and proving it worked.
 *
 * Tavik proposes; a human decides; then the change is applied for real and the
 * boundary is re-checked with the same query that found the problem. That last
 * step is the point. Anything can claim to have fixed something; re-running the
 * original proof is what makes the claim checkable.
 *
 * Proposals are always a single, concrete change to one relationship, never a
 * bundle. A fix a person cannot fully picture is a fix they cannot meaningfully
 * approve, and approval here is the whole safety model.
 */

export interface RemediationProposal {
  readonly id: string;
  readonly boundaryId: string;
  /** The relationship to remove. */
  readonly from: EntityUrn;
  readonly to: EntityUrn;
  readonly relation: RelationKind;
  /** Plain-language description of the change itself. */
  readonly summary: string;
  /** Plain-language description of what it costs. Never hidden. */
  readonly consequence: string;
  /** How many of the routes Tavik retrieved this removes. */
  readonly routesRemoved: number;
  /** How many of the retrieved routes would remain afterwards. */
  readonly routesRemaining: number;
  /**
   * True when the verification hit its path limit, so these counts describe a
   * sample rather than the whole picture.
   *
   * This changes what the fix means. Closing "19 of 25" reads as removing three
   * quarters of the exposure; if 25 was a cap and hundreds of routes exist,
   * other routes simply take their place and the boundary stays violated. That
   * is exactly what happened the first time this was tested, so the distinction
   * is surfaced rather than smoothed over.
   */
  readonly sampled: boolean;
  /** Names of entities that lose their route to the target. */
  readonly affected: readonly string[];
}

/**
 * Work out the single most effective change available.
 *
 * Ranked by routes removed, because that is the honest measure of a fix: the
 * edge carrying the most routes is the one whose removal buys the most safety
 * for one decision. Ties break toward the shortest route, on the reasoning that
 * a direct dependency is usually more within a team's control than something
 * five levels down.
 */
export function proposeRemediations(
  boundary: SecurityBoundary,
  verification: BoundaryVerification,
  limit = 3,
): RemediationProposal[] {
  if (verification.paths.length === 0) return [];

  // Every distinct edge across all violating routes, and which routes use it.
  const byEdge = new Map<
    string,
    {
      from: EntityUrn;
      to: EntityUrn;
      relation: RelationKind;
      fromName: string;
      toName: string;
      routes: Set<number>;
      shortest: number;
    }
  >();

  verification.paths.forEach((path, routeIndex) => {
    for (const hop of path.hops) {
      const key = `${hop.from.urn}|${hop.relation}|${hop.to.urn}`;
      const existing = byEdge.get(key);
      if (existing) {
        existing.routes.add(routeIndex);
        existing.shortest = Math.min(existing.shortest, path.length);
      } else {
        byEdge.set(key, {
          from: hop.from.urn,
          to: hop.to.urn,
          relation: hop.relation,
          fromName: hop.from.name,
          toName: hop.to.name,
          routes: new Set([routeIndex]),
          shortest: path.length,
        });
      }
    }
  });

  const ranked = [...byEdge.entries()]
    .map(([key, edge]) => ({ key, ...edge }))
    .sort(
      (a, b) => b.routes.size - a.routes.size || a.shortest - b.shortest,
    )
    .slice(0, limit);

  return ranked.map((edge) => {
    const routesRemoved = edge.routes.size;
    const affected = affectedSources(verification.paths, edge.routes);

    return {
      id: `${boundary.id}::${edge.key}`,
      boundaryId: boundary.id,
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
      summary: describeChange(edge.relation, edge.fromName, edge.toName),
      consequence: describeConsequence(edge.relation, edge.fromName, edge.toName),
      routesRemoved,
      routesRemaining: verification.paths.length - routesRemoved,
      sampled: verification.truncated,
      affected,
    };
  });
}

/**
 * The one change Tavik leads with.
 *
 * Prefers a proposal that closes the boundary outright. A partial fix is worth
 * offering, but presenting it as *the* answer would imply a safety it does not
 * deliver.
 */
export function bestRemediation(
  boundary: SecurityBoundary,
  verification: BoundaryVerification,
): RemediationProposal | null {
  const proposals = proposeRemediations(boundary, verification, 8);
  if (proposals.length === 0) return null;
  return proposals.find((p) => p.routesRemaining === 0) ?? proposals[0];
}

/** Which source entities lose their route if these routes are cut. */
function affectedSources(
  paths: readonly ReachabilityPath[],
  routeIndexes: ReadonlySet<number>,
): string[] {
  const names = new Set<string>();
  for (const index of routeIndexes) {
    const first = paths[index]?.hops[0]?.from;
    if (first) names.add(first.name);
  }
  return [...names].sort();
}

/**
 * Plain language, deliberately.
 *
 * "Remove the SUPPLIES relationship from X to Y" is precise and useless to the
 * person deciding. What they need to know is what will actually change about
 * their system.
 */
function describeChange(relation: RelationKind, from: string, to: string): string {
  switch (relation) {
    case "SUPPLIES":
      return `Stop ${to} from using ${from}`;
    case "MAINTAINS":
      return `Remove ${from}'s publishing rights over ${to}`;
    case "HAS_RELEASE":
      return `Stop using version ${to}`;
    case "PUBLISHED":
      return `Remove ${from} as the publisher of ${to}`;
    default:
      return `Remove the ${relation.toLowerCase().replace(/_/g, " ")} link from ${from} to ${to}`;
  }
}

function describeConsequence(relation: RelationKind, from: string, to: string): string {
  switch (relation) {
    case "SUPPLIES":
      return `${to} will no longer have ${from} available. Anything in ${to} that calls it will break until it is replaced or removed.`;
    case "MAINTAINS":
      return `${from} will no longer be able to publish new versions of ${to}. Coordinate with them first — this is a change to someone else's access.`;
    case "HAS_RELEASE":
      return `Nothing will resolve to ${to} any more. You will need to pin a different version.`;
    default:
      return `This removes a real relationship from the graph. Anything relying on it will be affected.`;
  }
}
