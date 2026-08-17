/**
 * Tavik's security state model.
 *
 * The whole product rests on one idea: a security boundary is a claim about
 * *reachability* in a graph, and it stops being true the moment an edge appears
 * that connects the two sides. So the model is deliberately small — entities and
 * the ways they can reach one another — rather than a general-purpose asset
 * inventory.
 *
 * Two domains share this model, which is the point: the verification engine does
 * not know or care which one it is looking at.
 *
 *   Supply chain — services, package releases, maintainers. "No production
 *   service may depend on a release from an untrusted publisher."
 *
 *   Cloud IAM — CI jobs, roles, datastores. "Production customer data must
 *   never be reachable from CI."
 */

/**
 * Entity kinds.
 *
 * These are stored as a `kind` *property*, not as Cypher labels. Every node
 * carries the single label `Entity`.
 *
 * That is not a stylistic choice — it is forced by HydraDB's batch path
 * procedure. `algo.MSpaths` accepts one `sourceLabel` and one `sourceProperty`
 * and matches endpoints by arrays of values. A label-per-kind schema could not
 * express "any of these services can reach any of these releases" in a single
 * native call, and Tavik would have to fan out one query per kind pair in
 * application code — exactly the client-side fan-out that procedure exists to
 * avoid. One label keeps the whole reachability question inside the database.
 */
