import { describe, expect, it, vi } from "vitest";

import type { Entity } from "@/lib/domain/entities";
import { entityUrn } from "@/lib/domain/entities";
import type { HydraClient } from "./client";
import { GraphStore } from "./graph-store";

/**
 * Entity merging, tested through the only door it has.
 *
 * `mergeByUrn` is private, which is right — it is an implementation detail of
 * "write these entities" and nothing else should call it. So these drive
 * `upsertEntities` with a fake client and read the rows it would have sent.
 *
 * This is worth pinning tightly. Ingestion runs in stages that each know part of
 * the truth about one entity, and the property they disagree about most often is
 * `deprecated` — the exact property the "abandoned code" rule matches on. Lose
 * the registry's copy of it and a package the author has abandoned quietly
 * passes the rule written to catch it. That is a false green, which is the worst
 * thing this system can produce.
 */

interface CapturedRow {
  id: bigint;
  urn: string;
  kind: string;
  name: string;
  source: string;
  deprecated: string;
  trust: string;
  [key: string]: unknown;
}

function fakeClient(): { client: HydraClient; rows: () => CapturedRow[] } {
  const captured: CapturedRow[] = [];

  const client = {
    query: vi.fn(async (cypher: string, options?: { parameters?: unknown }) => {
      // The existence check that `unchangedEntities` runs. Answering "nothing is
      // stored" keeps every entity in the write path, which is what these tests
      // want to inspect.
      if (cypher.includes("RETURN")) return { rows: [], columns: [] };

      const parameters = options?.parameters as { rows?: CapturedRow[] } | undefined;
      if (parameters?.rows) captured.push(...parameters.rows);
      return { rows: [], columns: [] };
    }),
  } as unknown as HydraClient;

  return { client, rows: () => captured };
}

const release = (overrides: Partial<Entity>): Entity => ({
  urn: entityUrn("Release", "flatten:1.0.3"),
  kind: "Release",
  name: "flatten@1.0.3",
  source: "lockfile",
  ...overrides,
});

describe("upsertEntities: two stages describing one entity", () => {
  it("keeps the facts from both", async () => {
    const { client, rows } = fakeClient();
    const store = new GraphStore(client);

    await store.upsertEntities([
      // What the lockfile knows.
      release({
        source: "lockfile",
        attributes: { package: "flatten", version: "1.0.3", integrity: "sha512-abc" },
      }),
      // What the registry knows about the very same release.
      release({
        source: "npm-registry",
        attributes: { package: "flatten", version: "1.0.3", deprecated: true },
      }),
    ]);

    const written = rows();
    expect(written).toHaveLength(1);
    expect(written[0].deprecated).toBe("true");
  });

  it("does not let a later stage erase what an earlier one set", async () => {
    const { client, rows } = fakeClient();
    const store = new GraphStore(client);

    await store.upsertEntities([
      release({ attributes: { trust: "quarantined" } }),
      // No attributes at all. Spreading the entities rather than their
      // attributes would blank the first copy's out.
      release({ source: "npm-registry" }),
    ]);

    expect(rows()[0].trust).toBe("quarantined");
  });

  it("resolves a real conflict in favour of the later stage", async () => {
    // Callers pass stages in the order they ran, and the registry is a live
    // source where the lockfile is a snapshot.
    const { client, rows } = fakeClient();
    const store = new GraphStore(client);

    await store.upsertEntities([
      release({ source: "lockfile", attributes: { deprecated: false } }),
      release({ source: "npm-registry", attributes: { deprecated: true } }),
    ]);

    expect(rows()[0].deprecated).toBe("true");
  });

  it("writes one row per entity, not one per mention", async () => {
    // The bug this fixes: HydraDB rejects the whole batch with "conflicting
    // metadata values for vertex ... property deprecated" when one UNWIND asks
    // it to set a single property to two values.
    const { client, rows } = fakeClient();
    const store = new GraphStore(client);

    await store.upsertEntities([
      release({ attributes: { deprecated: false } }),
      release({ attributes: { deprecated: true } }),
      release({ attributes: { deprecated: true } }),
    ]);

    expect(rows()).toHaveLength(1);
  });
});

describe("provenance when entities merge", () => {
  it("never relabels demo data as live", async () => {
    // The one rule that cannot bend. Tavik must never present demo data as
    // though it were real infrastructure, and a merge is exactly where that
    // could happen without anyone noticing.
    const { client, rows } = fakeClient();
    const store = new GraphStore(client);

    await store.upsertEntities([
      release({ source: "demo" }),
      release({ source: "npm-registry" }),
    ]);

    expect(rows()[0].source).toBe("demo");
  });

  it("keeps demo even when demo comes second", async () => {
    const { client, rows } = fakeClient();
    const store = new GraphStore(client);

    await store.upsertEntities([
      release({ source: "npm-registry" }),
      release({ source: "demo" }),
    ]);

    expect(rows()[0].source).toBe("demo");
  });

  it("records the later real source when neither is demo", async () => {
    const { client, rows } = fakeClient();
    const store = new GraphStore(client);

    await store.upsertEntities([
      release({ source: "lockfile" }),
      release({ source: "npm-registry" }),
    ]);

    expect(rows()[0].source).toBe("npm-registry");
  });
});

describe("the ordinary case", () => {
  it("leaves distinct entities alone", async () => {
    const { client, rows } = fakeClient();
    const store = new GraphStore(client);

    await store.upsertEntities([
      release({ urn: entityUrn("Release", "flatten:1.0.3") }),
      release({ urn: entityUrn("Release", "lodash:4.17.21"), name: "lodash@4.17.21" }),
      release({ urn: entityUrn("Release", "semver:7.8.5"), name: "semver@7.8.5" }),
    ]);

    expect(rows()).toHaveLength(3);
  });
});
