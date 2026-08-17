# Decision log

Why Tavik is built the way it is. Includes decisions that were **reversed**,
because the reasoning that overturned them is the part worth keeping.

Dates are the date the decision was made.

---

## D1 — Target Track 02A (supply chain), not cloud IAM
**2026-08-16**

The product brief described continuous verification of *cloud IAM* boundaries
("production customer data must never be reachable from CI"). Hack Hydra's
Track 02 asks about **dependency and code graphs**: supply chain blast radius, or
code graphs for IDE assistants.

Judging is explicitly "within your track first, then across the three
finalists." A submission that answers a different question than the track's
problem statement is compared against submissions that answered it directly.

**Decision:** supply chain becomes the primary demo and the submission; cloud IAM
ships as a second boundary type.

**Why this is not a retreat.** Tavik's thesis — declare an invariant, prove it
continuously over a changing graph — is a sharper framing of Track 02A than the
track's own. And a verifier that works across two unrelated domains is a stronger
claim than one that works over a single graph. The engine is domain-neutral by
construction; only the ingestion adapters differ.

**Bonus:** npm registry data is public, free, and real, which satisfies the
brief's "no fake security data" rule with no credentials and no spend.

---

## D2 — One node label, `kind` as a property
**2026-08-16**

Forced by the API, not chosen for style. `algo.MSpaths` takes a single
`sourceLabel` and `sourceProperty` and matches endpoints by value arrays. A
label-per-kind schema cannot express a cross-kind reachability question in one
native call, so Tavik would fan out a query per kind pair in application code —
the exact client-side fan-out the procedure exists to eliminate.

See `docs/hydra.md`.

---

## D3 — Cypher escaping is a security control, not plumbing
**2026-08-16**

HydraDB has no query parameter binding. Tavik ingests package names directly from
the public npm registry, where anyone can publish any name; `'}) DETACH DELETE n
//` is a legal npm package name.

**Decision:** a single mandatory encoding layer (`src/lib/hydra/cypher.ts`) with
adversarial tests, written **before** any ingestion code. Identifiers throw
rather than escape. 26 tests cover quote-breakout, comment injection, control
characters, and bidirectional overrides.

Written first deliberately: for a product whose whole value is "the graph tells
you the truth", silent graph corruption is the one unshippable bug.

---

## D4 — REVERSED: replay a historical malicious package
**2026-08-16 — decided, then overturned the same day**

**Original plan:** make the compromise event real by ingesting a documented
historical incident — `event-stream@3.3.6` pulling in `flatmap-stream@0.1.1`
(2018). Public record, verifiable, no accusation invented.

**What killed it:** verified against the live registry before building on it.
`event-stream@3.3.6` **no longer resolves** — npm removed the malicious versions.
Only the `time` entry survives, showing a 2018-09-09 publish. `flatmap-stream` is
reduced to a `0.0.1-security` placeholder with no dependency data.

So the artifacts cannot be ingested. Good for the ecosystem, fatal for the plan.

**Lesson worth keeping:** the fact was verified before code was written on top of
it. Any future scenario resting on specific registry contents must be checked the
same way — see `scripts/` and re-run against the live registry.

---

## D5 — Model the maintainer, not the malicious version
**2026-08-16, replacing D4**

The real lesson of event-stream, and of the 2026 worm-driven npm compromises, is
not "one bad version shipped." It is: **a maintainer account was compromised, so
every package that account can publish to is exposed.**

That is a reachability question over `MAINTAINS` and `PUBLISHED` edges, it is
answerable entirely from currently-available registry data, and it is *explicitly
listed* in Track 02A's problem statement ("Which other packages share maintainers
or infrastructure with it?").

**Verified live before adopting.** Sampling 13 common packages: `sindresorhus`
holds publish rights on 7 of them (`chalk`, `supports-color`, `ansi-styles`,
`strip-ansi`, `ansi-regex`, `wrap-ansi`, `string-width`); `isaacs` on 3
(`lru-cache`, `minipass`, `yallist`). Real dependency edges confirmed alongside.

**The boundary becomes:**

> No production service may depend on a package whose publish rights sit outside
> our trusted publisher set.

---

## D6 — Never describe a real maintainer as compromised
**2026-08-16**

D5 puts real, named, well-respected people into the graph. Calling them
"compromised", "malicious", or "untrusted" would be false and defamatory, and in
a public demo video, reputationally damaging to real individuals.

**Decision:** Tavik states only the capability fact — the account is **not on our
allowlist**. That is exactly what an allowlist means, it is true by construction,
and it is how real supply-chain policy works. The finding is presented as
**publisher concentration risk**, which is a legitimate and standard metric.

**Binding on all UI copy, docs, and the demo video.** The word "compromised" may
be applied to a hypothetical or clearly-labelled demo account, never to a real
one.

---

## D7 — `unknown` is a first-class status
**2026-08-16**

Four states: `verified`, `violated`, `investigating`, `unknown`. If HydraDB
cannot be read, affected boundaries report `unknown` and the failure reason is
surfaced verbatim.

Collapsing `unknown` into `verified` — the tempting default, since both render as
"no violation found" — would mean a database outage silently reports the estate
as safe. That is the worst failure mode this product has, so the error taxonomy
in `src/lib/hydra/errors.ts` exists specifically to keep the distinction.

---

## D8 — MIT licence for Tavik
**2026-08-16**

Hackathon rules require an open-source licence. HydraDB is AGPL-3.0, but Tavik
runs it **unmodified as a separate service** over a network protocol, which does
not make Tavik a derivative work. MIT is therefore available and is the simplest
choice. HydraDB's licence and role are credited in the README as the rules
require.

---

## D10 — Edges point in the direction influence travels, not the direction code imports
**2026-08-16**

Initially the dependency edge was `Service -[:DEPENDS_ON]-> Release`, mirroring
how a lockfile reads. That is the wrong direction for the security question.

A supply-chain compromise flows *into* a service: a publisher pushes a version →
the version appears under a package → the package is consumed by a dependent →
eventually by production. So edges are stored in **influence order**:

```
Maintainer -[:MAINTAINS]->  Package
Package    -[:HAS_RELEASE]-> Release
Release    -[:SUPPLIES]->    Release / Service
```

The boundary then reads as one single-direction question: *can an untrusted
publisher reach production?*

**Why this is forced, not stylistic.** Keeping the intuitive direction would make
a boundary traverse some edge types forwards and others backwards. HydraDB
rejects undirected patterns at parse time, so that query could not be expressed
natively at all — and mixing directions in a single traversal would also
manufacture paths that correspond to no real influence (two services would appear
to "reach" each other through a shared dependency).

`RUNS_IN` and `BUILDS` are deliberately excluded from `TRAVERSABLE_RELATIONS`.
Traversing `RUNS_IN` would connect every production service to every other one
through their shared environment.

---

## D9 — Build in P0→P3 order, do not truncate for the calendar
**2026-08-16**

Offered scope cuts (billing, auth/RBAC, marketing subpages, Slack), the project
owner chose to build the full product. Accepted — with the discipline that work
proceeds in strict priority order (engine → product → company surface) so that
whatever exists at any given moment is *finished* rather than half-scaffolded.

Priority order is P0 core verification, P1 product screens, P2 company surface,
P3 future integrations.
