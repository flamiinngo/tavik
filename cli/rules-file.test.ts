import { describe, expect, it } from "vitest";

import { ConfigError } from "./config";
import { ALL_SOURCES, ALL_TARGETS, compileRule, parseRules } from "./rules-file";

/**
 * The rules file decides what gets checked, so a mistake in it is coverage
 * somebody thinks they have and does not.
 *
 * Every assertion here is about refusing quietly-wrong input. A rule dropped for
 * a typo, or one that compiles into a selector matching nothing, produces a
 * green build for a boundary nobody is actually enforcing — which is worse than
 * no tool at all, because the team has stopped watching for it themselves.
 */

const PATH = "tavik.config.json";
const valid = { name: "Outside publishers", from: "outside-publishers", to: "production" };

describe("parseRules", () => {
  it("accepts no rules at all", () => {
    expect(parseRules(undefined, PATH)).toEqual([]);
  });

  it("reads a well-formed rule", () => {
    expect(parseRules([valid], PATH)).toEqual([
      { name: "Outside publishers", from: "outside-publishers", to: "production", maxHops: undefined },
    ]);
  });

  it("trims the name, so an id derived from it is stable", () => {
    const [rule] = parseRules([{ ...valid, name: "  Outside publishers  " }], PATH);
    expect(rule.name).toBe("Outside publishers");
  });
});

describe("refusing a rule that could not be answered", () => {
  it("rejects a source Tavik cannot select on", () => {
    // The dangerous case. A free-form selector would be accepted, match nothing,
    // and report `unknown` forever — which reads as a broken product rather than
    // an unanswerable rule.
    expect(() => parseRules([{ ...valid, from: "anyone-suspicious" }], PATH)).toThrow(ConfigError);
  });

  it("rejects an unknown target", () => {
    expect(() => parseRules([{ ...valid, to: "the-database" }], PATH)).toThrow(ConfigError);
  });

  it("lists the valid options, so the message is enough to fix it", () => {
    try {
      parseRules([{ ...valid, from: "nope" }], PATH);
      throw new Error("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain(PATH);
      // Names the rule, so the right line is obvious in a long file.
      expect(message).toContain("Outside publishers");
      for (const preset of ALL_SOURCES) expect(message).toContain(preset.id);
    }
  });
});

describe("refusing a rule that is merely malformed", () => {
  it("rejects a rules value that is not a list", () => {
    expect(() => parseRules({ name: "x" }, PATH)).toThrow(ConfigError);
  });

  it("rejects a rule with no name", () => {
    expect(() => parseRules([{ from: "outside-publishers", to: "production" }], PATH)).toThrow(
      ConfigError,
    );
  });

  it("rejects a blank name", () => {
    expect(() => parseRules([{ ...valid, name: "   " }], PATH)).toThrow(ConfigError);
  });

  it("rejects a setting it does not recognise", () => {
    // A misspelled key is a silent no-op otherwise, and the person is left
    // believing they configured something they did not.
    expect(() => parseRules([{ ...valid, severity: "high" }], PATH)).toThrow(/severity/);
  });

  it("rejects a fractional hop count", () => {
    expect(() => parseRules([{ ...valid, maxHops: 2.5 }], PATH)).toThrow(ConfigError);
  });

  it("rejects a hop count of zero", () => {
    expect(() => parseRules([{ ...valid, maxHops: 0 }], PATH)).toThrow(ConfigError);
  });

  it("rejects a hop count past what stays answerable", () => {
    // A very deep bound turns a fast check into one that times out and reports
    // `unknown`, which looks like a broken rule rather than a slow one.
    expect(() => parseRules([{ ...valid, maxHops: 40 }], PATH)).toThrow(ConfigError);
  });

  it("names the index, so the right entry is findable in a long file", () => {
    try {
      parseRules([valid, valid, { ...valid, to: "nowhere" }], PATH);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("rules[2]");
    }
  });
});

describe("compileRule", () => {
  it("produces a rule the engine can evaluate", () => {
    const rule = compileRule({ name: "Outside publishers", from: "outside-publishers", to: "production" });

    expect(rule.source.kind).toBe("Maintainer");
    expect(rule.target.kind).toBe("Service");
    expect(rule.relations).toContain("MAINTAINS");
    expect(rule.maxHops).toBe(8);
  });

  it("writes a statement in the words a team would use", () => {
    const rule = compileRule({ name: "x", from: "abandoned-versions", to: "production" });
    expect(rule.statement).toMatch(/should never be able to reach/);
  });

  it("derives the id from the name, so editing updates in place", () => {
    // Otherwise a corrected rule leaves the old one behind, still failing builds
    // for a reason nobody can find in the file.
    const first = compileRule({ name: "No abandoned code", from: "abandoned-versions", to: "production" });
    const again = compileRule({
      name: "No abandoned code",
      from: "abandoned-versions",
      to: "production",
      maxHops: 4,
    });

    expect(again.id).toBe(first.id);
    expect(again.maxHops).toBe(4);
  });

  it("takes the relationships from the source, not from the author", () => {
    // Which links have to be crossed is a consequence of what the source is. A
    // rule about publishers must cross publish rights to reach anything; one
    // about versions must not.
    const publishers = compileRule({ name: "a", from: "outside-publishers", to: "production" });
    const versions = compileRule({ name: "b", from: "abandoned-versions", to: "production" });

    expect(publishers.relations).toContain("MAINTAINS");
    expect(versions.relations).not.toContain("MAINTAINS");
  });

  it("compiles every preset combination the CLI offers", () => {
    // Guards the wizard: every option it can put in front of someone has to
    // produce a rule that compiles, or they hit an error for choosing from a
    // menu Tavik gave them.
    for (const source of ALL_SOURCES) {
      for (const target of ALL_TARGETS) {
        const rule = compileRule({ name: `${source.id} to ${target.id}`, from: source.id, to: target.id });
        expect(rule.id.length).toBeGreaterThan(0);
        expect(rule.statement.length).toBeGreaterThan(0);
      }
    }
  });
});
