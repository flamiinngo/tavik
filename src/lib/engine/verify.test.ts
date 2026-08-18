import { describe, expect, it } from "vitest";
import type { SecurityBoundary } from "@/lib/domain/boundary";
import type { EntityUrn } from "@/lib/domain/entities";
import { entityUrn } from "@/lib/domain/entities";
import type { HydraClient, HydraRow, QueryResult } from "@/lib/hydra/client";
import { HydraQueryError } from "@/lib/hydra/errors";
import type { GraphStore } from "@/lib/hydra/graph-store";
import { parsePath, verifyBoundary } from "./verify";

/**
 * The engine's contract is narrow but critical: it may report `verified` only
 * when it genuinely asked the question and genuinely got nothing back. Every
 * other outcome is `unknown`.
 *
 * Most of these tests exist to prove a negative — that a particular failure does
 * NOT produce a green boundary. A false `verified` is indistinguishable from
 * safety in the UI, which makes it the most dangerous bug this codebase can have.
 *
 * Path fixtures use the envelope observed from a live HydraDB server by
 * `npm run hydra:probe`, so a contract drift shows up here rather than in
 * production.
 */

const MAINTAINER = entityUrn("Maintainer", "example-publisher");
const PACKAGE = entityUrn("Package", "left-pad");
const SERVICE = entityUrn("Service", "checkout-api");

const boundary: SecurityBoundary = {
  id: "b-prod-isolation",
  name: "Production Isolation",
  statement:
    "No production service may depend on a package whose publish rights sit outside our trusted publisher set.",
  source: {
    kind: "Maintainer",
    property: "trust",
    value: "untrusted",
    description: "publishers outside the trusted set",
  },
  target: {
    kind: "Service",
    property: "environment",
    value: "production",
    description: "services running in production",
  },
  relations: ["MAINTAINS", "HAS_RELEASE", "SUPPLIES"],
  maxHops: 8,
  createdAt: 1_700_000_000_000,
  environmentId: "env-demo",
};

/** Build a node in HydraDB's observed shape. */
function node(id: number, urn: EntityUrn, kind: string, name = String(urn)) {
  return {
    id,
    labels: ["Entity"],
    properties: { urn: String(urn), kind, name, source: "npm-registry" },
  };
}

function relationship(id: number, type: string, src: number, dst: number) {
  return { id, edge_type: type, src, dst, properties: {} };
}

interface FakeConfig {
  sources?: readonly EntityUrn[];
  targets?: readonly EntityUrn[];
  rows?: HydraRow[];
  resolveError?: Error;
  queryError?: Error;
  /**
   * How many entities of the empty side's kind exist overall. Decides whether an
   * empty selector match means "ingestion never ran" or "nothing carries this
   * risk". Defaults to a populated graph.
   */
  population?: number;
}

function fakes(config: FakeConfig) {
  const store = {
    resolveSelector: async (selector: { kind: string }) => {
      if (config.resolveError) throw config.resolveError;
      return selector.kind === "Maintainer"
        ? (config.sources ?? [MAINTAINER])
        : (config.targets ?? [SERVICE]);
    },
    countEntitiesOfKind: async () => config.population ?? 500,
    buildPathQuery: () => "CALL algo.MSpaths({}) YIELD path RETURN path",
  } as unknown as GraphStore;

  const client = {
    query: async (): Promise<QueryResult> => {
      if (config.queryError) throw config.queryError;
      return { rows: config.rows ?? [], columns: ["path"], elapsedMs: 3 };
    },
  } as unknown as HydraClient;

  return { store, client };
}

