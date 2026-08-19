/**
 * Reading a project straight from GitHub.
 *
 * Uploading a lockfile proves the engine works; pointing Tavik at a repository
 * is how anyone would actually use it. It also makes the product demonstrable
 * on code the viewer already trusts — scanning a well-known public repository is
 * far more convincing than scanning a file we supplied.
 *
 * Public repositories need no credentials. Files are fetched from
 * raw.githubusercontent.com rather than the contents API, which avoids both the
 * 1 MB response limit (real lockfiles exceed it constantly) and the strict
 * unauthenticated rate limit. A token is used only if one is configured, purely
 * to raise those limits.
 */

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: "not-found" | "no-lockfile" | "rate-limited" | "network",
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface RepoRef {
  readonly owner: string;
  readonly repo: string;
  /** Branch, tag or commit. Defaults to the repository's default branch. */
  readonly ref?: string;
}

/**
 * Accept whatever someone pastes.
 *
 * A full URL, `owner/repo`, a link to a file deep inside the tree, a `.git`
 * suffix — all of these are things people actually paste, and rejecting them on
 * a technicality is a bad first impression for the sake of nothing.
 */
export function parseRepoInput(input: string): RepoRef | null {
  const trimmed = input.trim().replace(/\.git$/, "");
  if (trimmed.length === 0) return null;

  // A URL, with or without a branch path.
  const url = /(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)(?:\/tree\/([^/\s?#]+))?/i.exec(
    trimmed,
  );
  if (url) {
    return { owner: url[1], repo: url[2], ref: url[3] };
  }

  // Bare `owner/repo`.
  const bare = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (bare) return { owner: bare[1], repo: bare[2] };

  return null;
}

const RAW = "https://raw.githubusercontent.com";
const API = "https://api.github.com";

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "tavik-security-boundary-verifier",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Look up the default branch, so callers need not guess between main and master. */
export async function resolveDefaultBranch(ref: RepoRef): Promise<string> {
  const response = await fetch(`${API}/repos/${ref.owner}/${ref.repo}`, {
    headers: headers(),
    cache: "no-store",
  });

  if (response.status === 404) {
    throw new GitHubError(
      `Couldn't find github.com/${ref.owner}/${ref.repo}. Check the name, and note that private repositories need a token.`,
      "not-found",
    );
  }
  if (response.status === 403) {
    throw new GitHubError(
      "GitHub is rate-limiting anonymous requests. Set GITHUB_TOKEN in .env.local to raise the limit.",
      "rate-limited",
    );
  }
  if (!response.ok) {
    throw new GitHubError(`GitHub returned ${response.status}.`, "network");
  }

  const body = (await response.json()) as { default_branch?: string };
  return body.default_branch ?? "main";
}

/** Fetch one file's text, or null when it isn't there. */
export async function fetchFile(
  ref: Required<RepoRef>,
  path: string,
): Promise<string | null> {
  const response = await fetch(
    `${RAW}/${ref.owner}/${ref.repo}/${ref.ref}/${path}`,
    { headers: { "User-Agent": "tavik-security-boundary-verifier" }, cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new GitHubError(
      `Couldn't read ${path} (${response.status}).`,
      "network",
    );
  }
  return response.text();
}

/**
 * Lockfile locations worth trying, in order of preference.
 *
 * npm first because it is the only one Tavik can currently parse; the others are
 * listed so the error can say what was found rather than a flat "no lockfile",
 * which is the difference between a useful message and a dead end.
 */
const LOCKFILE_CANDIDATES = [
  { path: "package-lock.json", supported: true, name: "npm" },
  { path: "pnpm-lock.yaml", supported: true, name: "pnpm" },
  { path: "yarn.lock", supported: true, name: "Yarn" },
  { path: "npm-shrinkwrap.json", supported: true, name: "npm shrinkwrap" },
] as const;

export interface RepoLockfile {
  readonly ref: Required<RepoRef>;
  readonly path: string;
  readonly contents: string;
}

/** Find and fetch a lockfile Tavik can actually read. */
export async function fetchLockfile(input: RepoRef): Promise<RepoLockfile> {
  const branch = input.ref ?? (await resolveDefaultBranch(input));
  const ref: Required<RepoRef> = { owner: input.owner, repo: input.repo, ref: branch };

  const found: string[] = [];
  for (const candidate of LOCKFILE_CANDIDATES) {
    const contents = await fetchFile(ref, candidate.path);
    if (contents === null) continue;
    if (candidate.supported) return { ref, path: candidate.path, contents };
    found.push(candidate.name);
  }

  throw new GitHubError(
    found.length > 0
      ? `That repository uses ${found.join(" and ")}, which Tavik can't read yet — only npm's package-lock.json for now.`
      : `No lockfile found in ${ref.owner}/${ref.repo} on ${branch}. Tavik needs a package-lock.json to know what's actually installed.`,
    "no-lockfile",
  );
}

// ── GitHub Actions ──────────────────────────────────────────────────────────

export interface WorkflowAction {
  /** `actions/checkout` — the action's own repository. */
  readonly action: string;
  /** The version reference it is pinned to: a tag, branch or commit sha. */
  readonly version: string;
  /** Which workflow file used it. */
  readonly workflow: string;
}

/**
 * Extract the third-party actions a workflow runs.
 *
 * This is a genuinely different risk surface from a lockfile, and an
 * under-watched one: `uses: some-action@v3` executes somebody else's code
 * *inside your CI*, with access to whatever secrets that job holds. A dependency
 * has to reach production to matter; an action already runs somewhere that can
 * mint credentials.
 *
 * Parsed with a regex rather than a YAML library on purpose. Only one line shape
 * matters, workflows are frequently templated in ways a strict parser rejects,
 * and a scan should not fail because a file it merely wanted to skim had an
 * unusual anchor in it.
 */
export function parseWorkflowActions(
  workflow: string,
  fileName: string,
): WorkflowAction[] {
  const actions: WorkflowAction[] = [];
  const pattern = /^\s*(?:-\s*)?uses:\s*["']?([^"'\s#]+)["']?/gm;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(workflow)) !== null) {
    const raw = match[1];

    // Local composite actions (`./.github/actions/foo`) and container actions
    // (`docker://…`) are not third-party supply chain in the same sense.
    if (raw.startsWith(".") || raw.startsWith("docker://")) continue;

    const [repoPath, version = "unpinned"] = raw.split("@");
    // `owner/repo` or `owner/repo/subdir` — keep only the owning repository,
    // since that is what a person publishes to.
    const segments = repoPath.split("/");
    if (segments.length < 2) continue;

    actions.push({
      action: `${segments[0]}/${segments[1]}`,
      version,
      workflow: fileName,
    });
  }

  return actions;
}

/** List and read every workflow file in a repository. */
export async function fetchWorkflows(
  ref: Required<RepoRef>,
): Promise<WorkflowAction[]> {
  try {
    const listing = await fetch(
      `${API}/repos/${ref.owner}/${ref.repo}/contents/.github/workflows?ref=${ref.ref}`,
      { headers: headers(), cache: "no-store" },
    );
    if (!listing.ok) return [];

    const files = (await listing.json()) as { name?: string; path?: string }[];
    const actions: WorkflowAction[] = [];

    for (const file of files) {
      if (!file.path || !/\.ya?ml$/i.test(file.name ?? "")) continue;
      const contents = await fetchFile(ref, file.path);
      if (contents) actions.push(...parseWorkflowActions(contents, file.name!));
    }
    return actions;
  } catch {
    // Workflows are a bonus surface. Failing to read them must not fail a scan
    // that can still map the dependency graph.
    return [];
  }
}
