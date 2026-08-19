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

The workspace starts genuinely empty. Scan something — a GitHub repository is
fastest: paste `prettier/prettier` and watch it map 918 packages and 353
publishers.

---

## Three ways to use it

Same engine, same graph, same work log behind all three. A publisher you approve
on the dashboard makes the CI check pass; a check that fails in CI appears in
your work log seconds later. There is no second copy of anything.

### 1. The dashboard

Where a person investigates a route and decides what to do about it — approve the
publisher, or cut the dependency. `npm run dev`.

### 2. The command line

```bash
npm install && npm link    # once, in this folder — puts `tavik` on your PATH

cd ~/your-project
tavik init                 # writes tavik.config.json, checks the connection
tavik scan                 # reads your lockfile and CI workflows
tavik check                # answers every rule
```

Tavik is not published to npm yet, so `npm link` from your clone is the install.
`npx tavik` will not work, and this README will say so until it does.

### 3. In CI, on every pull request

This is the one that matters — the difference between a dashboard someone visits
and a control that holds.

```yaml
- uses: actions/checkout@v4
- uses: <your-org>/tavik@main
  with:
    hydra-url: ${{ secrets.TAVIK_HYDRA_URL }}
    hydra-token: ${{ secrets.TAVIK_HYDRA_TOKEN }}
```

A change that opens a route into production fails the build, and the run summary
shows the exact chain, hop by hop. Exit codes are the contract:

| Code | Meaning |
| --- | --- |
| `0` | every rule was checked, and every rule holds |
| `1` | a rule has a way through |
| `2` | a rule **could not be checked** |
| `3` | Tavik could not run at all |

Code `2` is deliberate and on by default. "We didn't check" is not "it's fine",
and a build that goes green on an unanswered rule is the exact false assurance
this product exists to prevent. `--allow-unchecked` opts out on purpose.

The Action needs a HydraDB your runner can reach. There is no hosted option and
nothing here pretends otherwise. See
[`.github/workflows/tavik-example.yml`](.github/workflows/tavik-example.yml),
which also explains what scanning a branch does to a shared graph.

### Rules live in your repository

```json
{
  "service": "checkout-api",
  "environment": "production",
  "rules": [
    { "name": "No unapproved publishers", "from": "outside-publishers", "to": "production" },
    { "name": "No abandoned code", "from": "abandoned-versions", "to": "production" }
  ]
}
```

`tavik check` applies the file before verifying, so a rule added in a pull
request takes effect on that build. `tavik rules add` walks you through writing
one and writes it here, so declaring a boundary is a reviewable diff rather than
something one person clicked once.

`from` and `to` come from a closed vocabulary — every option is backed by a
property ingestion actually writes, so a rule in this file can always be
answered. A free-form selector would let you write a rule that silently matches
nothing and reports `unknown` forever, which reads as a broken product rather
than an unanswerable question.

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

Across three scanned projects that reached **4,023 entities and 9,446
relationships**, with rules proven in a few seconds.

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
- **There is no bulk delete at all.** `WITH … LIMIT` before a write is refused by
  the mutation engine, `DELETE … LIMIT` will not parse, and deleting every node
  in one statement exceeds the 30-second query limit. A single `DETACH DELETE`
  measured at 1.5 seconds on a populated graph, so emptying a real workspace from
  the interface is not viable — `npm run reset` replaces the volume instead, and
  the interface says so rather than offering a button that appears to hang.
- **One statement cannot set a property to two values.** Two ingestion stages
  describing the same release — the lockfile knows it is installed, the registry
  knows it is deprecated — get rejected as `conflicting metadata values` unless
  they are merged first.
- **A token is scoped to one graph.** Handy idea, ruled out: a graph per pull
  request is not available without provisioning a token per graph.
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
The same applies to setup instructions: Tavik is not on npm, so this README says
`npm link` rather than `npx tavik`, because a command that does not run is the
same class of dishonesty as a rule that reports safe without checking.

**Every approval carries a name.** Four roles, checked on the server inside each
action rather than by hiding buttons — a server action is a public endpoint
whether or not anything on screen points at it. The Team screen is honest that
this is attribution and not authentication: Tavik runs as one workspace with
nothing to check a password against, and a login form that checks nothing is
worse than none.

---

## What it costs

Stated plainly, because these are the numbers a team will meet.

| | |
| --- | --- |
| Scanning ~600 packages | about 2 minutes |
| Checking one rule | 1–4 seconds |
| Re-checking a watched repository that has not changed | ~260ms |
| Reading it in full when it has | ~155 seconds |

Scanning is one live registry request per package, and that dominates. Fetching
smaller documents was tried and made it *slower* — request latency dominates, not
bytes — so the concurrency limit was measured and raised instead. The commit
history records the attempt and the numbers rather than quietly dropping it.

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
| **Get started** | A four-step guided setup — scan, sign, write a rule, enforce it |
| **Watched repos** | Repositories Tavik re-reads on its own |
| **Integrations** | What is connected, and what is not |
| **Team** | Who is using Tavik, and what each role may do |

---

## Commands

### The `tavik` CLI

| Command | What it does |
| --- | --- |
| `tavik init` | Write `tavik.config.json`, and prove the connection works |
| `tavik scan` | Read this project — lockfile and CI workflows — into the graph |
| `tavik scan --repo owner/name` | Read a public GitHub repository instead |
| `tavik check` | Answer every rule. Exits non-zero when one breaks |
| `tavik check --json` | The same, for machines |
| `tavik rules` | List what this workspace has declared |
| `tavik rules add` | Declare a boundary, and write it to the config |
| `tavik rules remove <id>` | Stop enforcing one |
| `tavik approve <publisher>` | Put an account on the approved publisher list |
| `tavik review <publisher>` | Put one under review instead |

### Running the project

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app |
| `npm run hydra:up` | Start HydraDB and wait for it |
| `npm test` | 251 tests |
| `npm run typecheck` | TypeScript, strict |
| `npm run hydra:probe` | Print what HydraDB actually accepts |
| `npm run reset` | Empty the workspace, to see the first run again |
| `npm run demo` | The whole loop, printed: green → red → green |

---

## Tests

```bash
npm test
```

251 tests across 18 files. The ones that matter most:

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
