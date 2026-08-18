# Tavik

**Your 11th security engineer.** Tavik continuously proves that the security
rules your team depends on are still true as your code changes.

Built for [Hack Hydra](https://hackhydra.hydradb.com/) — Track 02, supply chain.

---

## The problem

You don't write most of your code. You borrow it — hundreds or thousands of
packages written by strangers. A typical app is ~5% your code and ~95% borrowed.

Every one of those strangers can publish an update at any moment, and it lands in
your app automatically.

Nobody can currently answer: **"Which strangers can put code into my production
system right now, and by what route?"**

Tavik answers it, continuously, and proves the answer with a specific chain you
can check yourself.

---

## Quick start

You need [Node.js 20+](https://nodejs.org) and
[Docker Desktop](https://www.docker.com/products/docker-desktop/) (free).

```bash
git clone <this-repo>
cd tavik
npm install

npm run hydra:up      # starts HydraDB in Docker and waits for it
npm run ingest        # reads this repo's package-lock.json + the live npm registry
npm run dev           # http://localhost:3000
```

`npm run ingest` takes about a minute — it asks the public npm registry who can
publish each of your dependencies. No credentials needed; the registry is public.

### See the whole product loop without a browser

```bash
npm run demo
```

Prints green → red → green against the real graph: a publisher is placed under
review, Tavik finds every route their code takes into production, a fix is
applied, and the boundary is re-proven.

### Other commands

| Command | What it does |
| --- | --- |
| `npm run ingest -- --lockfile path/to/package-lock.json` | Ingest a different project |
| `npm run verify` | Check a rule from the command line |
| `npm test` | 86 tests, including a live end-to-end run |
| `npm run hydra:probe` | Print what HydraDB actually accepts |
| `npm run hydra:down` | Stop the database |

---

## How HydraDB is used

HydraDB is not decorative here. Remove it and there is no product.

- **It stores the entire security graph.** There is no second copy in a
  relational database.
- **It answers every reachability question.** Tavik never walks edges in
  application code — `algo.MSpaths` resolves many sources against many targets
  inside the database, in a single call.
- **It provides the core primitive.** A rule holds when the path query returns
  nothing, and is broken when it returns a path — and that path *is* the evidence
  shown in the UI.
- **It makes fixes real.** A remediation deletes an edge, and the re-check runs
  the same query against the mutated graph. Restoration is re-computed, never
  claimed.

On this repository that means **1,279 entities and 2,313 relationships**, with a
rule proven in roughly **500ms**.

### What we learned about HydraDB

The published docs describe a much larger openCypher subset than the server
implements. We probed the running server and built against what it actually
does — `npm run hydra:probe` reproduces this. The full findings are in
[`docs/hydra.md`](docs/hydra.md); the highlights:

- Nodes need an integer `id`; `CREATE`/`MERGE` are refused without one.
- Labels are applied with `SET n:Label`, never inside a `MERGE` pattern.
- Query parameters **do** exist (via a `parameters` field), contrary to the docs —
  but a composite parameter only works as an `UNWIND` input.
- Bare `RETURN 1` is rejected; so is `RETURN` after a write.
- Mass deletes are expensive enough to degrade every subsequent read, so
  ingestion is incremental rather than delete-and-rewrite.

---

## Architecture

```
package-lock.json ─┐
                   ├─→ ingest ─→ HydraDB ─→ verify ─→ result + proof
npm registry ──────┘                          │
                                              └─→ remediate ─→ re-verify
```

```
src/lib/domain/     entities, rules, change log — domain-neutral
src/lib/hydra/      client, Cypher encoding, node ids, graph store
src/lib/ingest/     npm registry, lockfile parser, pipeline
src/lib/engine/     verification, remediation, change log
src/components/     UI, graph rendering, mascot
scripts/            ingest, verify, demo, probes
docs/               architecture, HydraDB contract, decision log
```

---

## Design principles

**`unknown` never means safe.** If Tavik can't complete a check, it says so. A
false "verified" is indistinguishable from real safety on screen, which makes it
the most dangerous bug this product can have. Most of the engine's test suite
exists to prove specific failures don't report green.

**Verification is deterministic.** No model decides whether a path exists — a
graph traversal does. An LLM may later explain a finding; it will never produce
one.

**We never accuse a real person.** Real npm accounts appear in this graph. Tavik
states only capability facts — whether an account is on *your* allowlist, or has
been paused pending review. Nothing here implies wrongdoing by anyone.

**Counts are never inflated.** When a result is capped, it shows `25+`, not `25`.
A sample presented as a total makes a partial fix look decisive.

---

## Tests

```bash
npm test
```

86 tests. Highlights:

- **Cypher injection** — npm package names are attacker-controlled, and
  `'}) DETACH DELETE n //` is a legal package name. Tested with real payloads.
- **Failure modes** — proving that database outages, empty ingestion and contract
  drift all report `unknown`, never `verified`.
- **Live end-to-end** — the full green → red → green loop against a running
  HydraDB. Skips automatically when Docker isn't running.

---

## Licence

MIT — see [`LICENSE`](LICENSE).

HydraDB is AGPL-3.0 and runs unmodified as a separate service, so it does not
constrain this project's licence.

### Credits

- [HydraDB](https://github.com/hydra-db/hydradb) — graph database
- [npm registry](https://registry.npmjs.org) — public package and publisher data
- [d3-force](https://d3js.org/d3-force) — graph layout
- [Next.js](https://nextjs.org), [Tailwind CSS](https://tailwindcss.com)
