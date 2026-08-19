import { parse as parseYaml } from "yaml";

import type { LockedPackage, LockfileGraph } from "../lockfile";
import { isValidPackageName } from "../npm-registry";

/**
 * Reading `yarn.lock`.
 *
 * Two incompatible formats share the name. Yarn v1 ("classic") uses a bespoke
 * indented syntax that predates the project settling on YAML; Yarn 2+ ("berry")
 * uses real YAML. Both are common in the wild, so both are handled.
 *
 * Neither records an install *tree* the way npm's lockfile does — there are no
 * nested `node_modules` paths, because Yarn hoists into a flat store. So the
 * graph produced here is flat: every resolved package is a top-level entry, and
 * dependency edges come from each entry's own `dependencies` block rather than
 * from a directory layout.
 *
 * That is a real difference and worth being honest about: with npm, Tavik knows
 * *which copy* of a package a given dependent resolved to. With Yarn it knows
 * the set of resolved versions and who depends on what, which is enough to
 * answer "who can reach this project" but not "which nested copy did this one
 * get".
 */

export function parseYarnLock(contents: string): LockfileGraph {
  const berry = /^__metadata:/m.test(contents);
  const packages = berry ? parseBerry(contents) : parseClassic(contents);

  return buildGraph(packages);
}

interface Resolved {
  readonly name: string;
  readonly version: string;
  readonly dependencies: Record<string, string>;
}

/**
 * Yarn 1: entries are `specifier(s):` followed by an indented block.
 *
 *   lodash@^4.17.0, lodash@^4.17.21:
 *     version "4.17.21"
 *     dependencies:
 *       other "^1.0.0"
 */
function parseClassic(contents: string): Resolved[] {
  const resolved: Resolved[] = [];
  const blocks = contents.split(/\n(?=[^\s#])/);

  for (const block of blocks) {
    const lines = block.split("\n");
    const header = lines[0];
    if (!header || header.startsWith("#")) continue;

    const version = /^\s+version\s+"?([^"\s]+)"?/m.exec(block)?.[1];
    if (!version) continue;

    // The header lists every specifier that resolved here; the package name is
    // the part before the last `@`, which also handles scoped names.
    const firstSpecifier = header.replace(/:$/, "").split(",")[0].trim().replace(/^"|"$/g, "");
    const name = nameFromSpecifier(firstSpecifier);
    if (!name || !isValidPackageName(name)) continue;

    resolved.push({ name, version, dependencies: parseDependencyBlock(block) });
  }

  return resolved;
}

/**
 * Yarn 2+: YAML, keyed by `name@npm:range`, with a `resolution` field.
 */
function parseBerry(contents: string): Resolved[] {
  const resolved: Resolved[] = [];

  let doc: Record<string, unknown>;
  try {
    doc = parseYaml(contents) as Record<string, unknown>;
  } catch {
    return resolved;
  }

  for (const [key, value] of Object.entries(doc)) {
    if (key === "__metadata" || typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;

    const version = typeof entry.version === "string" ? entry.version : null;
    if (!version) continue;

    // `resolution: "lodash@npm:4.17.21"` is the authoritative identity.
    const resolution = typeof entry.resolution === "string" ? entry.resolution : key;
    const name = nameFromSpecifier(resolution.split(",")[0].trim());
    if (!name || !isValidPackageName(name)) continue;

    const dependencies: Record<string, string> = {};
    if (typeof entry.dependencies === "object" && entry.dependencies !== null) {
      for (const [dep, range] of Object.entries(entry.dependencies as Record<string, unknown>)) {
        if (isValidPackageName(dep)) dependencies[dep] = String(range);
      }
    }

    resolved.push({ name, version, dependencies });
  }

  return resolved;
}

/**
 * `lodash@^4.17.0` → `lodash`, `@babel/core@^7.0.0` → `@babel/core`,
 * `pkg@npm:1.2.3` → `pkg`.
 *
 * Split on the last `@` so a scope's leading `@` is never mistaken for the
 * version separator.
 */
function nameFromSpecifier(specifier: string): string | null {
  const cleaned = specifier.replace(/^"|"$/g, "");
  const at = cleaned.lastIndexOf("@");
  if (at <= 0) return cleaned.length > 0 ? cleaned : null;
  return cleaned.slice(0, at);
}

/** Pull the indented `dependencies:` block out of a classic entry. */
function parseDependencyBlock(block: string): Record<string, string> {
  const dependencies: Record<string, string> = {};
  const section = /\n\s+dependencies:\n((?:\s{4,}.+\n?)+)/.exec(block)?.[1];
  if (!section) return dependencies;

  for (const line of section.split("\n")) {
    const match = /^\s+"?([^"\s]+)"?\s+"?([^"]+)"?\s*$/.exec(line);
    if (!match) continue;
    const [, name, range] = match;
    if (isValidPackageName(name)) dependencies[name] = range.trim();
  }
  return dependencies;
}

/**
 * Assemble the flat graph.
 *
 * Yarn's store is flat, so each resolved package becomes a top-level entry and
 * a dependency resolves by name to whichever version was installed. Where a
 * name resolved to several versions the highest is chosen, which is a genuine
 * approximation — recorded here rather than hidden, since it affects which
 * version an edge points at.
 */
function buildGraph(resolved: readonly Resolved[]): LockfileGraph {
  const byName = new Map<string, Resolved>();
  for (const entry of resolved) {
    const existing = byName.get(entry.name);
    if (!existing || compareVersions(entry.version, existing.version) > 0) {
      byName.set(entry.name, entry);
    }
  }

  const packages: LockedPackage[] = [
    {
      path: "",
      name: "project",
      version: "0.0.0",
      dependencies: {},
      dev: false,
    },
    ...[...byName.values()].map((entry) => ({
      path: `node_modules/${entry.name}`,
      name: entry.name,
      version: entry.version,
      dependencies: entry.dependencies,
      dev: false,
    })),
  ];

  const available = new Set(packages.map((pkg) => pkg.path));
  const edges: { from: string; to: string }[] = [];
  const unresolved: { from: string; name: string }[] = [];

  // The root depends on everything: a flat lockfile does not say which packages
  // were direct dependencies, and treating them all as reachable from the
  // project is the safe reading — it can only over-report reachability, never
  // miss a route.
  for (const pkg of packages) {
    if (pkg.path === "") continue;
    edges.push({ from: "", to: pkg.path });

    for (const dependency of Object.keys(pkg.dependencies)) {
      const target = `node_modules/${dependency}`;
      if (available.has(target)) edges.push({ from: pkg.path, to: target });
      else unresolved.push({ from: pkg.path, name: dependency });
    }
  }

  return { projectName: "project", packages, edges, unresolved };
}

/** Loose semver ordering. Good enough to pick the highest of several. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((p) => Number.parseInt(p, 10));
  const pb = b.split(/[.\-+]/).map((p) => Number.parseInt(p, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x - y;
  }
  return 0;
}
