<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# Tavik — working context

Read this before changing anything. It is the handoff document: it assumes you
know nothing about this repository and tells you what Tavik is, what has been
decided and why, what is verified fact versus assumption, and where the work
stopped.

Companion documents:

- `memory/` — **working memory. Read `memory/MEMORY.md` first.** Durable project
  facts, current state, and what is blocked. Keep it updated as you work.
- `docs/hydra.md` — HydraDB integration, schema, and the constraints that shaped it
- `docs/decisions.md` — decision log, including assumptions that proved false
- `docs/architecture.md` — the end-to-end pipeline and how a team uses the product

## What Tavik is

A **continuous security boundary verification** product. A team declares a rule
that must never become true — *"no production service may depend on a package
whose publish rights sit outside our trusted publisher set"* — and Tavik
continuously proves whether it still holds as things change.

The core loop, which is also the demo:

```
GREEN (verified) → state change → RED (violated)
   → explain the exact path → prepare remediation
   → human approves → apply → re-verify → GREEN (restored)
```

Tavik is **not** a chatbot, not an LLM wrapper, and not a scanner. The product
must work end to end without the user ever typing a question. Scanners enumerate
what *is* wrong and leave a human to judge severity; a boundary is a binary claim
that a machine can check continuously and prove with a concrete path.

## Non-negotiable rules

These come from the product brief and are not up for quiet reinterpretation.

1. **No fake data, ever.** No invented graph presented as real infrastructure, no
   fabricated metrics, no button that merely animates green to red. Demo data is
   permitted but must be labelled `DEMO ENVIRONMENT` and must flow through the
   same real pipeline.
2. **No invented HydraDB capabilities.** If the API does not do something, say so
   and work around it honestly. See `docs/hydra.md`.
3. **Never defame a real maintainer.** Real npm accounts appear in the graph.
   Tavik states only the capability fact — the account is *not on our
   allowlist* — and must never call a real person or account "compromised",
   "malicious", or "untrusted" in UI copy, docs, or the demo video.
4. **`unknown` must never collapse into `verified`.** If the graph could not be
   read, the boundary status is `unknown`. Reporting an unverified boundary as
   safe is the worst failure this product has.
5. **Deterministic verification stays deterministic.** An LLM may explain a
   finding or turn prose into a boundary definition. It must never decide whether
   a path exists.
6. **No mascot substitution.** The Tavik character is a supplied asset. Do not
   generate a replacement. As of this writing the asset has **not** been
   provided — build the slots, leave them empty.

## Hackathon context

Built for **Hack Hydra** (HydraDB open-source hackathon, 12–20 August 2026,
$10,000 in prizes). Rules that constrain the repo:

- **Track 02, variant A** — supply chain blast radius over a dependency graph.
- No participant-authored commits before 12 August 2026. First commit here is
  16 August 2026, which is fine.
- Repo must be public, carry an open-source licence (MIT, see `LICENSE`), a clear
  README, setup instructions, an explanation of how HydraDB is used, and
  attribution for third-party code.
- Submission needs a demo video of **3 minutes or less**. Judges weight it
  heavily.
- HydraDB must do **real work**, not sit in the README. Judged on: technical
  execution, use of HydraDB and graph-native approaches, product completeness,
  quality of results, originality.

**Why supply chain and not cloud IAM.** The original brief described cloud IAM
boundary verification. Track 02 asks about dependency and code graphs, and
judging happens *within track first*. Answering a different question than the one
asked is how strong projects lose round one. The verification engine is
domain-neutral, so supply chain became the primary demo and cloud IAM ships as a
second boundary type — which also proves the engine generalises.

## Stack

Next.js 16.3.1 · React 19.2.8 · TypeScript strict · Tailwind v4 · vitest ·
HydraDB via Docker. Licence MIT. HydraDB itself is AGPL-3.0 but runs unmodified
as a separate service, so it does not constrain ours.

## Layout

```
src/lib/hydra/      HydraDB client, Cypher escaping, graph store
src/lib/domain/     Entities, relationships, boundaries. Domain-neutral.
src/lib/ingest/     npm registry client; lockfile and IAM ingestion
scripts/            hydra-setup (token + volume), hydra-probe (contract check)
docs/               Integration notes, decision log, architecture
```

## Running it

```bash
npm install
npm run hydra:setup    # generates the DB auth token, writes .env.local
npm run hydra:up       # starts HydraDB in Docker, waits for health
npm run hydra:probe    # prints HydraDB's real responses — run after any upgrade
npm run dev
npm test               # 26 tests, mostly adversarial Cypher escaping
npm run typecheck
```

Docker Desktop is required. It was not installed on the original machine, which
is why LocalStack was ruled out for the cloud-IAM side.

## The one thing most likely to bite you

**HydraDB has no query parameters.** Cypher is assembled as text. Tavik ingests
package names straight from the public npm registry, where anyone can publish a
name containing a quote — `'}) DETACH DELETE n //` is a legal npm package name.

Everything reaching the database must go through `cy` or `encodeValue` in
`src/lib/hydra/cypher.ts`. Identifiers (labels, relationship types, property
keys) are never interpolated from ingested data; they are validated against an
allowlist and throw otherwise. `src/lib/hydra/cypher.test.ts` covers this with
real attack payloads. **Do not bypass it**, and if you add a query, add a test.

## Status

Done and verified:

- Scaffold, TypeScript strict, typecheck clean, 26 tests passing
- HydraDB client, error taxonomy, Docker compose, probe script
- Cypher escaping layer, hardened and tested against hostile input
- Domain model — entities, relations, boundaries, four-state status
- Graph store — all traversal delegated to HydraDB's native `algo.MSpaths`
- npm registry client, defensive against real-world malformed data
- Live registry data verified (see `docs/decisions.md`)

Not built yet:

- Verification engine (the actual GREEN/RED decision)
- Lockfile ingestion, IAM ingestion
- Change log, timeline, remediation
- Every screen: dashboard, boundaries, graph, timeline, work log, onboarding,
  marketing site, auth, pricing
- Design system

Blocked:

- `npm run hydra:probe` has **never been run against a live server** — Docker was
  not installed. The response-envelope handling in `src/lib/hydra/client.ts`
  (`normalizeResult`) and the `algo.MSpaths` call shape are the last unverified
  assumptions in the stack. **Run the probe first and correct them before
  trusting any query results.**
- Mascot asset not supplied.
