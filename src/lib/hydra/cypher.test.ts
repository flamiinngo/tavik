import { describe, expect, it } from "vitest";
import {
  CypherEncodingError,
  cy,
  encodeString,
  encodeValue,
  identifier,
  raw,
} from "./cypher";

/**
 * These are not hypotheticals. npm package names, versions, maintainer handles
 * and repository URLs are published by anyone, and Tavik ingests them directly
 * into Cypher text because HydraDB has no parameter binding. A single unescaped
 * quote is arbitrary graph mutation — in a product whose entire value is that
 * the graph tells the truth.
 */
describe("encodeString", () => {
  it("wraps plain values in single quotes", () => {
    expect(encodeString("lodash")).toBe("'lodash'");
  });

  it("escapes the quote used to terminate a literal", () => {
    expect(encodeString("a'b")).toBe("'a\\'b'");
  });

  it("escapes backslashes so they cannot escape the closing quote", () => {
    // Naive escaping turns `x\` into `'x\'` — the backslash then escapes the
    // closing quote and the literal runs on into attacker-controlled text.
    expect(encodeString("x\\")).toBe("'x\\\\'");
  });

  it("neutralises a classic injection payload", () => {
    const hostile = "a' OR 1=1 //";
    const encoded = encodeString(hostile);
    expect(encoded).toBe("'a\\' OR 1=1 //'");
    // Every quote after the opener is escaped.
    expect(encoded.slice(1, -1).replace(/\\'/g, "")).not.toContain("'");
  });

  it("neutralises an attempt to close the literal and delete the graph", () => {
    const hostile = "x'}) DETACH DELETE n //";
    expect(encodeString(hostile)).toBe("'x\\'}) DETACH DELETE n //'");
  });

  it("escapes newlines, which would otherwise end a line comment", () => {
    // Without this, `//` in a payload plus a real newline resumes execution.
    expect(encodeString("a\nb")).toBe("'a\\nb'");
    expect(encodeString("a\r\nb")).toBe("'a\\r\\nb'");
  });

  it("escapes control characters rather than emitting them raw", () => {
    expect(encodeString("a\u0000b")).toBe("'a\\u0000b'");
    expect(encodeString("a\u0007b")).toBe("'a\\u0007b'");
    expect(encodeString("a\u001bb")).toBe("'a\\u001bb'");
  });

  it("escapes bidirectional overrides that would disguise the query in logs", () => {
    // U+202E renders following text right-to-left, which can make a malicious
    // identifier look benign to a human reviewing an audit log.
    expect(encodeString("safe\u202eevil")).toBe("'safe\\u202eevil'");
  });

  it("escapes non-ASCII so the emitted query is pure ASCII", () => {
    expect(encodeString("café")).toBe("'caf\\u00e9'");
    expect(encodeString("日本")).toBe("'\\u65e5\\u672c'");
  });

  it("handles astral-plane characters as surrogate pairs", () => {
    expect(encodeString("\u{1F600}")).toBe("'\\ud83d\\ude00'");
  });

  it("round-trips a realistic scoped package name unharmed", () => {
    expect(encodeString("@babel/plugin-transform-runtime")).toBe(
      "'@babel/plugin-transform-runtime'",
    );
  });
});

describe("encodeValue", () => {
  it("encodes primitives", () => {
    expect(encodeValue(42)).toBe("42");
    expect(encodeValue(-1.5)).toBe("-1.5");
    expect(encodeValue(true)).toBe("true");
    expect(encodeValue(false)).toBe("false");
    expect(encodeValue(null)).toBe("null");
    expect(encodeValue(undefined)).toBe("null");
  });

  it("rejects non-finite numbers instead of emitting invalid Cypher", () => {
    expect(() => encodeValue(Number.NaN)).toThrow(CypherEncodingError);
    expect(() => encodeValue(Number.POSITIVE_INFINITY)).toThrow(CypherEncodingError);
  });

  it("encodes lists", () => {
    expect(encodeValue(["a", 1, true])).toBe("['a', 1, true]");
    expect(encodeValue([])).toBe("[]");
  });

  it("encodes maps and validates their keys", () => {
    expect(encodeValue({ name: "lodash", major: 4 })).toBe(
      "{name: 'lodash', major: 4}",
    );
  });

  it("drops undefined map entries rather than emitting nulls", () => {
    expect(encodeValue({ name: "lodash", deprecated: undefined })).toBe(
      "{name: 'lodash'}",
    );
  });

  it("refuses a map key that is not a safe identifier", () => {
    // A property key sourced from ingested data is a bug; fail loudly.
    expect(() => encodeValue({ "evil`key": 1 })).toThrow(CypherEncodingError);
    expect(() => encodeValue({ "a b": 1 })).toThrow(CypherEncodingError);
  });

  it("nests", () => {
    expect(encodeValue({ tags: ["a'b", "c"] })).toBe("{tags: ['a\\'b', 'c']}");
  });
});

describe("identifier", () => {
  it("accepts schema identifiers", () => {
    expect(identifier("Package").text).toBe("Package");
    expect(identifier("DEPENDS_ON").text).toBe("DEPENDS_ON");
    expect(identifier("_internal").text).toBe("_internal");
  });

  it("rejects anything that could alter query structure", () => {
    for (const bad of [
      "Package Name",
      "Package)",
      "`Package`",
      "Package-1",
      "1Package",
      "",
      "n:Label",
      "a'b",
    ]) {
      expect(() => identifier(bad), bad).toThrow(CypherEncodingError);
    }
  });

  it("rejects overlong identifiers", () => {
    expect(() => identifier("a".repeat(65))).toThrow(CypherEncodingError);
  });
});

describe("cy", () => {
  it("encodes interpolated values", () => {
    const name = "left-pad";
    expect(cy`MATCH (p:Package {name: ${name}}) RETURN p.name AS name`).toBe(
      "MATCH (p:Package {name: 'left-pad'}) RETURN p.name AS name",
    );
  });

  it("keeps a hostile package name inside its literal", () => {
    const hostile = "'}) DETACH DELETE n MATCH (p:Package {name:'";
    const query = cy`MATCH (p:Package {name: ${hostile}}) RETURN p.name AS name`;

    // The payload text still appears — that is fine and unavoidable, because it
    // is a legitimate (if absurd) package name. What matters is that it stays
    // *inside* the literal and cannot alter the statement's structure.
    //
    // Exactly two unescaped quotes: the ones this template opened and closed.
    const unescaped = query.replace(/\\'/g, "").match(/'/g) ?? [];
    expect(unescaped).toHaveLength(2);

    // The template's own structure survives intact at both ends.
    expect(query.startsWith("MATCH (p:Package {name: '")).toBe(true);
    expect(query.endsWith("'}) RETURN p.name AS name")).toBe(true);

    // Every quote the attacker supplied was escaped.
    expect(query).toContain("\\'}) DETACH DELETE n");
  });

  it("inserts pre-validated fragments verbatim", () => {
    const label = identifier("Package");
    expect(cy`MATCH (p:${label}) RETURN count(p) AS total`).toBe(
      "MATCH (p:Package) RETURN count(p) AS total",
    );
  });

  it("supports templates with no interpolation", () => {
    expect(cy`RETURN 1 AS ok`).toBe("RETURN 1 AS ok");
  });

  it("raw() is the only way to bypass encoding", () => {
    expect(cy`RETURN ${raw("1 + 1")} AS two`).toBe("RETURN 1 + 1 AS two");
  });
});
