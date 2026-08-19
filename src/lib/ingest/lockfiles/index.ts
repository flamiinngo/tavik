import { parseLockfile as parseNpm, type LockfileGraph } from "../lockfile";
import { parsePnpmLock } from "./pnpm";
import { parseYarnLock } from "./yarn";

/**
 * Reading whatever lockfile a project actually uses.
 *
 * Supporting only `package-lock.json` looked reasonable until it was measured:
 * of twelve widely-used repositories, two commit an npm lockfile, seven commit
 * `yarn.lock`, and two commit `pnpm-lock.yaml`. A tool that reads one in six
 * projects is not a tool, so all three are parsed here.
 *
 * Each format is reduced to the same {@link LockfileGraph}, which is what keeps
 * everything downstream — the graph, the rules, the traversal — completely
 * unaware of which package manager produced the file.
 */

export type LockfileFormat = "npm" | "yarn" | "pnpm";

export interface DetectedLockfile {
  readonly format: LockfileFormat;
  readonly graph: LockfileGraph;
}

export class UnsupportedLockfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedLockfileError";
  }
}

/** Guess the format from the filename, when there is one to go on. */
export function formatFromFilename(name: string): LockfileFormat | null {
  const file = name.toLowerCase().split(/[\\/]/).pop() ?? "";
  if (file === "package-lock.json" || file === "npm-shrinkwrap.json") return "npm";
  if (file === "yarn.lock") return "yarn";
  if (file === "pnpm-lock.yaml" || file === "pnpm-lock.yml") return "pnpm";
  return null;
}

/**
 * Parse a lockfile, detecting the format from its contents when necessary.
 *
 * Content sniffing matters because the file often arrives without a trustworthy
 * name — pasted into a textarea, or renamed on the way. The signatures are
 * unambiguous enough that guessing is safe.
 */
export function parseAnyLockfile(
  contents: string,
  filename?: string,
): DetectedLockfile {
  const hinted = filename ? formatFromFilename(filename) : null;
  const format = hinted ?? sniff(contents);

  if (!format) {
    throw new UnsupportedLockfileError(
      "That doesn't look like a lockfile Tavik recognises. It reads package-lock.json, yarn.lock and pnpm-lock.yaml.",
    );
  }

  switch (format) {
    case "npm":
      return { format, graph: parseNpm(JSON.parse(contents)) };
    case "yarn":
      return { format, graph: parseYarnLock(contents) };
    case "pnpm":
      return { format, graph: parsePnpmLock(contents) };
  }
}

function sniff(contents: string): LockfileFormat | null {
  const head = contents.slice(0, 4000);

  if (/^\s*\{/.test(head) && /"lockfileVersion"/.test(head)) return "npm";
  if (/^\s*lockfileVersion:/m.test(head)) return "pnpm";
  // Yarn v1 announces itself in a header comment; Berry is YAML with a
  // __metadata block.
  if (/# yarn lockfile v1/.test(head) || /^__metadata:/m.test(head)) return "yarn";
  // Bare YAML with a `packages:` map and `resolution:` entries is pnpm.
  if (/^packages:/m.test(head) && /resolution:/.test(head)) return "pnpm";

  return null;
}
