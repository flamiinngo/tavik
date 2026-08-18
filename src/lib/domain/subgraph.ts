import type { EntityKind, ReachabilityPath, RelationKind } from "./entities";

/**
 * The violation subgraph — the part of the security graph worth drawing.
 *
 * Rendering the whole estate would be a hairball: 1,200+ entities and 2,300+
 * relationships arranged into an unreadable cloud, which is the failure mode of
 * every graph visualisation that tries to show everything. It would also be
 * dishonest about what matters — almost none of those nodes are implicated.
 *
 * So only the nodes and edges that actually appear in a violating route are
 * included. The picture then answers the question the page is asking: *this* is
 * how they get in.
 *
 * `depth` is the distance from the source side, used to lay the graph out in
 * columns so the drawing reads left to right in the direction influence travels
 * rather than as an undirected blob.
 */

export interface SubgraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind: EntityKind;
  /** Hops from a path source. Drives column placement. */
  readonly depth: number;
  /** True when this node begins at least one route. */
  readonly isSource: boolean;
  /** True when this node terminates at least one route. */
  readonly isTarget: boolean;
  /** How many distinct routes pass through it. Drives node weight. */
  readonly routeCount: number;
}

export interface SubgraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: RelationKind;
  readonly routeCount: number;
}

export interface Subgraph {
  readonly nodes: readonly SubgraphNode[];
  readonly edges: readonly SubgraphEdge[];
  readonly maxDepth: number;
}

/**
 * Collapse a set of routes into a single drawable graph.
 *
 * Routes overlap heavily — 25 routes through a shared dependency converge on the
 * same nodes — so this merges them and counts the overlap. That count is the
 * interesting signal: a node carrying many routes is a chokepoint, and a
 * chokepoint is usually the cheapest place to cut.
 */
export function buildSubgraph(paths: readonly ReachabilityPath[]): Subgraph {
  const nodes = new Map<string, {
    label: string;
    kind: EntityKind;
    depth: number;
    isSource: boolean;
    isTarget: boolean;
    routes: Set<number>;
  }>();
  const edges = new Map<string, {
    source: string;
    target: string;
    relation: RelationKind;
    routes: Set<number>;
  }>();

  paths.forEach((path, routeIndex) => {
    const sequence = [path.hops[0]?.from, ...path.hops.map((hop) => hop.to)].filter(
      (entity): entity is NonNullable<typeof entity> => Boolean(entity),
    );

    sequence.forEach((entity, index) => {
      const id = String(entity.urn);
      const existing = nodes.get(id);

      if (existing) {
        existing.routes.add(routeIndex);
        // A node can appear at different distances on different routes. The
        // shallowest wins, so a chokepoint sits as far left as any route
        // reaches it and edges keep flowing rightwards.
        existing.depth = Math.min(existing.depth, index);
        existing.isSource ||= index === 0;
        existing.isTarget ||= index === sequence.length - 1;
      } else {
        nodes.set(id, {
          label: entity.name,
          kind: entity.kind,
          depth: index,
          isSource: index === 0,
          isTarget: index === sequence.length - 1,
          routes: new Set([routeIndex]),
        });
      }
    });

    path.hops.forEach((hop) => {
      const id = `${hop.from.urn}|${hop.relation}|${hop.to.urn}`;
      const existing = edges.get(id);
      if (existing) existing.routes.add(routeIndex);
      else
        edges.set(id, {
          source: String(hop.from.urn),
          target: String(hop.to.urn),
          relation: hop.relation,
          routes: new Set([routeIndex]),
        });
    });
  });

  let maxDepth = 0;
  for (const node of nodes.values()) {
    maxDepth = Math.max(maxDepth, node.depth);
  }

  // Targets get a reserved final column of their own.
  //
  // Routes vary in length, so a target reached in three hops would otherwise
  // sit to the *left* of a release that is four hops along a different route,
  // drawing edges that run backwards and destroying the left-to-right reading.
  // Sharing the last column with non-targets is nearly as bad: an unrelated
  // node ends up level with — or visually past — the thing everything converges
  // on. The target is where every route ends by definition, so it gets the last
  // column alone.
  const targetDepth = maxDepth + 1;

  const nodeList: SubgraphNode[] = [];
  for (const [id, node] of nodes) {
    nodeList.push({
      id,
      label: node.label,
      kind: node.kind,
      depth: node.isTarget ? targetDepth : node.depth,
      isSource: node.isSource,
      isTarget: node.isTarget,
      routeCount: node.routes.size,
    });
  }

  maxDepth = targetDepth;

  const edgeList: SubgraphEdge[] = [];
  for (const [id, edge] of edges) {
    edgeList.push({
      id,
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      routeCount: edge.routes.size,
    });
  }

  return { nodes: nodeList, edges: edgeList, maxDepth };
}

/**
 * The nodes carrying the most routes.
 *
 * Surfaced beside the graph because it is the actionable read: cutting the
 * highest-traffic node removes the most routes for one change.
 */
export function chokepoints(subgraph: Subgraph, limit = 5): SubgraphNode[] {
  return [...subgraph.nodes]
    .filter((node) => !node.isSource && !node.isTarget)
    .sort((a, b) => b.routeCount - a.routeCount || a.label.localeCompare(b.label))
    .slice(0, limit);
}
