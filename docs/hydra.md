# HydraDB integration

How Tavik uses HydraDB, what HydraDB actually does, and why the schema looks the
way it does.

**Everything here was verified against a running server**, not taken from
HydraDB's published documentation — the two differ substantially, and several
documented forms are refused at parse time. Re-run `npm run hydra:probe` after
any upgrade and correct this file from what it prints. Where docs and probe
disagree, the probe is right.

## What HydraDB is

A graph database written in Rust that uses S3-compatible object storage as its
durable source of truth, with memory and local SSD as disposable cache. Speaks a
subset of openCypher over a Neo4j-compatible Bolt port and an HTTP JSON API.
Licensed AGPL-3.0.

Tavik uses the HTTP API and runs HydraDB unmodified as a separate service, which
is why Tavik itself can be MIT licensed.

## Connection

```
POST {base}/v1/graphs/{graphId}/query
Authorization: Bearer {token}
X-Graph-Namespace: {namespace}
Content-Type: application/json

{"cell_id": "cell-0", "query": "...", "parameters": { ... }}
```

Ports: Bolt `7687`, HTTP `8443`, admin/metrics `9090`. The server reads its
bearer token from the file at `GRAPH_AUTH_TOKEN_FILE` on its data volume;
`scripts/hydra-setup.mjs` creates it and mirrors the value into `.env.local`.

**The image ships no `curl` or `wget`**, so a container healthcheck is
impossible. Readiness is polled from the host by `scripts/hydra-wait.mjs`, which
is a better signal anyway — it proves the query endpoint answers and
authenticates, not merely that a port is open.

**Read consistency.** `causal` (default) reads the current durable view;
`strong` refreshes from object storage before pinning the query snapshot. Tavik
uses **`strong` for verification**, because a verification is a safety claim and
the re-verification after a remediation must observe the deletion just applied.

## Response envelope

Columnar, with every cell tagged by type:

```json
{
  "query_id": "http-query-91",
  "columns": ["path"],
  "rows": [[ {"type": "path", "value": { ... }} ]],
  "read_epoch": null, "next_cursor": null, "bookmark": "sgk:1:..."
}
```

Scalars appear as `{"type":"string","value":"lodash"}`,
`{"type":"integer","value":4}`, `{"type":"vertex_id","value":501}`. A path is:

```json
{"type":"path","value":{
  "nodes":[{"id":500,"labels":["Entity"],
            "properties":{"urn":{"String":"tavik:service:checkout"}}}],
  "relationships":[{"id":4,"edge_type":"SUPPLIES","src":500,"dst":501,"properties":{}}]
}}
```

Note the double wrapping: cells are `{type,value}`, and node/edge *properties*
are separately tagged (`{"String": ...}`). `unwrapCell` in `client.ts` handles
both. Getting this wrong yields empty results — which Tavik would read as "no
violations", so `normalizeResult` throws on an unrecognised envelope rather than
returning `[]`.

## What HydraDB does for Tavik

1. **Stores the entire security state.** There is no second copy in a relational
   database.
2. **Answers every reachability question.** Tavik never walks edges in
   application code; `algo.MSpaths` resolves many sources against many targets
   inside the database.
3. **Provides the boundary primitive.** Verified when the path query returns
   nothing; violated when it returns a path — and that path *is* the evidence
   rendered in the UI.
4. **Makes remediation real.** Removing a relationship is an edge `DELETE`, and
   re-verification runs the same query against the mutated graph.

Remove HydraDB and there is no product: no state, no reachability, no evidence,
no way to prove restoration.

## Schema

```
(:Entity {
   id,             // integer, derived from urn — REQUIRED by HydraDB for writes
   urn,            // tavik:release:left-pad:1.3.0 — the identity Tavik reasons about
   kind,           // Package | Release | Maintainer | Service | Role | ...
   name, source,   // display name; npm-registry | lockfile | aws-iam | demo
   tag, environment, trust   // the closed set of selector-addressable attributes
 })
-[:SUPPLIES | HAS_RELEASE | MAINTAINS | PUBLISHED | CAN_ASSUME | ...]->
(:Entity)
```

### Why integer ids exist

