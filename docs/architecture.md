# How Tavik works, end to end

This describes the whole pipeline — where data comes from, what happens to it,
and what a team actually does with the result.

## The one-sentence version

A team writes down a rule that must never become true. Tavik builds a graph of
what can reach what, asks the database whether that rule is currently violated,
and re-asks every time the world changes — proving the answer with a specific
path rather than a score.

## The pipeline

```
  ┌─ OBSERVE ──────────────────────────────────────────────────────────┐
  │  npm registry (live, public)   package-lock.json (first-party)     │
  │  IAM policy documents          future: k8s, Terraform, GitHub       │
  └────────────────────────────┬───────────────────────────────────────┘
                               │  adapters normalise to Entity + Relation
                               ▼
  ┌─ UNDERSTAND ───────────────────────────────────────────────────────┐
  │  HydraDB: (:Entity {urn, kind, name})-[:REL {observed_at}]->(:Entity)│
  │  One label, kind as a property. Idempotent MERGE on urn.            │
  └────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
  ┌─ VERIFY ───────────────────────────────────────────────────────────┐
  │  For each boundary:                                                 │
  │    1. resolve source selector  → urns   (equality MATCH)            │
  │    2. resolve target selector  → urns                               │
  │    3. CALL algo.MSpaths(sources, targets, relTypes, maxLen)         │
  │  No paths  → GREEN.    Any path → RED, with the path as evidence.   │
  └────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
  ┌─ DETECT & EXPLAIN ─────────────────────────────────────────────────┐
  │  Change log diffs the new state against the old: which edge         │
  │  appeared, when, from which ingestion. That edge is the root cause. │
  └────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
  ┌─ REMEDIATE ────────────────────────────────────────────────────────┐
  │  Propose the specific edge to remove + its blast radius.            │
  │  A human approves. The edge is deleted for real.                    │
  └────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
  ┌─ VERIFY AGAIN ─────────────────────────────────────────────────────┐
  │  Identical query, mutated graph. No paths → GREEN. Restored.        │
  └────────────────────────────────────────────────────────────────────┘
```

The important property: **step 3 and the final step are the same code path.**
Restoration is proven the same way the original claim was, not asserted.

## Where the data actually comes from

| Source | Real? | What it provides |
| --- | --- | --- |
| npm registry (`registry.npmjs.org`) | Live, public, no credentials | Packages, versions, dependency ranges, maintainer accounts, publish times |
| `package-lock.json` in this repo | First-party, real | Which packages a service actually resolved to |
| IAM policy documents | Real policy JSON | Roles, trust relationships, data access grants |
| Demo environment | Labelled fixtures | A scripted scenario, through the same pipeline |

Every entity carries a `source` field, and the UI shows it. A viewer can always
tell live registry data from demo data. Tavik never presents one as the other.

## Why the graph is the right shape

The question "which of my services are exposed?" is a **transitive reverse
reachability** question. It is not a similarity question, so a vector database
cannot answer it at all, and in SQL it is a recursive join whose cost grows badly
with depth.

Concretely, the supply-chain boundary asks:

> Is there any path, of length ≤ N, from any production service to any package
> that an untrusted publisher can push to?

In HydraDB that is one call:

```cypher
CALL algo.MSpaths({
  sourceLabel: 'Entity', sourceProperty: 'urn',
  sourceValues: [ ...production services... ],
  targetValues: [ ...packages reachable by untrusted publishers... ],
  pairwise: false,
  relTypes: ['DEPENDS_ON', 'MAINTAINS', 'PUBLISHED'],
  relDirection: 'outgoing',
  maxLen: 8, pathCount: 25, resultLimit: 25
})
```

`pairwise: false` is the semantics a boundary needs: violated if *any* source
reaches *any* target. The database resolves the whole cross-product internally
rather than the application issuing one query per pair.

## What a team actually does with it

### Setting up, once

1. **Create a workspace**, connect an environment. Read-only access only.
2. **Tavik builds the security state** — a visible progress sequence, because
   this is the moment the product earns trust: mapping identities, resolving
   dependencies, building state, checking boundaries.
3. **Declare the first boundary** in plain language: *"Production customer data
   must never be reachable from CI."* Tavik turns that into a source selector, a
   target selector, and a set of traversable relationships. An LLM may help with
   the translation; it never decides the answer.

### Day to day — nobody opens the app

This is the point. Tavik is the eleventh engineer: it works whether or not
anyone is looking.

- Ingestion re-runs on a schedule and on webhook events.
- Every boundary is re-verified against the new state.
- If everything holds, nothing happens. **Silence is the product working.**

### When a boundary breaks

The team's first contact is a notification, not a dashboard:

> **SECURITY BOUNDARY VIOLATED — Production Isolation**
> Production customer data is now reachable from CI.
> Cause: new trust relationship introduced by deployment #8472.
> Path: CI → Deploy Role → Prod Role → Customer DB

Then, in the app:

| Screen | The question it answers |
| --- | --- |
| Boundary detail | What broke, and what is the exact path? |
| Timeline | When did it break, and what changed at that moment? |
| Graph | Show me only the violating path, not the whole estate |
| Blast radius | What else is affected? |
| Remediation | What single change restores this, and what does it break? |
| Work log | What did Tavik actually do, second by second? |

### Who uses which part

- **Security engineer** — owns boundaries. Lives in boundary detail and the
  graph. Wants evidence, not severity scores.
- **Platform / infra engineer** — receives the violation their deployment caused.
  Wants the root-cause edge and the smallest fix.
- **Engineering manager / CTO** — wants one number: how many boundaries hold.
- **Auditor** — wants history: what was true when, who approved which change.
  This is why the change log is append-only.

### The approval step is deliberate friction

Tavik proposes; a human approves; then the change is applied. Every remediation
shows its impact before it runs, because "remove this trust relationship" may
legitimately break a deployment pipeline. Automating that away would make the
product untrustworthy in exactly the situations it exists for.

## Temporal verification

The brief asks: *"was this boundary true at 09:00?"*

HydraDB has no time-travel querying (verified — see `docs/decisions.md`). So:

- The **live graph** holds only currently-valid relationships. All verification
  runs against it, natively.
- The **change log** is append-only: every ingestion and mutation records which
  edges appeared and disappeared, when, and from which source.
- **Point-in-time verification** replays the change log into a snapshot subgraph
  and runs *the identical procedure* against it.

That last point is the strongest thing in the product: the same deterministic
verifier, pointed at the past. Not a cached result — a re-computation.

## What is deliberately not automated

- Deciding whether a path exists. Deterministic, always.
- Applying a remediation without approval.
- Assigning severity. A boundary holds or it does not.
