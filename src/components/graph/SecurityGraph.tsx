"use client";

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Subgraph, SubgraphEdge, SubgraphNode } from "@/lib/domain/subgraph";

/**
 * The security graph.
 *
 * A real force simulation, not a hand-placed SVG dressed up as one. Positions
 * come from d3-force resolving actual repulsion, link, and collision forces;
 * the layout is emergent, so it stays honest when the data changes rather than
 * only looking right for one screenshot.
 *
 * Two decisions shape it:
 *
 * **It is laid out in columns, not as a cloud.** A pure force layout produces an
 * undirected hairball, which is the standard failure of graph visualisation. An
 * x-force pins each node to a column by its distance from the source, so the
 * drawing reads left to right in the direction influence travels — publishers,
 * then packages, then releases, then the service. The vertical axis is left to
 * the simulation.
 *
 * **Weight encodes routes.** A node carrying many routes is drawn larger and an
 * edge carrying many routes thicker, because that is the actionable signal: the
 * heaviest node is usually the cheapest place to cut.
 *
 * Hovering isolates a node's own routes so a dense region can be read without
 * filtering controls.
 */

interface SimNode extends SimulationNodeDatum, SubgraphNode {}
interface SimEdge extends SimulationLinkDatum<SimNode> {
  id: string;
  relation: string;
  routeCount: number;
}

/**
 * Node colours.
 *
 * Tuned for a light ground. On white, a mid grey dot reads as disabled and a
 * pale tint disappears entirely, so these run darker and more saturated than the
 * equivalents elsewhere in the UI — the graph has to hold its own against a
 * bright card rather than glow on a dark one.
 */
const KIND_COLOR: Record<string, string> = {
  Maintainer: "#b42342",
  Package: "#414a5a",
  Release: "#7b8494",
  Service: "#0b7285",
  Repository: "#a8afba",
  Environment: "#a8afba",
  CiJob: "#9a6206",
  Role: "#9a6206",
  Datastore: "#0b7285",
};

/** Edge colour, dark enough to survive on white at low opacity. */
const EDGE_COLOR = "#c0395a";

const WIDTH = 1000;
const HEIGHT = 520;

