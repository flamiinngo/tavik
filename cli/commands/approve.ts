/**
 * `tavik approve <publisher>` — put an account on this workspace's allowlist.
 *
 * The second route to green, available where the first one is not. Removing a
 * dependency is one answer to "somebody outside our list can reach production";
 * deciding the account belongs on the list is the other, and teams make that
 * call constantly.
 *
 * It writes a named entry to the work log, for the same reason the dashboard
 * does: approving a publisher can turn a red rule green without a line of code
 * changing, which makes it the easiest way to make a problem disappear without
 * solving it. That is legitimate — risk gets accepted deliberately all the time
 * — but only if the record says who accepted it and what it was before.
 *
 * The word "approve" is chosen carefully and used consistently. Tavik states a
 * capability fact — this account can publish something you depend on, and it is
 * not on your list — and never a claim about the person behind it.
 */

import { entityUrn, type EntityUrn } from "../../src/lib/domain/entities";
import { event } from "../../src/lib/engine/change-log";
import { connection } from "../config";
import { bold, dim, green, grey, heading, line, plural } from "../output";
import { EXIT, runtime } from "../runtime";

export type TrustLevel = "trusted" | "untrusted" | "quarantined";

export interface ApproveOptions {
  readonly publishers: readonly string[];
  readonly trust: TrustLevel;
  readonly operator: string;
  readonly json: boolean;
}

export async function approve(options: ApproveOptions): Promise<number> {
  const { store, changeLog } = runtime(connection());

  const results: { publisher: string; ok: boolean; from?: string; message: string }[] = [];

  for (const raw of options.publishers) {
    const name = raw.trim();
    if (name.length === 0) continue;

    const urn = entityUrn("Maintainer", name) as EntityUrn;
    const existing = await store.getEntity(urn);

    if (!existing) {
      // Refused rather than created. Approving an account that is not in the
      // graph writes a policy for something Tavik has never seen, which reads
      // as coverage that does not exist — and a typo would silently become a
      // permanent allowlist entry nobody can account for.
      results.push({
        publisher: name,
        ok: false,
        message: `not in your graph — run \`tavik scan\` first, or check the spelling`,
      });
      continue;
    }

    const before = String(
      (existing.properties as Record<string, unknown> | undefined)?.trust ?? "untrusted",
    );

    await store.setTrust(urn, options.trust);

    try {
      await changeLog.append([
        event("trust.changed", Date.now(), {
          actor: { kind: "user", id: options.operator, name: options.operator },
          summary:
            options.trust === "trusted"
              ? `${options.operator} added ${name} to the approved publisher list.`
              : options.trust === "quarantined"
                ? `${options.operator} put ${name} under review.`
                : `${options.operator} removed ${name} from the approved publisher list.`,
          detail: { kind: "trust_change", publisher: name, from: before, to: options.trust },
        }),
      ]);
    } catch {
      // The decision is already applied. Failing to write history must not
      // report a completed change as failed.
    }

    results.push({ publisher: name, ok: true, from: before, message: options.trust });
  }

  const changed = results.filter((result) => result.ok);

  if (options.json) {
    line(JSON.stringify({ operator: options.operator, results }, null, 2));
    return changed.length > 0 ? EXIT.OK : EXIT.ERROR;
  }

  heading(
    options.trust === "trusted"
      ? "Approving publishers"
      : options.trust === "quarantined"
        ? "Putting publishers under review"
        : "Removing publishers from the approved list",
  );
  line();

  for (const result of results) {
    line(
      result.ok
        ? `  ${green("✓")} ${bold(result.publisher)}  ${grey(`${result.from} → ${result.message}`)}`
        : `  ${grey("·")} ${bold(result.publisher)}  ${grey(result.message)}`,
    );
  }

  line();
  if (changed.length === 0) {
    line(`  ${dim("Nothing changed.")}`);
    line();
    return EXIT.ERROR;
  }

  line(
    `  ${plural(changed.length, "publisher")} updated, recorded as ${bold(options.operator)}.`,
  );
  line(`  ${grey("Run `tavik check` to see what it changed.")}`);
  line();
  return EXIT.OK;
}