HydraDB refuses `CREATE` and `MERGE` without an `id` ("CREATE requires source
id"). Tavik's natural key is a URN string, so `node-id.ts` derives a stable
52-bit id from it by FNV-1a hash.

A hash rather than a counter because ingestion must be **idempotent and
resumable** — the same URN must land on the same id from any process, in any
order, without a persisted allocation table or a read before every write. The
cost is collision risk, handled explicitly: `detectCollisions` runs before every
write batch and throws. A collision would merge two unrelated entities and
fabricate paths that do not exist, which is precisely the class of bug this
product cannot ship.

### Why one label, `kind` as a property

`algo.MSpaths` takes a single `sourceLabel` and `sourceProperty` and matches
endpoints by value arrays. A label per entity kind could not express a cross-kind
question — "can any Maintainer reach any Service?" — in one native call, forcing
a query per kind pair in application code. That is exactly the client-side
fan-out the procedure exists to eliminate.

### Why some relationships are not traversable

`RUNS_IN` and `BUILDS` are excluded from `TRAVERSABLE_RELATIONS`. Traversing
`RUNS_IN` would connect every production service to every other through their
shared environment, manufacturing paths that do not exist. A correctness
decision, not an optimisation; boundary validation rejects anything outside the
set.

## The accepted Cypher subset

The running server accepts far less than the docs describe. Verified forms:

| Operation | Working form |
| --- | --- |
| Node upsert | `UNWIND $rows AS row MERGE (n {id: row.id}) SET n:Entity, n.urn = row.urn, ...` |
| Edge batch | `UNWIND $rows AS row CREATE (a {id: row.from})-[:TYPE]->(b {id: row.to})` |
| Edge with properties | `CREATE (a {id: 1})-[:T {k: v}]->(b {id: 2})` (single, not batched) |
| Delete edge | `MATCH (a {id: $from})-[r:TYPE]->(b {id: $to}) DELETE r` |
| Read | `MATCH (n:Entity {id: X}) RETURN n.urn AS urn` |
| Count | `MATCH (n:Entity) RETURN count(*) AS total` |
| Traversal | `MATCH (a {id: X})-[:TYPE*1..6]->(b) RETURN b.urn AS urn` |
| Paths | `CALL algo.MSpaths({...}) YIELD path RETURN path` |

Rejected at parse time, each of which shaped the code above:

| Rejected | Consequence |
| --- | --- |
| Bare `RETURN 1` | Liveness uses `MATCH (n:Entity) RETURN count(*)` |
| `CREATE`/`MERGE` without an id | Every node needs a derived integer id |
| Multi-hop `CREATE` | One edge per statement |
| A label inside a `MERGE` pattern | Label applied afterwards with `SET n:Entity` |
| `UNWIND ... MERGE` for edges | Edges use `CREATE`; duplicates are possible across re-ingestions, so `deleteRelation` removes all matching edges |
| Edge properties in a batch | Batched edges carry no properties |
| `id(n)` in `RETURN` | `RETURN` supports only `<binding>.<property>` and `count(*)` |
| Variable-length MATCH without a fixed source id | Reachability goes through `algo.MSpaths` |
| Patterns with zero or several relationship types | Writes are grouped by type — though `algo.MSpaths` *does* accept several `relTypes` |
| `MATCH (n)` with no predicate | `clear()` matches on the `Entity` label |
| `IN`, `CONTAINS`, `IS NULL` in `WHERE` | Selectors are equality-only; set membership goes to `MSpaths` |
| More than one statement per request | No transaction spans calls |

## Parameters, and the one place escaping is still required

**HydraDB does support query parameters**, via the `parameters` body field —
contrary to its documentation. `$name` works in `WHERE`, as a property value, and
as `UNWIND` input. Tavik uses parameters everywhere it can, which is the primary
injection defence: values travel as data rather than as query text.

**One exception.** A composite (array) parameter is accepted *only* as an
`UNWIND` input — `sourceValues: $sourceValues` inside a procedure config map is
refused. So `buildPathQuery` must inline the endpoint URN lists into the query
text, and URNs embed npm package names, which anyone can publish. `'}) DETACH
DELETE n //` is a legal npm package name.

That is why `src/lib/hydra/cypher.ts` exists. Both lists go through
`encodeValue`, which emits pure-ASCII single-quoted literals escaping quotes,
backslashes, newlines, control characters and bidirectional overrides.
Identifiers (labels, relationship types) are validated against an allowlist and
**throw** rather than being escaped, because an identifier needing escapes means
a bug upstream. `cypher.test.ts` covers this with real payloads.

## Temporal support

The brief assumed HydraDB could answer "was this path valid at time T". It
cannot. Rather than pretend otherwise:

- The live graph holds only currently-valid edges.
- An append-only change log records every edge appearance and disappearance with
  a timestamp and its originating ingestion.
- Point-in-time verification replays that log into a snapshot subgraph and runs
  *the identical* `algo.MSpaths` call against it.

A genuine re-computation of the past, not a cached verdict — and honest about
where the capability comes from.

## Verification

`src/lib/engine/verify.integration.test.ts` runs the full loop against a live
server: upsert entities, write typed edges, confirm `algo.MSpaths` finds the
Maintainer→Package→Release→Service path, delete one edge, and confirm the
identical query then returns nothing. It skips automatically when HydraDB is not
running, so the suite stays green without Docker.
