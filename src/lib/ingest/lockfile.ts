/**
 * npm lockfile ingestion.
 *
 * A lockfile is the highest-quality supply-chain data a team has: it records the
 * versions that were *actually resolved*, not the ranges that were requested.
 * Track 02A's question — "which applications resolved the compromised version
 * while it was live?" — is answerable only from lockfiles.
 *
 * This parses `package-lock.json` v2/v3, where the `packages` map is keyed by
 * install path. Resolving an edge means reproducing npm's own lookup: from the
 * dependent's directory, walk up through parent `node_modules` until the
 * dependency is found. Getting that wrong would silently attach edges to the
 * wrong version and quietly corrupt every reachability answer, so it is
 * implemented properly rather than by name-matching.
 */

import {
  type Entity,
  type EntityUrn,
  type Relation,
  entityUrn,
} from "@/lib/domain/entities";
import { isValidPackageName } from "./npm-registry";

export class LockfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockfileError";
  }
}

/** One resolved package in the dependency tree. */
export interface LockedPackage {
  /** Install path, e.g. `node_modules/semver`. Empty string is the root project. */
  readonly path: string;
  readonly name: string;
  readonly version: string;
  /** Requested ranges, name → range. */
  readonly dependencies: Readonly<Record<string, string>>;
  /** True when only reachable through devDependencies. */
  readonly dev: boolean;
  readonly integrity?: string;
  readonly resolved?: string;
}

export interface LockfileGraph {
  readonly projectName: string;
  readonly packages: readonly LockedPackage[];
  /** Resolved edges: dependent install path → dependency install path. */
  readonly edges: readonly { readonly from: string; readonly to: string }[];
  /**
   * Dependencies that could not be resolved to an entry in the lockfile.
   * Surfaced rather than dropped: an unresolved edge means Tavik's view of the
   * tree is incomplete, and an incomplete graph can hide a real path.
   */
  readonly unresolved: readonly { readonly from: string; readonly name: string }[];
}

/** Extract the package name from a lockfile install path. */
export function packageNameFromPath(path: string): string | null {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  if (index === -1) return null;
  const name = path.slice(index + marker.length);
  return name.length > 0 ? name : null;
}

/**
 * Resolve a dependency the way Node does: walk up from the dependent's directory
 * checking each ancestor's `node_modules`, nearest first.
 *
 * For a dependent at `node_modules/a/node_modules/b` requiring `c`, the
 * candidates in order are:
 *   node_modules/a/node_modules/b/node_modules/c   (nested inside the dependent)
 *   node_modules/a/node_modules/c                  (a sibling)
 *   node_modules/c                                 (hoisted to the root)
 */
export function resolveDependencyPath(
  dependentPath: string,
  dependencyName: string,
  available: ReadonlySet<string>,
): string | null {
  const nested = dependentPath === ""
    ? `node_modules/${dependencyName}`
    : `${dependentPath}/node_modules/${dependencyName}`;
  if (available.has(nested)) return nested;

  // Walk up one `node_modules` boundary at a time.
  let scope = dependentPath;
  while (scope.length > 0) {
    const marker = scope.lastIndexOf("/node_modules/");
    if (marker === -1) {
      scope = "";
    } else {
      scope = scope.slice(0, marker);
    }
    const candidate = scope === ""
      ? `node_modules/${dependencyName}`
      : `${scope}/node_modules/${dependencyName}`;
    if (available.has(candidate)) return candidate;
  }

  return null;
}

