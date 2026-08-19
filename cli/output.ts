/**
 * Terminal output.
 *
 * No dependency for this. Colour is a dozen escape codes, and a security tool
 * asking a team to trust it should not pull in a package tree to print a tick —
 * the whole product is about who can reach your code through your dependencies.
 *
 * Colour switches itself off when the output is not a terminal, so logs in CI
 * stay readable, and when NO_COLOR is set, which is the convention people who
 * need it already rely on.
 */

const enabled =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb" &&
  Boolean(process.stdout.isTTY);

const code = (open: number, close: number) => (text: string) =>
  enabled ? `\u001b[${open}m${text}\u001b[${close}m` : text;

export const bold = code(1, 22);
export const dim = code(2, 22);
export const red = code(31, 39);
export const green = code(32, 39);
export const yellow = code(33, 39);
export const blue = code(36, 39);
export const grey = code(90, 39);

export function line(text = ""): void {
  process.stdout.write(`${text}\n`);
}

/** Errors go to stderr so `tavik check --json | jq` stays parseable. */
export function errorLine(text = ""): void {
  process.stderr.write(`${text}\n`);
}

export function heading(text: string): void {
  line();
  line(`  ${bold(text)}`);
}

/**
 * Status, spelled the way the dashboard spells it.
 *
 * Deliberately consistent with the interface. Somebody reading a failed build
 * and then opening the dashboard should meet the same four words, not a
 * translation layer they have to learn.
 */
export function statusBadge(status: string): string {
  switch (status) {
    // Padded to a common width so the column lines up. Done with spaces inside
    // the colour rather than by padding the result, because the escape codes
    // make the string longer than it looks and every padEnd would be wrong.
    case "verified":
      return green("HOLDS    ");
    case "violated":
      return red("BROKEN   ");
    case "investigating":
      return yellow("LOOKING  ");
    default:
      return yellow("UNCHECKED");
  }
}

/** A path, printed so each link can be checked by hand. */
export function renderPath(
  hops: readonly { from: string; relation: string; to: string }[],
  indent = "    ",
): void {
  if (hops.length === 0) return;
  line(`${indent}${bold(hops[0].from)}`);
  for (const hop of hops) {
    line(`${indent}  ${grey(`──${hop.relation}──▶`)} ${bold(hop.to)}`);
  }
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Milliseconds, at a precision anyone can read at a glance. */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
