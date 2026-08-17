import { afterEach, describe, expect, it, vi } from "vitest";
import { ingestMaintainers, publisherConcentration } from "./maintainers";

/**
 * The registry is stubbed here so the suite is deterministic and offline. The
 * live registry is exercised separately by the integration test.
 */

interface StubPackument {
  maintainers?: string[];
  versions?: string[];
  latest?: string;
  status?: number;
}

function stubRegistry(packages: Record<string, StubPackument>) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    const name = decodeURIComponent(url.slice(url.indexOf("registry.npmjs.org/") + 19));
    const entry = packages[name];

    if (!entry || entry.status === 404) {
      return new Response("not found", { status: 404 });
    }
    if (entry.status && entry.status >= 400) {
      return new Response("error", { status: entry.status });
    }

    return new Response(
      JSON.stringify({
        name,
        "dist-tags": { latest: entry.latest ?? "1.0.0" },
        versions: Object.fromEntries(
          (entry.versions ?? ["1.0.0"]).map((v) => [v, { name, version: v, dependencies: {} }]),
        ),
        time: Object.fromEntries(
          (entry.versions ?? ["1.0.0"]).map((v) => [v, "2026-01-01T00:00:00.000Z"]),
        ),
        maintainers: (entry.maintainers ?? []).map((name) => ({ name, email: `${name}@x` })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const observedAt = 1_755_000_000_000;

describe("ingestMaintainers", () => {
  it("creates a MAINTAINS edge from each publisher to the package", async () => {
    stubRegistry({ "left-pad": { maintainers: ["alice", "bob"] } });

    const result = await ingestMaintainers(new Map([["left-pad", new Set(["1.0.0"])]]), {
      trustedPublishers: new Set(),
      observedAt,
    });

    const maintains = result.relations.filter((r) => r.kind === "MAINTAINS");
    expect(maintains).toHaveLength(2);
    expect(maintains.map((r) => r.from).sort()).toEqual([
      "tavik:maintainer:alice",
      "tavik:maintainer:bob",
    ]);
    expect(maintains.every((r) => r.to === "tavik:package:left-pad")).toBe(true);
  });

  it("connects a package to the exact versions the lockfile pinned", async () => {
    stubRegistry({ "left-pad": { maintainers: ["alice"], versions: ["1.0.0", "1.3.0"] } });

    const result = await ingestMaintainers(
      new Map([["left-pad", new Set(["1.3.0"])]]),
      { trustedPublishers: new Set(), observedAt },
    );

    const releases = result.relations.filter((r) => r.kind === "HAS_RELEASE");
    expect(releases).toHaveLength(1);
    expect(releases[0].to).toBe("tavik:release:left-pad:1.3.0");
  });

  it("does not link a version the registry no longer has", async () => {
    // A yanked version must not produce a dangling edge to a release that will
    // never exist as an entity.
    stubRegistry({ "left-pad": { maintainers: ["alice"], versions: ["1.3.0"] } });

    const result = await ingestMaintainers(
      new Map([["left-pad", new Set(["0.0.1-removed"])]]),
      { trustedPublishers: new Set(), observedAt },
    );

    expect(result.relations.filter((r) => r.kind === "HAS_RELEASE")).toHaveLength(0);
  });

  it("labels publishers by the workspace allowlist, not by any judgement", async () => {
    stubRegistry({
      "internal-lib": { maintainers: ["our-ci-bot"] },
      "external-lib": { maintainers: ["someone-else"] },
    });

    const result = await ingestMaintainers(
      new Map([
        ["internal-lib", new Set(["1.0.0"])],
        ["external-lib", new Set(["1.0.0"])],
      ]),
      { trustedPublishers: new Set(["our-ci-bot"]), observedAt },
    );

    const byName = new Map(
      result.entities.filter((e) => e.kind === "Maintainer").map((e) => [e.name, e]),
    );
    expect(byName.get("our-ci-bot")?.attributes?.trust).toBe("trusted");
    expect(byName.get("someone-else")?.attributes?.trust).toBe("untrusted");
    expect(result.stats.untrustedMaintainers).toBe(1);
  });

  it("records a package the registry cannot answer for instead of dropping it", async () => {
    // Silently omitting it would remove edges, and a missing edge is a path
    // Tavik will never find.
    stubRegistry({
      good: { maintainers: ["alice"] },
      gone: { status: 404 },
    });

    const result = await ingestMaintainers(
      new Map([
        ["good", new Set(["1.0.0"])],
        ["gone", new Set(["1.0.0"])],
      ]),
      { trustedPublishers: new Set(), observedAt },
    );

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].packageName).toBe("gone");
    expect(result.stats.packagesRequested).toBe(2);
    expect(result.stats.packagesResolved).toBe(1);
    // The healthy package still ingested.
    expect(result.relations.some((r) => r.to === "tavik:package:good")).toBe(true);
  });

  it("deduplicates a maintainer appearing across several packages", async () => {
    stubRegistry({
      "pkg-a": { maintainers: ["alice"] },
      "pkg-b": { maintainers: ["alice"] },
    });

    const result = await ingestMaintainers(
      new Map([
        ["pkg-a", new Set(["1.0.0"])],
        ["pkg-b", new Set(["1.0.0"])],
      ]),
      { trustedPublishers: new Set(), observedAt },
    );

    expect(result.entities.filter((e) => e.kind === "Maintainer")).toHaveLength(1);
    expect(result.stats.maintainersFound).toBe(1);
    // But both publish-rights edges exist.
    expect(result.relations.filter((r) => r.kind === "MAINTAINS")).toHaveLength(2);
  });

  it("reports progress for every package, including failures", async () => {
    stubRegistry({ ok: { maintainers: ["alice"] }, bad: { status: 500 } });
    const seen: number[] = [];

    await ingestMaintainers(
      new Map([
        ["ok", new Set(["1.0.0"])],
        ["bad", new Set(["1.0.0"])],
      ]),
      {
        trustedPublishers: new Set(),
        observedAt,
        onProgress: (done, total) => {
          seen.push(done);
          expect(total).toBe(2);
        },
      },
    );

    expect(seen.sort()).toEqual([1, 2]);
  });

  it("skips names that are not valid npm packages", async () => {
    stubRegistry({});
    const result = await ingestMaintainers(
      new Map([["../../etc/passwd", new Set(["1.0.0"])]]),
      { trustedPublishers: new Set(), observedAt },
    );
    expect(result.stats.packagesRequested).toBe(0);
    expect(result.entities).toHaveLength(0);
  });
});

describe("publisherConcentration", () => {
  it("ranks publishers by how many packages they can push to", async () => {
    stubRegistry({
      "pkg-a": { maintainers: ["wide", "narrow"] },
      "pkg-b": { maintainers: ["wide"] },
      "pkg-c": { maintainers: ["wide"] },
    });

    const result = await ingestMaintainers(
      new Map([
        ["pkg-a", new Set(["1.0.0"])],
        ["pkg-b", new Set(["1.0.0"])],
        ["pkg-c", new Set(["1.0.0"])],
      ]),
      { trustedPublishers: new Set(), observedAt },
    );

    const ranked = publisherConcentration(result);
    expect(ranked[0].maintainer).toBe("wide");
    expect(ranked[0].packages).toEqual(["pkg-a", "pkg-b", "pkg-c"]);
    expect(ranked[1].maintainer).toBe("narrow");
    expect(ranked[1].packages).toEqual(["pkg-a"]);
  });

  it("carries the trust label through", async () => {
    stubRegistry({ "pkg-a": { maintainers: ["ours"] } });
    const result = await ingestMaintainers(new Map([["pkg-a", new Set(["1.0.0"])]]), {
      trustedPublishers: new Set(["ours"]),
      observedAt,
    });
    expect(publisherConcentration(result)[0].trust).toBe("trusted");
  });
});
