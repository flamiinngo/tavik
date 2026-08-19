import { parse as parseYaml } from "yaml";

import type { LockedPackage, LockfileGraph } from "../lockfile";
import { isValidPackageName } from "../npm-registry";

/**
 * Reading `pnpm-lock.yaml`.
 *
 * pnpm keys its `packages` map by an identifier that has changed shape across
 * lockfile versions — `/lodash/4.17.21`, then `/lodash@4.17.21`, then
 * `lodash@4.17.21` — sometimes with a peer-dependency suffix in brackets. All
 * of these appear in real repositories depending on when the lockfile was last
 * regenerated, so the key parser handles each rather than assuming the current
 * one.
 *
 * Like Yarn, pnpm's store is flat, so the resulting graph is flat: the set of
 * resolved versions and who depends on what, rather than which nested copy a
 * given dependent resolved to.
 */

export function parsePnpmLock(contents: string): LockfileGraph {
  let doc: Record<string, unknown>;
  try {
    doc = parseYaml(contents) as Record<string, unknown>;
  } catch {
    return emptyGraph();
  }

  const rawPackages = doc.packages;
  const snapshots = doc.snapshots; // lockfile v9 splits metadata from the tree
  const source =
    typeof snapshots === "object" && snapshots !== null && Object.keys(snapshots).length > 0
      ? (snapshots as Record<string, unknown>)
      : typeof rawPackages === "object" && rawPackages !== null
        ? (rawPackages as Record<string, unknown>)
        : null;

  if (!source) return emptyGraph();

  const packages: LockedPackage[] = [
    { path: "", name: "project", version: "0.0.0", dependencies: {}, dev: false },
  ];
  const seen = new Set<string>();

  for (const [key, value] of Object.entries(source)) {
    const parsed = parseKey(key);
    if (!parsed) continue;
    if (seen.has(parsed.name)) continue;
    seen.add(parsed.name);

    const entry = (typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}) as Record<string, unknown>;

    packages.push({
      path: `node_modules/${parsed.name}`,
      name: parsed.name,
      version: parsed.version,
      dependencies: readDependencies(entry.dependencies),
      dev: entry.dev === true,
    });
  }

  const available = new Set(packages.map((pkg) => pkg.path));
  const edges: { from: string; to: string }[] = [];
  const unresolved: { from: string; name: string }[] = [];

  for (const pkg of packages) {
    if (pkg.path === "") continue;
    // Flat store: treat everything as reachable from the project. This can only
    // over-report reachability, never miss a route.
    edges.push({ from: "", to: pkg.path });

    for (const dependency of Object.keys(pkg.dependencies)) {
      const target = `node_modules/${dependency}`;
      if (available.has(target)) edges.push({ from: pkg.path, to: target });
      else unresolved.push({ from: pkg.path, name: dependency });
    }
  }

  return { projectName: "project", packages, edges, unresolved };
}

/**
 * Handle every key shape pnpm has used.
 *
 *   /lodash/4.17.21
 *   /lodash@4.17.21
 *   lodash@4.17.21
 *   /@babel/core@7.23.0
 *   /react-dom@18.2.0(react@18.2.0)     ← peer suffix, discarded
 */
function parseKey(key: string): { name: string; version: string } | null {
  // Drop any peer-dependency suffix before anything else.
  let cleaned = key.replace(/\(.*\)$/, "");
  if (cleaned.startsWith("/")) cleaned = cleaned.slice(1);
  if (cleaned.length === 0) return null;

  // Modern: name@version, where a scope's leading @ must not be mistaken for
  // the separator.
  const at = cleaned.lastIndexOf("@");
  if (at > 0) {
    const name = cleaned.slice(0, at);
    const version = cleaned.slice(at + 1);
    if (isValidPackageName(name) && /^\d/.test(version)) return { name, version };
  }

  // Legacy: name/version, with scoped names spanning two segments.
  const segments = cleaned.split("/");
  if (segments.length >= 2) {
    const version = segments[segments.length - 1];
    const name = segments.slice(0, -1).join("/");
    if (isValidPackageName(name) && /^\d/.test(version)) return { name, version };
  }

  return null;
}

function readDependencies(raw: unknown): Record<string, string> {
  const dependencies: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null) return dependencies;
  for (const [name, range] of Object.entries(raw as Record<string, unknown>)) {
    if (isValidPackageName(name)) dependencies[name] = String(range);
  }
  return dependencies;
}

function emptyGraph(): LockfileGraph {
  return {
    projectName: "project",
    packages: [{ path: "", name: "project", version: "0.0.0", dependencies: {}, dev: false }],
    edges: [],
    unresolved: [],
  };
}