export function parseLockfile(raw: unknown): LockfileGraph {
  if (typeof raw !== "object" || raw === null) {
    throw new LockfileError("Lockfile is not a JSON object.");
  }
  const doc = raw as Record<string, unknown>;

  const version = doc.lockfileVersion;
  if (version !== 2 && version !== 3) {
    throw new LockfileError(
      `Unsupported lockfileVersion ${String(version)}. Tavik reads v2 and v3, ` +
        `which carry the resolved install tree. v1 does not.`,
    );
  }

  const rawPackages = doc.packages;
  if (typeof rawPackages !== "object" || rawPackages === null) {
    throw new LockfileError("Lockfile has no `packages` map.");
  }

  const packages: LockedPackage[] = [];
  let projectName = "unknown-project";

  for (const [path, value] of Object.entries(rawPackages as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;

    if (path === "") {
      if (typeof entry.name === "string") projectName = entry.name;
      packages.push({
        path: "",
        name: projectName,
        version: typeof entry.version === "string" ? entry.version : "0.0.0",
        dependencies: mergeDependencyRanges(entry),
        dev: false,
      });
      continue;
    }

    const name =
      typeof entry.name === "string" ? entry.name : packageNameFromPath(path);
    const packageVersion = entry.version;
    if (!name || !isValidPackageName(name) || typeof packageVersion !== "string") {
      continue;
    }

    packages.push({
      path,
      name,
      version: packageVersion,
      dependencies: readRanges(entry.dependencies),
      dev: entry.dev === true,
      integrity: typeof entry.integrity === "string" ? entry.integrity : undefined,
      resolved: typeof entry.resolved === "string" ? entry.resolved : undefined,
    });
  }

  const available = new Set(packages.map((pkg) => pkg.path));
  const edges: { from: string; to: string }[] = [];
  const unresolved: { from: string; name: string }[] = [];

  for (const pkg of packages) {
    for (const dependencyName of Object.keys(pkg.dependencies)) {
      const target = resolveDependencyPath(pkg.path, dependencyName, available);
      if (target === null) {
        unresolved.push({ from: pkg.path, name: dependencyName });
      } else {
        edges.push({ from: pkg.path, to: target });
      }
    }
  }

  return { projectName, packages, edges, unresolved };
}

/**
 * The root entry lists prod and dev dependencies separately. Both are ingested:
 * a compromised dev dependency still executes on developer machines and in CI,
 * which is exactly how several real supply-chain attacks propagated. Whether a
 * given boundary cares is a matter for the boundary's selectors, not for
 * ingestion to decide by dropping data.
 */
function mergeDependencyRanges(entry: Record<string, unknown>): Record<string, string> {
  return {
    ...readRanges(entry.dependencies),
    ...readRanges(entry.devDependencies),
    ...readRanges(entry.optionalDependencies),
  };
}

function readRanges(raw: unknown): Record<string, string> {
  const ranges: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ranges;
  for (const [name, range] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof range === "string" && isValidPackageName(name)) {
      ranges[name] = range;
    }
  }
  return ranges;
}

// ── Projection into the security state graph ────────────────────────────────

export interface LockfileProjection {
  readonly entities: readonly Entity[];
  readonly relations: readonly Relation[];
  readonly serviceUrn: EntityUrn;
}

/**
 * Project a parsed lockfile into entities and relations.
 *
 * The root project becomes a `Service` — the thing a boundary protects. Every
 * resolved package becomes a `Release`, which is the correct granularity: a
 * boundary is violated by depending on a specific *version*, not on a package in
 * the abstract.
 */
export function projectLockfile(
  graph: LockfileGraph,
  options: {
    readonly serviceName?: string;
    readonly environment: string;
    readonly observedAt: number;
    readonly lockfilePath: string;
  },
): LockfileProjection {
  const serviceName = options.serviceName ?? graph.projectName;
  const serviceUrn = entityUrn("Service", serviceName);

  const entities: Entity[] = [
    {
      urn: serviceUrn,
      kind: "Service",
      name: serviceName,
      source: "lockfile",
      attributes: { environment: options.environment },
    },
  ];

  // Install path → urn, so edges can be mapped without re-deriving identity.
  const urnByPath = new Map<string, EntityUrn>([["", serviceUrn]]);

  for (const pkg of graph.packages) {
    if (pkg.path === "") continue;
    const urn = entityUrn("Release", pkg.name, pkg.version);
    urnByPath.set(pkg.path, urn);
    entities.push({
      urn,
      kind: "Release",
      name: `${pkg.name}@${pkg.version}`,
      displayName: pkg.name,
      source: "lockfile",
      attributes: {
        package: pkg.name,
        version: pkg.version,
        dev: pkg.dev,
        ...(pkg.integrity ? { integrity: pkg.integrity } : {}),
      },
    });
  }

  // Edges are emitted in *influence* direction, which inverts how a lockfile
  // reads. The lockfile says "checkout-api depends on left-pad"; the security
  // model says "left-pad supplies checkout-api", because that is the direction a
  // malicious version would travel. See RELATION_KINDS.
  const relations: Relation[] = [];
  for (const edge of graph.edges) {
    const dependent = urnByPath.get(edge.from);
    const dependency = urnByPath.get(edge.to);
    if (!dependent || !dependency || dependent === dependency) continue;
    relations.push({
      from: dependency,
      to: dependent,
      kind: "SUPPLIES",
      source: "lockfile",
      observedAt: options.observedAt,
      evidence: options.lockfilePath,
    });
  }

  // Deduplicate: the same edge can appear via both prod and dev ranges.
  const seen = new Set<string>();
  const deduped = relations.filter((relation) => {
    const key = `${relation.from}|${relation.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { entities, relations: deduped, serviceUrn };
}
