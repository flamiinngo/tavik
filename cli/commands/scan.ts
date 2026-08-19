/**
 * `tavik scan` — put this project into the graph.
 *
 * Reads the lockfile sitting in the working directory, asks the public npm
 * registry who can publish each of those packages, reads the CI workflows to see
 * whose code runs inside the pipeline, and writes the lot to HydraDB.
 *
 * Working directory first, remote repository second. That ordering is the point
 * of having a CLI at all: in CI the code is already checked out, and asking
 * GitHub for a file that is sitting on disk would be slower, rate-limited, and
 * would check the wrong commit — the branch tip rather than the one being built.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { entityUrn } from "../../src/lib/domain/entities";
import {
  fetchLockfile,
  fetchWorkflows,
  GitHubError,
  parseRepoInput,
  parseWorkflowActions,
  type WorkflowAction,
} from "../../src/lib/ingest/github";
import { parseAnyLockfile } from "../../src/lib/ingest/lockfiles";
import { ingestProject } from "../../src/lib/ingest/pipeline";
import { projectWorkflows } from "../../src/lib/ingest/workflows";
import { STARTER_RULES } from "../../src/lib/domain/starter-rules";
import { connection, type RepoConfig } from "../config";
import { bold, dim, duration, green, grey, heading, line, plural } from "../output";
import { EXIT, runtime } from "../runtime";

/** Checked in this order, which is also how common they are in the wild. */
const LOCKFILE_NAMES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pnpm-lock.yml",
  "npm-shrinkwrap.json",
] as const;

export interface ScanOptions {
  readonly config: RepoConfig;
  readonly cwd: string;
  /** `owner/name` or a GitHub URL. Absent means scan the working directory. */
  readonly repo?: string;
  readonly lockfile?: string;
  readonly service?: string;
  readonly environment?: string;
  readonly json: boolean;
}