describe("verifyBoundary", () => {
  it("reports verified when the graph returns no paths", async () => {
    const { store, client } = fakes({ rows: [] });
    const result = await verifyBoundary(store, client, boundary);

    expect(result.status).toBe("verified");
    expect(result.paths).toHaveLength(0);
    expect(result.failureReason).toBeUndefined();
    expect(result.sourceCount).toBe(1);
    expect(result.targetCount).toBe(1);
  });

  it("reports violated with the path as evidence", async () => {
    const { store, client } = fakes({
      rows: [
        {
          path: {
            nodes: [
              node(1, MAINTAINER, "Maintainer"),
              node(2, PACKAGE, "Package"),
            ],
            relationships: [relationship(10, "MAINTAINS", 1, 2)],
          },
        },
      ],
    });

    const result = await verifyBoundary(store, client, boundary);

    expect(result.status).toBe("violated");
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].length).toBe(1);
    expect(result.paths[0].hops[0].from.urn).toBe(MAINTAINER);
    expect(result.paths[0].hops[0].relation).toBe("MAINTAINS");
    expect(result.paths[0].hops[0].to.urn).toBe(PACKAGE);
  });

  it("preserves hop order across a multi-hop path", async () => {
    const { store, client } = fakes({
      rows: [
        {
          path: {
            nodes: [
              node(1, MAINTAINER, "Maintainer"),
              node(2, PACKAGE, "Package"),
              node(3, SERVICE, "Service"),
            ],
            relationships: [
              relationship(10, "MAINTAINS", 1, 2),
              relationship(11, "SUPPLIES", 2, 3),
            ],
          },
        },
      ],
    });

    const result = await verifyBoundary(store, client, boundary);

    expect(result.status).toBe("violated");
    expect(result.paths[0].length).toBe(2);
    expect(result.paths[0].hops.map((hop) => hop.to.urn)).toEqual([PACKAGE, SERVICE]);
  });

  // ── The failure modes that must never read as safe ────────────────────────

  it("reports unknown when nothing of that kind exists at all", async () => {
    // No maintainers in the graph means ingestion never ran. Tavik has not
    // checked anything, so it must not claim the boundary holds.
    const { store, client } = fakes({ sources: [], population: 0 });
    const result = await verifyBoundary(store, client, boundary);

    expect(result.status).toBe("unknown");
    expect(result.failureReason).toMatch(/ingestion/i);
  });

  it("reports verified when the kind is populated but nothing matches", async () => {
    // 500 maintainers exist and none are quarantined: there is genuinely
    // nothing that could cross, so the boundary holds. Calling this `unknown`
    // would train people to ignore the state that actually matters.
    const { store, client } = fakes({ sources: [], population: 500 });
    const result = await verifyBoundary(store, client, boundary);

    expect(result.status).toBe("verified");
    expect(result.failureReason).toBeUndefined();
    expect(result.paths).toHaveLength(0);
  });

  it("applies the same reasoning to an empty target side", async () => {
    const { store, client } = fakes({ targets: [], population: 0 });
    const result = await verifyBoundary(store, client, boundary);
    expect(result.status).toBe("unknown");
  });

  it("reports unknown when HydraDB fails during the path query", async () => {
    const { store, client } = fakes({
      queryError: new HydraQueryError("connection refused"),
    });
    const result = await verifyBoundary(store, client, boundary);

    expect(result.status).toBe("unknown");
    expect(result.failureReason).toContain("connection refused");
  });

  it("reports unknown when endpoint resolution fails", async () => {
    const { store, client } = fakes({
      resolveError: new HydraQueryError("graph unavailable"),
    });
    const result = await verifyBoundary(store, client, boundary);

    expect(result.status).toBe("unknown");
    expect(result.failureReason).toMatch(/endpoints/i);
  });

  it("reports unknown when rows come back but cannot be parsed as paths", async () => {
    const { store, client } = fakes({ rows: [{ path: { unexpected: "shape" } }] });
    const result = await verifyBoundary(store, client, boundary);

    expect(result.status).toBe("unknown");
    expect(result.failureReason).toMatch(/hydra:probe/);
  });

  it("reports unknown when a path uses an unrecognised relationship type", async () => {
    const { store, client } = fakes({
      rows: [
        {
          path: {
            nodes: [node(1, MAINTAINER, "Maintainer"), node(2, PACKAGE, "Package")],
            relationships: [relationship(10, "NOT_A_REAL_RELATION", 1, 2)],
          },
        },
      ],
    });
    const result = await verifyBoundary(store, client, boundary);

    expect(result.status).toBe("unknown");
  });

  it("reports unknown when a relationship references a node absent from the path", async () => {
    const { store, client } = fakes({
      rows: [
        {
          path: {
            nodes: [node(1, MAINTAINER, "Maintainer")],
            relationships: [relationship(10, "MAINTAINS", 1, 999)],
          },
        },
      ],
    });
    const result = await verifyBoundary(store, client, boundary);

    expect(result.status).toBe("unknown");
  });

  it("never throws, so a failure cannot be swallowed as no-violations upstream", async () => {
    const { store, client } = fakes({ queryError: new Error("boom") });
    await expect(verifyBoundary(store, client, boundary)).resolves.toBeDefined();
  });

  it("rejects a malformed boundary instead of evaluating it", async () => {
    const { store, client } = fakes({ rows: [] });
    const result = await verifyBoundary(store, client, {
      ...boundary,
      relations: [], // would make every path impossible, so always "verified"
    });

    expect(result.status).toBe("unknown");
    expect(result.failureReason).toMatch(/not well-formed/i);
  });

  it("refuses a boundary whose source and target select the same entities", async () => {
    const { store, client } = fakes({ rows: [] });
    const result = await verifyBoundary(store, client, {
      ...boundary,
      target: boundary.source,
    });

    expect(result.status).toBe("unknown");
    expect(result.failureReason).toMatch(/trivially violated/i);
  });
});

describe("parsePath", () => {
  it("rejects a non-path value", () => {
    expect(parsePath(null)).toBeNull();
    expect(parsePath("path")).toBeNull();
    expect(parsePath({})).toBeNull();
  });

  it("rejects a path with no relationships", () => {
    // A zero-hop 'path' would mean source and target are the same node, which is
    // not evidence of a boundary being crossed.
    expect(parsePath({ nodes: [node(1, MAINTAINER, "Maintainer")], relationships: [] })).toBeNull();
  });

  it("rejects a node whose kind is not part of the model", () => {
    expect(
      parsePath({
        nodes: [
          { id: 1, labels: ["Entity"], properties: { urn: "x", kind: "Wormhole" } },
          node(2, PACKAGE, "Package"),
        ],
        relationships: [relationship(10, "MAINTAINS", 1, 2)],
      }),
    ).toBeNull();
  });

  it("falls back to the urn when a node carries no name", () => {
    const path = parsePath({
      nodes: [
        { id: 1, labels: ["Entity"], properties: { urn: String(MAINTAINER), kind: "Maintainer" } },
        node(2, PACKAGE, "Package"),
      ],
      relationships: [relationship(10, "MAINTAINS", 1, 2)],
    });
    expect(path?.hops[0].from.name).toBe(String(MAINTAINER));
  });
});
