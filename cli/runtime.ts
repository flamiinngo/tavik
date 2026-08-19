/**
 * The CLI's connection to Tavik.
 *
 * Builds exactly the same objects the dashboard builds — same client, same
 * store, same rule store, same change log — pointed at the same graph. That is
 * the point, and it is worth being explicit about: there is no second copy of
 * the engine here and no CLI-specific verification path. A rule that breaks in
 * CI is the same rule, answered by the same query, writing to the same work log
 * the dashboard renders.
 *
 * It deliberately does not import `@/lib/server/tavik`. That module pulls in
 * `server-only`, which exists to make importing it outside a server component a
 * build error — correct for the app, fatal here. The wiring is small enough to
 * repeat honestly rather than to weaken that guard to share it.
 */

import { ChangeLog } from "../src/lib/engine/change-log";
import { RuleStore } from "../src/lib/engine/rule-store";
import { HydraClient } from "../src/lib/hydra/client";
import { GraphStore } from "../src/lib/hydra/graph-store";
import { type Connection } from "./config";

export interface Runtime {
  readonly client: HydraClient;
  readonly store: GraphStore;
  readonly rules: RuleStore;
  readonly changeLog: ChangeLog;
}

export function runtime(connection: Connection): Runtime {
  const client = new HydraClient(connection);
  return {
    client,
    store: new GraphStore(client),
    rules: new RuleStore(client),
    changeLog: new ChangeLog(client),
  };
}

/**
 * Exit codes.
 *
 * The reason this CLI exists is that a build should stop when a boundary breaks,
 * so these are part of the contract rather than an afterthought.
 *
 * `UNCHECKED` is the one worth defending. It would be easy to exit 0 when a rule
 * could not be evaluated — nothing was proven wrong, after all — and it would
 * make the tool look better in exactly the situation where it knows least. That
 * is `unknown` collapsing into `verified` with a green tick on top, which is the
 * single worst thing this product could do, so it gets its own failing code.
 */
export const EXIT = {
  /** Every rule was checked and every rule holds. */
  OK: 0,
  /** At least one rule has a way through. */
  BROKEN: 1,
  /** At least one rule could not be checked at all. */
  UNCHECKED: 2,
  /** Tavik could not run: bad config, no token, database unreachable. */
  ERROR: 3,
  /** The command line itself was wrong. */
  USAGE: 64,
} as const;
