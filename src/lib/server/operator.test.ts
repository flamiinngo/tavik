import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cookie is the only input to who Tavik thinks you are, and it arrives from
 * the browser, so it is untrusted in the ordinary way: it can be absent,
 * truncated, hand-edited, or carry a role that does not exist.
 *
 * None of those may throw. A malformed cookie that 500s the app would lock
 * someone out of their own workspace over a stray character — and the failure
 * mode that matters more is the opposite one, a junk `role` quietly resolving to
 * something powerful.
 */

const store = new Map<string, string>();

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = store.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name),
  }),
}));

const { clearOperator, currentOperator, gate, setOperator } = await import("./operator");

const COOKIE = "tavik_operator";
const write = (payload: unknown) =>
  store.set(COOKIE, encodeURIComponent(JSON.stringify(payload)));

beforeEach(() => store.clear());

describe("an unidentified operator", () => {
  it("is reported as unidentified so the interface can ask", async () => {
    const operator = await currentOperator();
    expect(operator.identified).toBe(false);
  });

  it("keeps full capability rather than defaulting to the weakest role", async () => {
    // Deliberate, and the opposite of what a login system should do. There is
    // nothing to authenticate against here, so a restrictive default would lock
    // the actual owner out of their own local tool while stopping nobody.
    const allowed = await gate("manageWorkspace");
    expect(allowed.allowed).toBe(true);
  });
});

describe("reading the cookie", () => {
  it("round-trips a name and role", async () => {
    await setOperator("Ada Lovelace", "engineer");
    const operator = await currentOperator();

    expect(operator).toMatchObject({
      name: "Ada Lovelace",
      role: "engineer",
      identified: true,
    });
  });

  it("forgets who you are when cleared", async () => {
    await setOperator("Ada Lovelace", "engineer");
    await clearOperator();

    expect((await currentOperator()).identified).toBe(false);
  });

  it("trims whitespace and caps the length", async () => {
    await setOperator(`  ${"a".repeat(200)}  `, "viewer");
    expect((await currentOperator()).name).toHaveLength(60);
  });
});

describe("a cookie that cannot be trusted", () => {
  it("falls back rather than throwing on unparseable text", async () => {
    store.set(COOKIE, "not-json-at-all");
    expect((await currentOperator()).identified).toBe(false);
  });

  it("falls back when the name is missing", async () => {
    write({ role: "owner" });
    expect((await currentOperator()).identified).toBe(false);
  });

  it("falls back when the name is only whitespace", async () => {
    write({ name: "   ", role: "owner" });
    expect((await currentOperator()).identified).toBe(false);
  });

  it("refuses a role it does not recognise instead of accepting it", async () => {
    // The important direction: an invented role must not be honoured, and must
    // not be resolved upwards either.
    write({ name: "Mallory", role: "superuser" });
    const operator = await currentOperator();

    expect(operator.role).toBe("engineer");
    expect((await gate("manageWorkspace")).allowed).toBe(false);
  });

  it("refuses a role of the wrong type", async () => {
    write({ name: "Mallory", role: { toString: () => "owner" } });
    expect((await currentOperator()).role).toBe("engineer");
  });
});

describe("gate", () => {
  it("lets an engineer apply a fix", async () => {
    await setOperator("Ada Lovelace", "engineer");
    const allowed = await gate("remediate");

    expect(allowed.allowed).toBe(true);
    if (allowed.allowed) expect(allowed.operator.name).toBe("Ada Lovelace");
  });

  it("refuses a viewer, with a reason worth showing them", async () => {
    await setOperator("Grace", "viewer");
    const allowed = await gate("remediate");

    expect(allowed.allowed).toBe(false);
    if (!allowed.allowed) {
      expect(allowed.reason).toContain("viewer");
      // Says who can do it instead. A bare refusal leaves them stuck.
      expect(allowed.reason).toContain("owner");
    }
  });

  it("still lets a viewer read", async () => {
    await setOperator("Grace", "viewer");
    expect((await gate("read")).allowed).toBe(true);
  });
});
