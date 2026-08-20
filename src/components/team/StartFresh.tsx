"use client";

import { useState, useTransition } from "react";

import { resetWorkspace } from "@/app/app/onboarding/actions";
import { signOutOperator } from "@/app/app/team/actions";
import { Button } from "@/components/ui/primitives";

/**
 * Emptying the workspace.
 *
 * The action existed for a while and nothing in the interface could reach it,
 * so the only way back to a clean slate was to destroy the Docker volume from a
 * terminal. That is a poor answer for anyone evaluating the product, and no
 * answer at all for someone who scanned the wrong repository.
 *
 * Two clicks, never one. This deletes a real graph that took minutes to build,
 * and it cannot be undone — the graph is rebuilt by re-scanning, not restored.
 * A single red button next to ordinary controls is how people delete things they
 * meant to keep.
 *
 * It says exactly what goes and what stays, because "are you sure?" asks someone
 * to confirm something they have not been told.
 */
export function StartFresh({
  canReset,
  hosted,
}: {
  canReset: boolean;
  /** True on the public demo, where emptying by hand cannot finish. */
  hosted: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [alsoSignOut, setAlsoSignOut] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // On the hosted demo this offers nothing and would strand whoever pressed it.
  //
  // HydraDB has no bulk delete, so emptying happens a node at a time at roughly
  // 1.5 seconds each — around half an hour for a scanned project, against a
  // serverless function that is killed after five minutes. A visitor would get a
  // spinner that never finishes and a half-deleted graph, which is a worse
  // outcome than not offering it. The demo empties itself anyway, so the honest
  // thing is to say how rather than hand someone a button that cannot work.
  if (hosted) {
    return (
      <div className="rounded-lg bg-card p-5 shadow-card">
        <h3 className="text-[14px] font-semibold tracking-tight text-ink">
          This demo resets itself
        </h3>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
          It runs on a free plan with no permanent storage, so after fifteen
          quiet minutes the database sleeps and the workspace comes back empty.
          Whoever opens it next starts from nothing and scans whatever they like.
        </p>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
          Emptying it by hand isn&apos;t offered here because it could not
          finish: HydraDB has no bulk delete, so it would remove a few thousand
          things one at a time and be cut off long before the end. On your own
          machine that button is here, and{" "}
          <code className="font-mono text-ink">npm run reset</code> is quicker
          still.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-alert-line bg-card p-5 shadow-card">
      <h3 className="text-[14px] font-semibold tracking-tight text-ink">Start fresh</h3>

      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
        Empties this workspace completely — every project you&apos;ve scanned,
        every package and publisher in the graph, every rule, and the whole work
        log.
      </p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
        There is no undo. Nothing is archived; a scanned project comes back only
        by scanning it again, which takes as long as it did the first time.
      </p>

      {/* Said plainly rather than discovered halfway through a wipe that never
          finishes. HydraDB has no bulk delete — `WITH … LIMIT` before a write is
          refused, `DELETE … LIMIT` will not parse, and deleting every node in
          one statement exceeds the server's 30-second limit — so this button
          removes nodes one at a time, and one node takes about 1.5 seconds on a
          populated graph. Fine for a workspace with a project or two in it;
          hopeless for one with thousands of packages, where replacing the
          database volume is both the honest and the fast answer. */}
      <div className="mt-4 rounded-sm bg-inset px-4 py-3">
        <p className="text-[12.5px] leading-relaxed text-ink-subtle">
          For a big graph, wiping the database directly is far quicker than
          emptying it here — this removes things one at a time, which is slow
          once there are thousands of them.
        </p>
        <code className="mt-2 block overflow-x-auto font-mono text-[12.5px] whitespace-nowrap text-ink">
          npm run reset
        </code>
      </div>

      {!canReset ? (
        <p className="mt-4 rounded-sm bg-inset px-4 py-3 text-[13px] leading-relaxed text-ink-subtle">
          Only the workspace owner can do this. Change your role on this page if
          that is you.
        </p>
      ) : !armed ? (
        <div className="mt-5">
          <Button variant="danger" onClick={() => setArmed(true)}>
            Empty this workspace
          </Button>
        </div>
      ) : (
        <div className="mt-5">
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed text-ink-soft">
            <input
              type="checkbox"
              checked={alsoSignOut}
              onChange={(event) => setAlsoSignOut(event.target.checked)}
              className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent)]"
            />
            <span>Also forget who I am, so this is a completely clean start.</span>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await resetWorkspace();
                  // Identity is cleared only after the data actually went. A
                  // failed reset that still signed someone out would leave them
                  // worse off than before they pressed anything.
                  if (result.ok && alsoSignOut) await signOutOperator();
                  setMessage({ ok: result.ok, text: result.message });
                  setArmed(false);
                })
              }
            >
              {pending ? "Emptying…" : "Yes, empty it"}
            </Button>

            <Button variant="ghost" disabled={pending} onClick={() => setArmed(false)}>
              Keep my data
            </Button>
          </div>
        </div>
      )}

      {message ? (
        <p
          className={`mt-4 rounded-sm px-4 py-3 text-[13.5px] leading-relaxed ${
            message.ok ? "bg-safe-soft text-safe" : "bg-alert-soft text-alert"
          }`}
        >
          {message.text}
          {message.ok ? " Head to Get started to scan something." : ""}
        </p>
      ) : null}
    </div>
  );
}
