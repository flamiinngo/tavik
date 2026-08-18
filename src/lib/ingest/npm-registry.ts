/**
 * npm registry client.
 *
 * Reads the live public registry at registry.npmjs.org. No credentials, no
 * mirror, no fixtures: the package names, versions, dependency ranges,
 * maintainer accounts and publish timestamps Tavik reasons about are the real
 * ones, fetched at ingestion time.
 *
 * Everything returned here is untrusted input. Package names, maintainer handles
 * and repository URLs are published by anyone and flow straight into the graph,
 * so they are validated on the way in and encoded on the way to HydraDB (see
 * lib/hydra/cypher.ts). Registry responses are also large and irregular — fields
 * documented as required are routinely missing on old packages — so parsing is
 * defensive throughout and drops malformed records rather than throwing away a
 * whole ingestion run.
 */

const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/**
 * Abbreviated packument. The registry serves a much smaller document under this
 * Accept header, which matters: the full document for a popular package can be
 * tens of megabytes, almost all of it history Tavik does not need.
 */
const ABBREVIATED = "application/vnd.npm.install-v1+json";

/** npm package name rules, per validate-npm-package-name. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly packageName: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

export interface RegistryVersion {
  readonly name: string;
  readonly version: string;
  /** Runtime dependency ranges. Dev dependencies are absent from packuments. */
  readonly dependencies: Readonly<Record<string, string>>;
  readonly integrity?: string;
  readonly deprecated?: string;
}

export interface Packument {
  readonly name: string;
  /** version string → version document. */
  readonly versions: Readonly<Record<string, RegistryVersion>>;
  /** dist-tag → version, e.g. `latest`. */
  readonly distTags: Readonly<Record<string, string>>;
  /** version → ISO publish time, when the registry reports it. */
  readonly publishedAt: Readonly<Record<string, string>>;
  readonly maintainers: readonly string[];
}

export function isValidPackageName(name: string): boolean {
  return (
    name.length > 0 && name.length <= 214 && PACKAGE_NAME.test(name)
  );
}

interface FetchOptions {
  readonly registryUrl?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/**
 * Fetch a packument.
 *
 * The abbreviated document omits `maintainers` and `time`, so a second full
 * request is made only when publisher or timing data is actually needed — that
 * is the difference between a few kilobytes and several megabytes per package.
 */
export async function fetchPackument(
  packageName: string,
  options: FetchOptions & { readonly includeMetadata?: boolean } = {},
): Promise<Packument> {
  if (!isValidPackageName(packageName)) {
    throw new RegistryError(
      `Refusing to fetch ${JSON.stringify(packageName)}: not a valid npm package name.`,
      packageName,
    );
  }

  const registry = options.registryUrl ?? process.env.NPM_REGISTRY_URL ?? DEFAULT_REGISTRY;
  // Scoped names contain a slash that must survive as a path separator, so the
  // scope and name are encoded separately rather than with a single encodeURIComponent.
  const encodedName = packageName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `${registry.replace(/\/+$/, "")}/${encodedName}`;

  const controller = new AbortController();
  // Full packuments for long-lived packages are large — typescript and
  // tailwindcss both exceeded a 20s budget on a normal connection. A dropped
  // package means missing edges, and missing edges mean paths Tavik will never
  // find, so the timeout is generous rather than tight.
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(url, {
      headers: {
        Accept: options.includeMetadata ? "application/json" : ABBREVIATED,
        "User-Agent": "tavik-security-boundary-verifier",
      },
      signal: controller.signal,
    });

    if (response.status === 404) {
      throw new RegistryError(
        `Package ${packageName} does not exist in the registry.`,
        packageName,
        404,
      );
    }
    if (!response.ok) {
      throw new RegistryError(
        `Registry returned ${response.status} for ${packageName}.`,
        packageName,
        response.status,
      );
    }

    return parsePackument(packageName, await response.json());
  } catch (error) {
    if (error instanceof RegistryError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new RegistryError(
        `Timed out fetching ${packageName} from the registry.`,
        packageName,
      );
    }
    throw new RegistryError(
      `Could not reach the npm registry for ${packageName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      packageName,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Parse a registry document defensively.
 *
 * Real registry data from the 2010s is inconsistent: `dependencies` is sometimes
 * an array, sometimes a string, sometimes absent. A single malformed version
 * must not abort an ingestion covering thousands of packages, so bad records are
 * skipped rather than thrown.
 */
export function parsePackument(packageName: string, raw: unknown): Packument {
  if (typeof raw !== "object" || raw === null) {
    throw new RegistryError(`Malformed registry response for ${packageName}.`, packageName);
  }
  const doc = raw as Record<string, unknown>;

  const versions: Record<string, RegistryVersion> = {};
  const rawVersions = doc.versions;
  if (typeof rawVersions === "object" && rawVersions !== null) {
    for (const [version, value] of Object.entries(rawVersions as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const entry = value as Record<string, unknown>;
      versions[version] = {
        name: packageName,
        version,
        dependencies: parseDependencies(entry.dependencies),
        integrity: readString((entry.dist as Record<string, unknown> | undefined)?.integrity),
        deprecated: readString(entry.deprecated),
      };
    }
  }

  const distTags: Record<string, string> = {};
  const rawTags = doc["dist-tags"];
  if (typeof rawTags === "object" && rawTags !== null) {
    for (const [tag, version] of Object.entries(rawTags as Record<string, unknown>)) {
      if (typeof version === "string") distTags[tag] = version;
    }
  }

  const publishedAt: Record<string, string> = {};
  const rawTime = doc.time;
  if (typeof rawTime === "object" && rawTime !== null) {
    for (const [version, iso] of Object.entries(rawTime as Record<string, unknown>)) {
      // `created` and `modified` are package-level, not versions.
      if (typeof iso === "string" && version !== "created" && version !== "modified") {
        publishedAt[version] = iso;
      }
    }
  }

  return {
    name: packageName,
    versions,
    distTags,
    publishedAt,
    maintainers: parseMaintainers(doc.maintainers),
  };
}

function parseDependencies(raw: unknown): Record<string, string> {
  const dependencies: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return dependencies;
  for (const [name, range] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof range === "string" && isValidPackageName(name)) {
      dependencies[name] = range;
    }
  }
  return dependencies;
}

/** Maintainers appear as `{name, email}` objects or bare `name <email>` strings. */
function parseMaintainers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const handles: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const handle = entry.split("<")[0].trim();
      if (handle) handles.push(handle);
    } else if (typeof entry === "object" && entry !== null) {
      const name = (entry as Record<string, unknown>).name;
      if (typeof name === "string" && name.trim()) handles.push(name.trim());
    }
  }
  return [...new Set(handles)];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