export function SecurityGraph({
  subgraph,
  className = "",
}: {
  subgraph: Subgraph;
  className?: string;
}) {
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [edges, setEdges] = useState<SimEdge[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const simulationRef = useRef<Simulation<SimNode, SimEdge> | null>(null);

  // Column x-positions, evenly distributed across the canvas.
  const columnX = useMemo(() => {
    const columns = subgraph.maxDepth + 1;
    const margin = 90;
    const usable = WIDTH - margin * 2;
    return (depth: number) =>
      columns <= 1 ? WIDTH / 2 : margin + (usable * depth) / (columns - 1);
  }, [subgraph.maxDepth]);

  useEffect(() => {
    // Seed vertical order by barycentre before the simulation runs.
    //
    // Dropping nodes in at random y and letting the forces sort it out produces
    // a mesh: the physics has no notion of edge crossings and will happily
    // settle into a tangle. Iteratively placing each node near the average
    // height of its neighbours is the standard layered-graph ordering pass, and
    // it removes most crossings *before* the simulation starts. The forces then
    // only have to relax spacing rather than untangle the whole drawing.
    const order = orderByBarycentre(subgraph);

    const simNodes: SimNode[] = subgraph.nodes.map((node) => ({
      ...node,
      x: columnX(node.depth),
      y: order.get(node.id) ?? HEIGHT / 2,
    }));
    const byId = new Map(simNodes.map((node) => [node.id, node]));

    const simEdges: SimEdge[] = subgraph.edges
      .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: byId.get(edge.source)!,
        target: byId.get(edge.target)!,
        relation: edge.relation,
        routeCount: edge.routeCount,
      }));

    const simulation = forceSimulation<SimNode, SimEdge>(simNodes)
      .force("link", forceLink<SimNode, SimEdge>(simEdges).id((d) => d.id).distance(70).strength(0.15))
      .force("charge", forceManyBody<SimNode>().strength(-140))
      // Columns are enforced strongly; vertical placement is left to the
      // simulation, which is what keeps the drawing readable left-to-right.
      .force("x", forceX<SimNode>((d) => columnX(d.depth)).strength(0.95))
      // Hold each node near the height the ordering pass chose, rather than
      // pulling everything to the middle. Without this the simulation slowly
      // undoes the crossing-reduction work it was handed.
      .force("y", forceY<SimNode>((d) => order.get(d.id) ?? HEIGHT / 2).strength(0.35))
      .force("collide", forceCollide<SimNode>((d) => radiusOf(d) + 10))
      .alphaDecay(0.045);

    simulation.on("tick", () => {
      setNodes([...simulation.nodes()]);
      setEdges([...simEdges]);
    });

    simulationRef.current = simulation;
    return () => {
      simulation.stop();
    };
  }, [subgraph, columnX]);

  // Routes touching the hovered node, so hovering isolates rather than
  // merely highlighting one dot.
  const activeEdgeIds = useMemo(() => {
    if (!hovered) return null;
    const active = new Set<string>();
    for (const edge of edges) {
      const source = typeof edge.source === "object" ? (edge.source as SimNode).id : edge.source;
      const target = typeof edge.target === "object" ? (edge.target as SimNode).id : edge.target;
      if (source === hovered || target === hovered) active.add(edge.id);
    }
    return active;
  }, [hovered, edges]);

  const activeNodeIds = useMemo(() => {
    if (!hovered || !activeEdgeIds) return null;
    const active = new Set<string>([hovered]);
    for (const edge of edges) {
      if (!activeEdgeIds.has(edge.id)) continue;
      const source = typeof edge.source === "object" ? (edge.source as SimNode).id : edge.source;
      const target = typeof edge.target === "object" ? (edge.target as SimNode).id : edge.target;
      active.add(String(source));
      active.add(String(target));
    }
    return active;
  }, [hovered, activeEdgeIds, edges]);

  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`Security graph showing ${subgraph.nodes.length} entities connected by ${subgraph.edges.length} relationships along violating routes.`}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" fill={EDGE_COLOR} opacity="0.55" />
          </marker>
        </defs>

        {/* Edges first, so nodes sit above them. */}
        <g>
          {edges.map((edge) => {
            const source = edge.source as SimNode;
            const target = edge.target as SimNode;
            if (!source?.x || !target?.x) return null;
            const dimmed = activeEdgeIds !== null && !activeEdgeIds.has(edge.id);

            // Gently curved rather than straight. With this many crossings,
            // straight lines become an indistinguishable mesh; a consistent
            // curve lets the eye follow one edge through a crossing.
            const midX = ((source.x ?? 0) + (target.x ?? 0)) / 2;
            const midY = ((source.y ?? 0) + (target.y ?? 0)) / 2;
            const bow = ((target.y ?? 0) - (source.y ?? 0)) * 0.12;

            return (
              <path
                key={edge.id}
                d={`M ${source.x} ${source.y} Q ${midX + bow} ${midY} ${target.x} ${target.y}`}
                fill="none"
                stroke={EDGE_COLOR}
                strokeWidth={Math.min(1 + Math.log2(edge.routeCount + 1) * 0.9, 4)}
                strokeOpacity={dimmed ? 0.07 : 0.45}
                markerEnd="url(#arrow)"
                className="transition-[stroke-opacity] duration-200"
              />
            );
          })}
        </g>

        <g>
          {nodes.map((node) => {
            const dimmed = activeNodeIds !== null && !activeNodeIds.has(node.id);
            const radius = radiusOf(node);

            return (
              <g
                key={node.id}
                transform={`translate(${node.x ?? 0}, ${node.y ?? 0})`}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-pointer transition-opacity duration-200"
                opacity={dimmed ? 0.15 : 1}
              >
                {node.isTarget ? (
                  <circle
                    r={radius + 6}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeOpacity={0.5}
                    strokeWidth={1}
                  />
                ) : null}
                <circle
                  r={radius}
                  fill={KIND_COLOR[node.kind] ?? "var(--color-ink-subtle)"}
                  fillOpacity={node.isSource || node.isTarget ? 1 : 0.82}
                  stroke="#ffffff"                  strokeWidth={2}
                />
                {/* Labels are rationed. Every node labelled turns the middle of
                    a dense graph into unreadable overlap, so only the ends, the
                    chokepoints, and whatever is hovered get one. */}
                {node.isTarget ||
                node.isSource ||
                node.routeCount >= 4 ||
                hovered === node.id ? (
                  <text
                    y={-radius - 6}
                    textAnchor="middle"
                    className="pointer-events-none select-none font-mono"
                    fontSize={9}
                    fill="#0d1420"
                    opacity={hovered === node.id ? 1 : 0.7}
                  >
                    {node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend, and the read of the picture. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-2xs text-ink-faint">
        {(["Maintainer", "Package", "Release", "Service"] as const).map((kind) => (
          <span key={kind} className="flex items-center gap-2">
            <span
              className="size-2 rounded-full"
              style={{ background: KIND_COLOR[kind] }}
              aria-hidden
            />
            {kind.toLowerCase()}
          </span>
        ))}
        <span className="ml-auto">
          node size and edge weight = routes carried · hover to isolate
        </span>
      </div>
    </div>
  );
}

/** Node radius scales with routes carried, damped so chokepoints stand out
 *  without swamping the drawing. */
function radiusOf(node: SubgraphNode): number {
  return 4 + Math.min(Math.log2(node.routeCount + 1) * 2.4, 9);
}

/**
 * Assign a starting y to every node so that edges cross as little as possible.
 *
 * A barycentre sweep: repeatedly place each node at the mean height of its
 * neighbours, then re-space the nodes within each column to keep them apart.
 * Sweeping forwards and backwards lets ordering information propagate from both
 * ends of the graph.
 *
 * This is a heuristic, not an optimum — minimising crossings exactly is
 * NP-hard — but a handful of passes removes most of them, which is all that is
 * needed to hand the force simulation a readable starting point.
 */
function orderByBarycentre(subgraph: Subgraph): Map<string, number> {
  const columns = new Map<number, SubgraphNode[]>();
  for (const node of subgraph.nodes) {
    const bucket = columns.get(node.depth);
    if (bucket) bucket.push(node);
    else columns.set(node.depth, [node]);
  }

  const neighbours = new Map<string, string[]>();
  for (const edge of subgraph.edges) {
    (neighbours.get(edge.source) ?? neighbours.set(edge.source, []).get(edge.source)!).push(
      edge.target,
    );
    (neighbours.get(edge.target) ?? neighbours.set(edge.target, []).get(edge.target)!).push(
      edge.source,
    );
  }

  const y = new Map<string, number>();
  const depths = [...columns.keys()].sort((a, b) => a - b);

  // Initial spread: evenly distribute each column over the canvas.
  for (const depth of depths) {
    const bucket = columns.get(depth)!;
    bucket.forEach((node, index) => {
      y.set(node.id, ((index + 1) / (bucket.length + 1)) * HEIGHT);
    });
  }

  for (let pass = 0; pass < 6; pass++) {
    const forward = pass % 2 === 0 ? depths : [...depths].reverse();
    for (const depth of forward) {
      const bucket = columns.get(depth)!;

      const scored = bucket.map((node) => {
        const linked = neighbours.get(node.id) ?? [];
        const heights = linked
          .map((id) => y.get(id))
          .filter((value): value is number => value !== undefined);
        const barycentre =
          heights.length > 0
            ? heights.reduce((sum, value) => sum + value, 0) / heights.length
            : (y.get(node.id) ?? HEIGHT / 2);
        return { node, barycentre };
      });

      scored.sort((a, b) => a.barycentre - b.barycentre);
      // Re-space evenly in the new order so nodes cannot pile up.
      scored.forEach((entry, index) => {
        y.set(entry.node.id, ((index + 1) / (scored.length + 1)) * HEIGHT);
      });
    }
  }

  return y;
}
