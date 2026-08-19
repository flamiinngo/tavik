import { describe, expect, it } from "vitest";
import type { SecurityBoundary } from "@/lib/domain/boundary";
import type { HydraClient, HydraRow, QueryResult } from "@/lib/hydra/client";
import { RuleStore, ruleIdFromName } from "./rule-store";

/**
 * Rules are the product's memory of what a team decided. If one comes back from
 * storage subtly different from how it went in, Tavik answers a question nobody
 * asked and reports the result with total confidence.
 *
 * The awkward part is that HydraDB stores only scalars, so a rule's relationship
 * list has to be flattened to a string and rebuilt on read. That round trip is
 * where a rule can quietly lose its meaning, and it is what most of these cover.
 */

/** A client that records what it was asked and replays what it is told to. */
function fakeClient(rows: HydraRow[] = []) {
  const queries: { cypher: string; parameters?: Record<string, unknown> }[] = [];

  const client = {
    query: async (cypher: string, options?: { parameters?: Record<string, unknown> }) => {
      queries.push({ cypher, parameters: options?.parameters });
      return { rows, columns: [], elapsedMs: 1 } satisfies QueryResult;
    },
  } as unknown as HydraClient;

  return { client, queries };
}

const rule: SecurityBoundary = {
  id: "outside-publishers",
  name: "Outside publishers",
  statement: "Nobody outside our approved list should reach production.",
  source: {
    kind: "Maintainer",
    property: "trust",
    value: "untrusted",
    description: "people not on our approved list",
  },
  target: {
    kind: "Service",
    property: "environment",
    value: "production",
    description: "anything running in production",
  },
  relations: ["MAINTAINS", "HAS_RELEASE", "SUPPLIES"],
  maxHops: 8,
  createdAt: 1_755_400_000_000,
  environmentId: "env-local",
};

/** The row shape `list()` reads back. */
function storedRow(overrides: Partial<Record<string, unknown>> = {}): HydraRow {
  return {
    rule_id: rule.id,
    name: rule.name,
    statement: rule.statement,
    source_kind: rule.source.kind,
    source_property: rule.source.property,
    source_value: rule.source.value,
    source_description: rule.source.description,
    target_kind: rule.target.kind,
    target_property: rule.target.property,
    target_value: rule.target.value,
    target_description: rule.target.description,
    relations: rule.relations.join(","),
    max_hops: rule.maxHops,
    created_at: rule.createdAt,
    environment_id: rule.environmentId,
    ...overrides,
  };
}

describe("save", () => {
  it("writes every field the rule needs to be reconstructed", async () => {
    const { client, queries } = fakeClient();
    await new RuleStore(client).save(rule);

    const row = (queries[0].parameters?.rows as Record<string, unknown>[])[0];
    expect(row.rule_id).toBe(rule.id);
    expect(row.name).toBe(rule.name);
    expect(row.source_value).toBe("untrusted");
    expect(row.target_value).toBe("production");
    expect(row.max_hops).toBe(8);
  });

  it("flattens the relationship list, since only scalars can be stored", async () => {
    const { client, queries } = fakeClient();
    await new RuleStore(client).save(rule);

    const row = (queries[0].parameters?.rows as Record<string, unknown>[])[0];
    expect(row.relations).toBe("MAINTAINS,HAS_RELEASE,SUPPLIES");
  });

  it("uses the Rule label, keeping rules out of the graph they ask about", async () => {
    // Traversal is keyed on the Entity label. A rule stored there could turn up
    // inside a path — the audit distorting the thing it audits.
    const { client, queries } = fakeClient();
    await new RuleStore(client).save(rule);
    expect(queries[0].cypher).toContain("n:Rule");
    expect(queries[0].cypher).not.toContain("n:Entity");
  });
});

describe("list", () => {
  it("rebuilds a rule exactly as it was saved", async () => {
    const { client } = fakeClient([storedRow()]);
    const [restored] = await new RuleStore(client).list();

    expect(restored).toEqual(rule);
  });

  it("rebuilds the relationship list from its flattened form", async () => {
    const { client } = fakeClient([storedRow()]);
    const [restored] = await new RuleStore(client).list();
    expect(restored.relations).toEqual(["MAINTAINS", "HAS_RELEASE", "SUPPLIES"]);
  });

  it("drops a rule whose relationships are unrecognised", async () => {
    // A rule that traverses nothing can never find a path, so it would report
    // "verified" forever — a permanent false green. Better to omit it than to
    // present a rule that cannot do its job.
    const { client } = fakeClient([storedRow({ relations: "NONSENSE,ALSO_FAKE" })]);
    expect(await new RuleStore(client).list()).toEqual([]);
  });

  it("drops a rule with no id", async () => {
    const { client } = fakeClient([storedRow({ rule_id: null })]);
    expect(await new RuleStore(client).list()).toEqual([]);
  });

  it("keeps the valid relationships when only some are unrecognised", async () => {
    const { client } = fakeClient([storedRow({ relations: "MAINTAINS,GARBAGE,SUPPLIES" })]);
    const [restored] = await new RuleStore(client).list();
    expect(restored.relations).toEqual(["MAINTAINS", "SUPPLIES"]);
  });

  it("falls back to a sane hop bound rather than an unbounded traversal", async () => {
    // HydraDB rejects unbounded traversal outright, so a missing or nonsense
    // bound has to become a real number or the rule cannot be evaluated at all.
    const { client } = fakeClient([storedRow({ max_hops: "not a number" })]);
    const [restored] = await new RuleStore(client).list();
    expect(restored.maxHops).toBe(8);
  });

  it("orders by creation, so the list does not reshuffle between visits", async () => {
    const { client } = fakeClient([
      storedRow({ rule_id: "second", created_at: 2000 }),
      storedRow({ rule_id: "first", created_at: 1000 }),
    ]);
    const rules = await new RuleStore(client).list();
    expect(rules.map((r) => r.id)).toEqual(["first", "second"]);
  });
});

describe("ruleIdFromName", () => {
  it("makes a readable url from a name", () => {
    expect(ruleIdFromName("Outside publishers")).toBe("outside-publishers");
    expect(ruleIdFromName("CI reaching customer data")).toBe("ci-reaching-customer-data");
  });

  it("strips punctuation and collapses separators", () => {
    expect(ruleIdFromName("One-person   packages!!")).toBe("one-person-packages");
    expect(ruleIdFromName("  Leading and trailing  ")).toBe("leading-and-trailing");
  });

  it("always produces something usable", () => {
    // A name of pure punctuation must still yield a routable id rather than an
    // empty string that would collide with every other empty one.
    expect(ruleIdFromName("!!!")).toMatch(/^rule-[0-9a-f]{8}$/);
    expect(ruleIdFromName("")).toMatch(/^rule-[0-9a-f]{8}$/);
  });

  it("bounds the length", () => {
    expect(ruleIdFromName("a".repeat(200)).length).toBeLessThanOrEqual(48);
  });
});
