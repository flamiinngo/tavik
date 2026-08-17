/**
 * Cypher literal encoding.
 *
 * HydraDB's HTTP query API accepts a Cypher string and exposes no parameter
 * binding, so every value Tavik queries with has to be encoded into the query
 * text itself. Most of that data is hostile by construction: package names,
 * versions, maintainer handles and repository URLs all come from the public npm
 * registry, where anyone can publish a name containing a quote, a backslash or a
 * newline. A package literally named `a' OR 1=1 //` is a valid npm package name.
 *
 * Treat this module as the trust boundary between untrusted registry data and
 * the graph. Nothing may reach HydraDB except through {@link cy} or
 * {@link encodeValue}, and identifiers (labels, relationship types, property
 * keys) are never interpolated from user data at all — they are validated
 * against a strict allowlist first.
 */

/** A value that can be encoded as a Cypher literal. */
export type CypherValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | CypherFragment
  | readonly CypherValue[]
  | { readonly [key: string]: CypherValue };

/**
 * A pre-validated fragment of Cypher that is injected verbatim.
 *
 * Deliberately awkward to construct: every call site is a place where escaping
 * has been consciously bypassed, so they should be greppable and few.
 */
export class CypherFragment {
  constructor(readonly text: string) {}
  toString(): string {
    return this.text;
  }
}

/** Identifiers we are willing to emit unquoted: labels, rel types, property keys. */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export class CypherEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CypherEncodingError";
  }
}

/**
 * Validate a Cypher identifier (label, relationship type, or property key).
 *
 * Identifiers are structural: they come from Tavik's own schema, never from
 * ingested data. This throws rather than escaping, because an identifier that
 * needs escaping means a bug upstream, not a value to sanitise.
 */
export function identifier(name: string): CypherFragment {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new CypherEncodingError(
      `Refusing to emit ${JSON.stringify(name)} as a Cypher identifier. ` +
        `Identifiers must match ${IDENTIFIER_PATTERN} and must originate from ` +
        `Tavik's schema, never from ingested data.`,
    );
  }
  return new CypherFragment(name);
}

/**
 * Escape a string into a single-quoted Cypher literal.
 *
 * Everything outside printable ASCII-safe territory is emitted as a `\uXXXX`
 * escape. That is stricter than Cypher requires, but it means the emitted query
 * is pure ASCII and cannot be altered by terminal control characters, bidi
 * overrides, or normalisation differences in intermediate layers.
 */
export function encodeString(value: string): string {
  let out = "'";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    switch (char) {
      case "'":
        out += "\\'";
        continue;
      case "\\":
        out += "\\\\";
        continue;
      case "\n":
        out += "\\n";
        continue;
      case "\r":
        out += "\\r";
        continue;
      case "\t":
        out += "\\t";
        continue;
      default:
        break;
    }
    // Printable ASCII passes through; everything else is escaped by code unit.
    if (code >= 0x20 && code <= 0x7e) {
      out += char;
    } else {
      for (let i = 0; i < char.length; i++) {
        out += "\\u" + char.charCodeAt(i).toString(16).padStart(4, "0");
      }
    }
  }
  return out + "'";
}

function encodeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new CypherEncodingError(
      `Cannot encode non-finite number ${value} as a Cypher literal.`,
    );
  }
  return String(value);
}

/** Encode any supported value as a Cypher literal. */
export function encodeValue(value: CypherValue): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof CypherFragment) return value.text;

  switch (typeof value) {
    case "string":
      return encodeString(value);
    case "number":
      return encodeNumber(value);
    case "boolean":
      return value ? "true" : "false";
    case "object":
      break;
    default:
      throw new CypherEncodingError(
        `Cannot encode value of type ${typeof value} as a Cypher literal.`,
      );
  }

  if (Array.isArray(value)) {
    return "[" + value.map(encodeValue).join(", ") + "]";
  }

  const entries = Object.entries(value as Record<string, CypherValue>).filter(
    ([, v]) => v !== undefined,
  );
  return (
    "{" +
    entries
      .map(([key, v]) => `${identifier(key).text}: ${encodeValue(v)}`)
      .join(", ") +
    "}"
  );
}

/**
 * Tagged template for building Cypher. Interpolated values are encoded; only a
 * {@link CypherFragment} is inserted verbatim.
 *
 * ```ts
 * cy`MATCH (p:Package {name: ${name}}) RETURN p.name AS name`
 * ```
 */
export function cy(
  strings: TemplateStringsArray,
  ...values: readonly CypherValue[]
): string {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += encodeValue(values[i]) + strings[i + 1];
  }
  return out;
}

/**
 * Wrap trusted, statically-known Cypher so it can be interpolated by {@link cy}.
 * Never call this with data that originated outside Tavik's own source.
 */
export function raw(text: string): CypherFragment {
  return new CypherFragment(text);
}
