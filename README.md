# Tavik

**Prove who can put code into your systems, and by what route.**

Built for [Hack Hydra](https://hackhydra.hydradb.com/) — Track 02, supply chain.

---

## The problem

You don't write most of your code. You borrow it — hundreds or thousands of
packages written by strangers. A typical application is around 5% your own code
and 95% somebody else's.

Every one of those strangers can publish an update at any moment, and it lands in
your production system automatically.

Nobody can currently answer: **"which strangers can reach my production code
right now, and by what route?"**

Tavik answers it, re-answers it every minute, and proves each answer with a
specific chain you can check yourself.

Here is a real one, from scanning a repository we had never seen:

```
http-parser-js
  → websocket-driver
    → faye-websocket
      → @firebase/database
        → firebase
          → @circle-fin/w3s-pw-web-sdk
            → arclens-app/arclens
```

Eight hops. Whoever can publish `http-parser-js` — a small HTTP parsing library —
can reach that application through Firebase and a crypto wallet SDK. Nothing in
its `package.json` shows that.

---

## Quick start

You need [Node.js 20+](https://nodejs.org) and
[Docker Desktop](https://www.docker.com/products/docker-desktop/) (free).

```bash
git clone <this-repo>
cd tavik
npm install

npm run hydra:up      # starts HydraDB and waits for it
npm run dev           # http://localhost:3000
```

Open the app and scan something — a GitHub repository is the fastest:
paste `prettier/prettier` and watch it map 918 packages and 353 publishers.

Prefer the command line?

```bash
npm run scan -- prettier/prettier      # any public repository
npm run ingest                         # this project's own lockfile
npm run verify                         # check the rules
npm run demo                           # the whole loop: green → red → green
```

---

## What Tavik reads

| Source | What it learns |
| --- | --- |
| **GitHub repository** | Finds the lockfile itself, plus `.github/workflows` |
| **npm** `package-lock.json` | Exact resolved versions and the dependency tree |
| **Yarn** `yarn.lock` | v1 and Berry |
| **pnpm** `pnpm-lock.yaml` | All key formats, current and legacy |
| **npm registry** | Who can publish each package — live, no credentials |
| **GitHub Actions** | Whose code runs in your CI, and whether it is pinned |
| **AWS IAM** | Who can reach your data, via `get-account-authorization-details` |

Two risk surfaces, one model. A dependency reaching production and a CI action
reaching your secrets are the same question — *who can reach what* — so one rule
covers both.

---

## How it works

```
lockfile / repo / IAM export  ─┐
                               ├─→ one graph in HydraDB ─→ rules ─→ proof
npm registry ──────────────────┘                            │
                                                            └─→ fix → re-prove
```

1. **Read what is actually installed.** Not what was requested — what resolved.
2. **Find out who can change it.** One live registry request per package.
3. **Build the graph.** Publishers, packages, versions, services, CI, roles, data.
4. **Check your rules.** Written in plain language, re-checked every minute.
5. **Fix and re-prove.** Remove a dependency or approve a publisher, then run the
   same query again. Green is proven, never claimed.

---

## How HydraDB is used

Remove HydraDB and there is no product.

- **It stores the whole graph.** No second copy in a relational database.
- **It answers every reachability question.** Tavik never walks edges in
  application code — `algo.MSpaths` resolves many sources against many targets
  in a single call.
- **It provides the core primitive.** A rule holds when the path query returns
  nothing and is broken when it returns a path; that path *is* the evidence in
  the UI.
- **It makes fixes real.** A remediation deletes an edge, and the re-check runs
  the same query against the changed graph.

Across three scanned projects that is **4,023 entities and 9,446 relationships**,
with rules proven in a few seconds.

### What we learned about HydraDB

The published docs describe a much larger openCypher subset than the server
implements. We probed the running server and built against what it actually does;
`npm run hydra:probe` reproduces this. Full findings in [`docs/hydra.md`](docs/hydra.md).
The ones that cost us the most time:

- **Every result is capped at 1024 rows, silently.** Any read that might exceed
  it has to page with `SKIP`/`LIMIT`. Ours did not, so a diff saw only the first
  1024 edges and rewrote thousands of unchanged ones on every scan — which
  degraded the store until a rule check went from 976ms to 27,616ms and timed out.
- **Mass deletes are expensive.** Log-structured storage means churn slows every
  later read. Ingestion diffs instead of rewriting.
- Nodes need an integer `id`; `CREATE`/`MERGE` are refused without one.
- Labels are applied with `SET n:Label`, never inside a `MERGE` pattern.
- Query parameters exist despite the docs, but a composite parameter only works
  as an `UNWIND` input.
- Bare `RETURN 1` is rejected, and so is `RETURN` after a write.

---

## Design principles

**"Not checked" never means "safe".** If Tavik cannot complete a check it says
so. A false all-clear is indistinguishable from real safety on screen, which
makes it the most dangerous bug this product could have. Much of the engine's
test suite exists to prove specific failures do not report green.

**Verification is deterministic.** No model decides whether a path exists — a
graph traversal does.

**Counts are never inflated.** When a result is capped it shows `25+`, not `25`.
A sample presented as a total makes a partial fix look decisive.

**Nobody is accused.** Real maintainers appear in your graph. Tavik states only
capability — whether an account is on *your* list — and never anything about the
person. An account nobody has assessed is "not approved", which is a fact about
your process, not about them.

**Integrations say what they actually do.** Including the ones that do nothing
yet. Listing an unbuilt integration tells a team they have coverage they do not.

---

## Screens

| | |
| --- | --- |
| **Overview** | Is anything broken right now |
| **Rules** | What you have said must never happen |
| **Publishers** | Everyone who can change your code, ranked by reach |
| **Security graph** | Every route currently getting through |
| **Timeline** | Every moment a rule broke or healed |
| **Work log** | What Tavik has done |
| **Scan a project** | GitHub, lockfile, or AWS |
| **Integrations** | What is connected, and what is not |

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app |
| `npm run scan -- owner/repo` | Scan a public GitHub repository |
| `npm run ingest` | Scan this project's lockfile |
| `npm run ingest -- --lockfile path/to/lock` | Scan any lockfile |
| `npm run verify` | Check a rule from the command line |
| `npm run demo` | The whole loop, printed: green → red → green |
| `npm test` | 173 tests |
| `npm run hydra:probe` | Print what HydraDB actually accepts |
| `npm run reset` | Empty the workspace, to see the first run again |

---

## Tests

```bash
npm test
```

173 tests across 12 files. The ones that matter most:

- **Cypher injection.** npm package names are attacker-controlled, and
  `'}) DETACH DELETE n //` is a legal package name. Tested with real payloads.
- **Failure modes.** Proving that database outages, empty ingestion and contract
  drift all report `unknown`, never `verified`.
- **Lockfile parsers.** Scoped names, peer-dependency suffixes, every pnpm key
  shape, malformed YAML. A misparse does not crash — it quietly narrows the
  graph, and every rule then reports a smaller wrong answer confidently.
- **IAM.** Writing these found two real bugs: role-to-role trust was never
  detected, and listing a bucket counted as reading it.
- **Live end to end.** The full green → red → green loop against a running
  HydraDB. Skips automatically when Docker is not running.

---

## Configuration

Everything works with no configuration. `.env.example` documents the optional
extras: a Slack webhook for alerts, a GitHub token for private repositories or a
higher rate limit.

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
