import { describe, expect, it } from "vitest";
import type { BoundaryVerification, SecurityBoundary } from "@/lib/domain/boundary";
import type { Entity, EntityUrn, ReachabilityPath, RelationKind } from "@/lib/domain/entities";
import { entityUrn } from "@/lib/domain/entities";
import { bestRemediation, proposeRemediations } from "./remediation";

/**
 * Remediation decides what Tavik asks a human to approve, and every proposal is
 * an irreversible change to somebody's system. Two things have to hold:
 *
 *   the ranking must be honest — the fix offered first should genuinely remove
 *   the most exposure, or people learn the ordering means nothing
 *
 *   the stated cost must be true — approval is the entire safety model, and an
 *   approval given on a wrong impact estimate is worse than no approval at all
 */

function entity(urn: EntityUrn, kind: Entity["kind"], name?: string): Entity {
  return { urn, kind, name: name ?? String(urn).split(":").slice(2).join(":"), source: "demo" };
}

const publisher = entityUrn("Maintainer", "alex");
const otherPublisher = entityUrn("Maintainer", "sam");
const pkg = entityUrn("Package", "chalk");
const release = entityUrn("Release", "chalk", "4.1.2");
const service = entityUrn("Service", "checkout");

/** Build a path from [from, relation, to] triples. */
function path(...steps: [EntityUrn, RelationKind, EntityUrn][]): ReachabilityPath {
  const hops = steps.map(([from, relation, to]) => ({
    from: entity(from, kindOf(from)),
    relation,
    to: entity(to, kindOf(to)),
  }));
  return { hops, length: hops.length };
}

function kindOf(urn: EntityUrn): Entity["kind"] {
  const segment = String(urn).split(":")[1];
  return (segment.charAt(0).toUpperCase() + segment.slice(1)) as Entity["kind"];
}

function verification(paths: ReachabilityPath[], truncated = false): BoundaryVerification {
  return {
    boundaryId: "r",
    status: paths.length > 0 ? "violated" : "verified",
    verifiedAt: 0,
    paths,
    truncated,
    sourceCount: 1,
    targetCount: 1,
    elapsedMs: 1,
  };
}

const boundary: SecurityBoundary = {
  id: "r",
  name: "Outside publishers",
  statement: "Nobody outside our approved list should reach production.",
  source: { kind: "Maintainer", property: "trust", value: "untrusted", description: "outsiders" },
  target: { kind: "Service", property: "environment", value: "production", description: "production" },
  relations: ["MAINTAINS", "HAS_RELEASE", "SUPPLIES"],
  maxHops: 8,
  createdAt: 0,
  environmentId: "e",
};

describe("proposeRemediations", () => {
  it("offers nothing when nothing is broken", () => {
    expect(proposeRemediations(boundary, verification([]))).toEqual([]);
  });

  it("ranks the edge carrying the most routes first", () => {
    // Two routes share the release->service edge; only one uses each package.
    // Cutting the shared edge closes both, so it has to lead.
    const proposals = proposeRemediations(
      boundary,
      verification([
        path([publisher, "MAINTAINS", pkg], [pkg, "HAS_RELEASE", release], [release, "SUPPLIES", service]),
        path([otherPublisher, "MAINTAINS", pkg], [pkg, "HAS_RELEASE", release], [release, "SUPPLIES", service]),
      ]),
    );

    expect(proposals[0].routesRemoved).toBe(2);
    expect(proposals[0].routesRemaining).toBe(0);
  });

  it("reports what would remain, not just what it removes", () => {
    // "Closes 1 of 2" is a different decision from "fixes it completely".
    const proposals = proposeRemediations(
      boundary,
      verification([
        path([publisher, "MAINTAINS", pkg], [pkg, "SUPPLIES", service]),
        path([otherPublisher, "MAINTAINS", release], [release, "SUPPLIES", service]),
      ]),
    );

    const first = proposals.find((p) => p.relation === "MAINTAINS");
    expect(first?.routesRemoved).toBe(1);
    expect(first?.routesRemaining).toBe(1);
  });

  it("marks a proposal as sampled when the result was capped", () => {
    // Closing "19 of 25" reads as removing three quarters of the exposure. If
    // 25 was a cap, other routes simply take their place — so the difference
    // has to reach the person approving.
    const proposals = proposeRemediations(
      boundary,
      verification([path([publisher, "MAINTAINS", pkg], [pkg, "SUPPLIES", service])], true),
    );
    expect(proposals[0].sampled).toBe(true);
  });

  it("names who loses access, so the cost is concrete", () => {
    const proposals = proposeRemediations(
      boundary,
      verification([
        path([publisher, "MAINTAINS", pkg], [pkg, "SUPPLIES", service]),
        path([otherPublisher, "MAINTAINS", pkg], [pkg, "SUPPLIES", service]),
      ]),
    );

    const shared = proposals.find((p) => p.relation === "SUPPLIES");
    expect([...(shared?.affected ?? [])].sort()).toEqual(["alex", "sam"]);
  });

  it("describes the change in plain language", () => {
    // "Remove the SUPPLIES relationship from X to Y" is precise and useless to
    // the person deciding. They need to know what changes about their system.
    const proposals = proposeRemediations(
      boundary,
      verification([path([release, "SUPPLIES", service])]),
    );
    expect(proposals[0].summary).toBe("Stop checkout from using chalk:4.1.2");
  });

  it("always states a cost", () => {
    const proposals = proposeRemediations(
      boundary,
      verification([
        path([publisher, "MAINTAINS", pkg], [pkg, "HAS_RELEASE", release], [release, "SUPPLIES", service]),
      ]),
    );
    for (const proposal of proposals) {
      expect(proposal.consequence.length).toBeGreaterThan(20);
    }
  });

  it("honours the limit", () => {
    const proposals = proposeRemediations(
      boundary,
      verification([
        path([publisher, "MAINTAINS", pkg], [pkg, "HAS_RELEASE", release], [release, "SUPPLIES", service]),
      ]),
      2,
    );
    expect(proposals.length).toBeLessThanOrEqual(2);
  });
});

describe("bestRemediation", () => {
  it("prefers a fix that closes the rule outright", () => {
    // A partial fix is worth offering, but presenting it as *the* answer would
    // imply a safety it does not deliver.
    //
    // Both routes converge on the same final edge, so cutting that one closes
    // the rule — while cutting either MAINTAINS edge closes only its own route.
    // Every edge here is genuinely distinct: an earlier version of this test
    // assumed one publisher's rights were a single edge, when maintaining a
    // package and maintaining a release are two.
    const best = bestRemediation(
      boundary,
      verification([
        path([publisher, "MAINTAINS", pkg], [pkg, "SUPPLIES", release], [release, "SUPPLIES", service]),
        path([otherPublisher, "MAINTAINS", pkg], [pkg, "SUPPLIES", release], [release, "SUPPLIES", service]),
      ]),
    );

    expect(best?.routesRemaining).toBe(0);
    expect(best?.routesRemoved).toBe(2);
  });

  it("returns null when there is nothing to fix", () => {
    expect(bestRemediation(boundary, verification([]))).toBeNull();
  });

  it("falls back to the highest-impact partial fix", () => {
    const best = bestRemediation(
      boundary,
      verification([
        path([publisher, "MAINTAINS", pkg], [pkg, "SUPPLIES", service]),
        path([otherPublisher, "MAINTAINS", release], [release, "SUPPLIES", service]),
      ]),
    );
    expect(best).not.toBeNull();
    expect(best!.routesRemoved).toBeGreaterThan(0);
  });
});