export const ENTITY_KINDS = [
  // ── Supply chain ──────────────────────────────────────────────────────────
  /** An npm package name, independent of version. */
  "Package",
  /** One published version of a package. Dependencies resolve to releases. */
  "Release",
  /** An npm account that can publish. The real blast radius of a token theft. */
  "Maintainer",
  /** A source repository backing a package. */
  "Repository",

  // ── Things we own and protect ─────────────────────────────────────────────
  /** A first-party service or application. */
  "Service",
  /** A deployment environment, e.g. production. */
  "Environment",

  // ── Cloud IAM ─────────────────────────────────────────────────────────────
  /** A CI/CD job or pipeline identity. */
  "CiJob",
  /** An IAM role that can be assumed. */
  "Role",
  /** A database, bucket, or other data store. */
  "Datastore",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * Relationship types.
 *
 * Every one is directed, and the direction is **the direction influence travels**
 * — from the party who can cause a change, toward the thing that would be
 * affected by it. Not "who imports whom".
 *
 * This matters more than it looks. A supply-chain compromise flows *into* your
 * service: a publisher pushes a version, the version enters a package, the
 * package is consumed by a dependent, and eventually by your service. Modelling
 * edges that way turns the security question into a single-direction
 * reachability query — "can this publisher reach production?" — which HydraDB
 * answers natively in one call.
 *
 * Modelling them the intuitive way instead (service DEPENDS_ON package) would
 * force a boundary to traverse some edges forwards and others backwards, which
 * HydraDB cannot express: undirected patterns are rejected at parse time, and
 * mixing directions in one traversal would also invent paths that do not
 * correspond to any real influence.
 */
export const RELATION_KINDS = [
  // ── Supply chain, in influence order ──────────────────────────────────────
  /**
   * Dependency → dependent. The inverse of how a lockfile reads.
   * `left-pad@1.3.0 SUPPLIES checkout-api` means left-pad's code runs inside
   * checkout-api, so whoever controls left-pad can affect checkout-api.
   */
  "SUPPLIES",
  /** Package→Release. A package is the surface through which releases appear. */
  "HAS_RELEASE",
  /**
   * Maintainer→Package. Publish rights.
   * This is the edge that makes account compromise a supply-chain event: it is a
   * path to every *future* release, not only the ones that exist today.
   */
  "MAINTAINS",
  /** Maintainer→Release. Who actually pushed this specific artifact. */
  "PUBLISHED",
  /** Repository→Package. Source that produces the published artifact. */
  "BUILDS",

  // ── Ownership ─────────────────────────────────────────────────────────────
  /** Service→Environment. Descriptive, not a capability. */
  "RUNS_IN",

  // ── Cloud IAM ─────────────────────────────────────────────────────────────
  /** Identity→Role, via an sts:AssumeRole trust policy. */
  "CAN_ASSUME",
  /** Role→Datastore, via an allow statement on a data action. */
  "CAN_ACCESS",
  /** CiJob→Role. The identity a pipeline executes as. */
  "RUNS_AS",
] as const;

export type RelationKind = (typeof RELATION_KINDS)[number];

/**
 * Relationship types along which influence can actually travel — the edges a
 * reachability question is allowed to traverse.
 *
 * `RUNS_IN` is descriptive: a service belonging to an environment does not let
 * anything flow through it, and traversing it would connect every service in
 * production to every other, manufacturing paths that do not exist. `BUILDS` is
 * excluded for now because Tavik does not yet verify that a published artifact
 * actually came from the repository it claims.
 *
 * Excluding these is a correctness decision, not an optimisation. Boundary
 * validation rejects anything outside this set.
 */
export const TRAVERSABLE_RELATIONS: readonly RelationKind[] = [
  "SUPPLIES",
  "HAS_RELEASE",
  "MAINTAINS",
  "PUBLISHED",
  "CAN_ASSUME",
  "CAN_ACCESS",
  "RUNS_AS",
];

/**
 * Stable identity for a node.
 *
 * Uses a natural key rather than a generated id so that re-ingesting the same
 * registry data converges instead of duplicating: `MERGE` on `urn` is
 * idempotent. Format is `tavik:<kind>:<scoped-name>`.
 */
export type EntityUrn = string & { readonly __brand: "EntityUrn" };

export function entityUrn(kind: EntityKind, ...parts: string[]): EntityUrn {
  const scoped = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(":");
  return `tavik:${kind.toLowerCase()}:${scoped}` as EntityUrn;
}

/** A node in the security state graph. */
export interface Entity {
  readonly urn: EntityUrn;
  readonly kind: EntityKind;
  /** Human-facing name, e.g. `lodash`, `checkout-api`, `arn:aws:iam::…:role/deploy`. */
  readonly name: string;
  /** Short label for graph rendering, where `name` may be too long. */
  readonly displayName?: string;
  /**
   * Provenance: which ingestion produced this. Rendered in the UI so a viewer
   * can always tell real registry data from demo-environment data.
   */
  readonly source: EntitySource;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Where a piece of state came from.
 *
 * Shown in the UI wherever data is displayed. Tavik never presents demo data as
 * though it were live infrastructure.
 */
export type EntitySource =
  /** Fetched from the live public npm registry. */
  | "npm-registry"
  /** Read from a first-party lockfile in this repository. */
  | "lockfile"
  /** Read from AWS IAM policy documents. */
  | "aws-iam"
  /** Authored fixture for the labelled demo environment. */
  | "demo";

/** A directed edge in the security state graph. */
export interface Relation {
  readonly from: EntityUrn;
  readonly to: EntityUrn;
  readonly kind: RelationKind;
  readonly source: EntitySource;
  /**
   * When this relationship became true, in epoch milliseconds.
   *
   * HydraDB has no native temporal support, so validity is carried as an edge
   * property and history is reconstructed from the change log rather than
   * queried directly. See docs/hydra.md for why traversal cannot filter on this
   * and what Tavik does instead.
   */
  readonly observedAt: number;
  /** Free-form evidence, e.g. the lockfile path or the IAM statement id. */
  readonly evidence?: string;
}

/** One hop in a reachability path. */
export interface PathHop {
  readonly from: Entity;
  readonly relation: RelationKind;
  readonly to: Entity;
}

/**
 * A concrete route from a source to a target.
 *
 * This is Tavik's unit of evidence. A violation is never reported as a score or
 * a severity — it is reported as a specific sequence of relationships that a
 * human can go and verify.
 */
export interface ReachabilityPath {
  readonly hops: readonly PathHop[];
  readonly length: number;
}

export function isEntityKind(value: string): value is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(value);
}

export function isRelationKind(value: string): value is RelationKind {
  return (RELATION_KINDS as readonly string[]).includes(value);
}
