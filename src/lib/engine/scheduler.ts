import "server-only";

import { notifyStatusChange } from "@/lib/notify/slack";
import { loadRules, tavik } from "@/lib/server/tavik";
import { verifyBoundary } from "./verify";

/**
 * The thing that makes "continuous" true.
 *
 * Until this existed, Tavik checked a rule when someone loaded a page — which
 * meant the product only ever knew what was true while being watched, while the
 * interface claimed it was checking continuously. That gap is exactly the kind
 * of overstatement this product is built to refuse, so either the claim had to
 * go or the behaviour had to arrive. This is the behaviour.
 *
 * The sweep is deliberately quiet. It records a change-log entry only when a
 * rule's status actually changes; a heartbeat every few minutes would bury real
 * events under routine noise and make the log unreadable. Instead the time of
 * the last sweep is stored as a single value, so the interface can say when it
 * last looked without pretending each look was newsworthy.
 */

const SWEEP_KEY = "last_sweep_at";

/** How often to re-check every rule. */
const INTERVAL_MS = Number(process.env.TAVIK_SWEEP_MS ?? 60_000);

/**
 * Guarded on globalThis rather than a module constant.
 *
 * Next.js reloads modules on every change in development, so a module-level flag
 * would let a new interval start on each edit and stack them up until the
 * database is being swept a dozen times a minute.
 */
const globalForScheduler = globalThis as unknown as {
  __tavikSweep?: NodeJS.Timeout;
};

export interface SweepResult {
  readonly checked: number;
  readonly changed: number;
  readonly at: number;
}

/**
 * Check every rule once, recording only genuine transitions.
 *
 * Never throws: a sweep that fails must not take down the process that hosts the
 * interface. Failures leave the previous state in place, and any rule that could
 * not be evaluated reports `unknown` through the normal path.
 */
export async function sweep(): Promise<SweepResult> {
  const at = Date.now();
  let checked = 0;
  let changed = 0;

  try {
    const { client, store, changeLog } = tavik();
    const rules = await loadRules();

    for (const rule of rules) {
      try {
        const previous = await changeLog.latestVerification(rule.id);
        const verification = await verifyBoundary(store, client, rule);
        checked++;

        // Only write when something actually moved. `recordVerification` writes
        // a verification entry every time it is called, so it is only called on
        // a transition — the sweep is meant to be invisible until it has
        // something to say.
        if (!previous || previous.status !== verification.status) {
          const events = await changeLog.recordVerification(rule, verification, previous);
          changed++;

          // Tell people where they already are. The product's premise is that
          // nobody should have to watch a dashboard, which only holds if a
          // change at 2am reaches someone. Transitions only: a message every
          // minute saying nothing changed is how a channel gets muted, and a
          // muted channel looks like coverage while providing none.
          //
          // A first evaluation is skipped. Seeding a workspace would otherwise
          // fire one alert per rule before anyone had done anything, which
          // teaches people to ignore the channel on day one.
          const transition = events.find((e) => e.type === "boundary.status_changed");
          if (previous && transition) {
            const result = await notifyStatusChange(rule, transition);
            if (result.error) {
              console.warn(`[tavik] slack: ${result.error}`);
            }
          }
        }
      } catch {
        // One bad rule must not abort the sweep for the others.
      }
    }

    await store.setMeta(SWEEP_KEY, at);
  } catch {
    // Database unreachable. The next sweep will try again, and every rule
    // reports `unknown` in the meantime — which is the truthful answer.
  }

  return { checked, changed, at };
}

/** When the last sweep completed, or null if none has. */
export async function lastSweepAt(): Promise<number | null> {
  return tavik().store.getMeta(SWEEP_KEY);
}

/**
 * Start sweeping, once per process.
 *
 * Called from instrumentation.ts so it begins with the server rather than
 * needing a second process someone has to remember to run — "continuous" should
 * not depend on operator discipline.
 */
export function startScheduler(): void {
  if (globalForScheduler.__tavikSweep) return;

  // A first sweep shortly after boot, so a freshly started instance has a
  // recent answer rather than an empty one. Delayed a little to let the
  // database finish coming up alongside it.
  setTimeout(() => {
    void sweep();
  }, 5_000);

  globalForScheduler.__tavikSweep = setInterval(() => {
    void sweep();
  }, INTERVAL_MS);

  // Do not hold the process open on its own account.
  globalForScheduler.__tavikSweep.unref?.();

  console.log(
    `[tavik] continuous verification started — every rule re-checked every ${Math.round(
      INTERVAL_MS / 1000,
    )}s`,
  );
}