export async function scan(options: ScanOptions): Promise<number> {
  const { store, rules } = runtime(connection());
  const startedAt = Date.now();

  const source = options.repo
    ? await remoteSource(options.repo)
    : localSource(options);

  const environment = options.environment ?? options.config.environment ?? "production";
  const trustedPublishers = new Set(options.config.trustedPublishers ?? []);

  if (!options.json) {
    heading(`Scanning ${source.serviceName}`);
    line(`  ${dim(source.description)}`);
    line();
    line(`  ${grey("Asking the npm registry who can publish each package…")}`);
  }

  const detected = parseAnyLockfile(source.contents, source.filename);

  const report = await ingestProject(store, {
    lockfile: detected.graph,
    serviceName: source.serviceName,
    environment,
    trustedPublishers,
    lockfilePath: source.path,
  });

  // ── The second surface: whose code runs in CI ──────────────────────────────
  //
  // A dependency has to reach production to matter. An action is already inside
  // the pipeline, holding whatever secrets that job has. Same shape, so one rule
  // covers both without needing to know they are different things.
  let actionCount = 0;
  let actionPublishers = 0;
  let unpinned = 0;

  const workflowActions = source.workflows;
  if (workflowActions.length > 0) {
    const projection = projectWorkflows(workflowActions, {
      serviceUrn: entityUrn("Service", source.serviceName),
      observedAt: Date.now(),
      trustedPublishers,
    });
    await store.upsertEntities(projection.entities);
    await store.insertRelations(projection.relations);

    actionCount = projection.actionCount;
    actionPublishers = projection.publisherCount;
    unpinned = projection.unpinnedCount;
  }

  // A workspace with data but no rules can answer nothing, so a first scan
  // brings the starter set with it. Seeded at scan time rather than on install,
  // so the first numbers anyone sees are their own.
  const existing = await rules.list();
  const existingIds = new Set(existing.map((rule) => rule.id));
  let seeded = 0;
  for (const rule of STARTER_RULES) {
    if (!existingIds.has(rule.id)) {
      await rules.save(rule);
      seeded++;
    }
  }

  const elapsedMs = Date.now() - startedAt;

  if (options.json) {
    line(
      JSON.stringify(
        {
          service: source.serviceName,
          environment,
          lockfile: source.path,
          format: detected.format,
          packages: report.packagesResolved,
          publishers: report.maintainersFound,
          entitiesWritten: report.entitiesWritten,
          relationsWritten: report.relationsWritten,
          relationsRemoved: report.relationsRemoved,
          ciActions: actionCount,
          ciActionPublishers: actionPublishers,
          unpinnedActions: unpinned,
          // Surfaced, never hidden. A package the registry would not answer for
          // is a hole in the graph, and a hole in the graph is a route Tavik
          // cannot see.
          registryFailures: report.failures.length,
          rulesSeeded: seeded,
          elapsedMs,
        },
        null,
        2,
      ),
    );
    return EXIT.OK;
  }

  line();
  line(`  ${bold(String(report.packagesResolved))} packages`);
  line(`  ${bold(String(report.maintainersFound))} publisher accounts who can reach you`);
  if (actionCount > 0) {
    line(
      `  ${bold(String(actionCount))} CI actions from ` +
        `${plural(actionPublishers, "publisher")}` +
        (unpinned > 0 ? grey(`  (${unpinned} not pinned to a commit)`) : ""),
    );
  }
  if (report.failures.length > 0) {
    // Said out loud. A scan that quietly skipped packages would report a
    // smaller, cleaner graph than the truth.
    line(
      `  ${plural(report.failures.length, "package")} the registry wouldn't answer for — ` +
        `${dim("those routes are invisible to Tavik until it can.")}`,
    );
  }
  if (seeded > 0) {
    line(`  ${grey(`${plural(seeded, "starter rule")} added, so there is something to check.`)}`);
  }
  line();
  line(`  ${green(bold("Scanned."))} ${grey(`${duration(elapsedMs)}. Now run \`tavik check\`.`)}`);
  line();

  return EXIT.OK;
}

interface Source {
  readonly serviceName: string;
  readonly contents: string;
  readonly filename: string;
  readonly path: string;
  readonly description: string;
  readonly workflows: readonly WorkflowAction[];
}

function localSource(options: ScanOptions): Source {
  const dir = resolve(options.cwd);

  const lockfilePath = options.lockfile
    ? resolve(dir, options.lockfile)
    : options.config.lockfile
      ? resolve(dir, options.config.lockfile)
      : findLockfile(dir);

  if (!lockfilePath || !existsSync(lockfilePath)) {
    throw new Error(
      lockfilePath
        ? `No lockfile at ${lockfilePath}.`
        : `No lockfile in ${dir}. Tavik reads ${LOCKFILE_NAMES.slice(0, 3).join(", ")}. ` +
          `Point at one with --lockfile, or scan a repository with --repo owner/name.`,
    );
  }

  const serviceName =
    options.service ?? options.config.service ?? (basename(dir) || "this project");

  return {
    serviceName,
    contents: readFileSync(lockfilePath, "utf8"),
    filename: basename(lockfilePath),
    path: lockfilePath,
    description: `${basename(lockfilePath)} in ${dir}`,
    workflows: localWorkflows(dir),
  };
}

function findLockfile(dir: string): string | null {
  for (const name of LOCKFILE_NAMES) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Read `.github/workflows` off disk.
 *
 * Failing to read workflows must not fail a scan that can still map the
 * dependency graph — the same rule the GitHub reader follows. A repository with
 * no CI is the common case, not an error.
 */
function localWorkflows(dir: string): WorkflowAction[] {
  const workflowDir = join(dir, ".github", "workflows");
  if (!existsSync(workflowDir)) return [];

  const actions: WorkflowAction[] = [];
  try {
    for (const name of readdirSync(workflowDir)) {
      if (!/\.ya?ml$/i.test(name)) continue;
      try {
        actions.push(...parseWorkflowActions(readFileSync(join(workflowDir, name), "utf8"), name));
      } catch {
        // One unreadable workflow must not lose the others.
      }
    }
  } catch {
    return actions;
  }
  return actions;
}

async function remoteSource(input: string): Promise<Source> {
  const ref = parseRepoInput(input);
  if (!ref) {
    throw new Error(`Couldn't read "${input}" as a repository. Try owner/name or a GitHub URL.`);
  }

  try {
    const lockfile = await fetchLockfile(ref);
    const serviceName = `${ref.owner}/${ref.repo}`;

    return {
      serviceName,
      contents: lockfile.contents,
      filename: basename(lockfile.path),
      path: `github.com/${serviceName}/${lockfile.path}`,
      description: `${lockfile.path} on ${lockfile.ref.ref}`,
      workflows: await fetchWorkflows(lockfile.ref),
    };
  } catch (error) {
    if (error instanceof GitHubError) {
      // Written to be actionable — which repository, what was found instead,
      // what to do about it — so they pass through unchanged.
      throw new Error(error.message);
    }
    throw error;
  }
}
