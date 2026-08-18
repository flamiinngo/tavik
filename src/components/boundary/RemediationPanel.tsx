"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/primitives";
import type { RemediationProposal } from "@/lib/engine/remediation";
import { applyRemediation, type RemediationResult } from "@/app/app/boundaries/[id]/actions";

/**
 * Propose, confirm, apply, prove.
 *
 * The confirmation step is deliberate friction and should not be optimised
 * away. Removing a dependency can break a build; a one-click fix in a security
 * product is how a tool loses the trust it exists to provide. So the cost is
 * stated in plain language *before* the irreversible button appears, and the
 * button says what it does.
 *
 * The outcome is reported as a comparison — routes before, routes after —
 * because "done" is not evidence. The re-check that produced those numbers ran
 * the same query that found the problem in the first place.
 */

export function RemediationPanel({
  boundaryId,
  proposals,
}: {
  boundaryId: string;
  proposals: readonly RemediationProposal[];
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [result, setResult] = useState<RemediationResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (proposals.length === 0) return null;

  // ── After ────────────────────────────────────────────────────────────────
  if (result) {
    const restored = result.ok && result.statusAfter === "verified";
    return (
      <div
        className={`rounded-md p-6 ${
          restored ? "bg-safe-soft" : result.ok ? "bg-watch-soft" : "bg-alert-soft"
        }`}
      >
        <p
          className={`text-[12px] font-semibold uppercase tracking-[0.14em] ${
            restored ? "text-safe" : result.ok ? "text-watch" : "text-alert"
          }`}
        >
          {restored ? "Rule restored" : result.ok ? "Partly fixed" : "Not applied"}
        </p>
        <p className="mt-2 text-[20px] font-semibold tracking-tight text-ink">
          {result.message}
        </p>

        {result.ok ? (
          <div className="mt-5 flex flex-wrap items-end gap-10">
            <Figure label="ways in before" value={result.routesBefore} tone="text-alert" />
            <Figure
              label="ways in now"
              value={result.routesAfter}
              tone={result.routesAfter === 0 ? "text-safe" : "text-watch"}
            />
            <Figure label="re-checked in" value={`${result.elapsedMs}ms`} />
          </div>
        ) : null}

        <p className="mt-5 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">
          Tavik didn&apos;t take this on trust. It removed the relationship, then ran the
          same check that found the problem and counted what was left.
        </p>
      </div>
    );
  }

  // ── Before ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {proposals.map((proposal) => {
        const isConfirming = confirming === proposal.id;
        const closesIt = proposal.routesRemaining === 0;

        return (
          <div
            key={proposal.id}
            className={`rounded-md p-5 transition-colors ${
              isConfirming ? "bg-alert-soft" : "bg-inset"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-ink">{proposal.summary}</p>
                <p className="mt-1 text-[13px] text-ink-subtle">
                  closes {proposal.routesRemoved} of{" "}
                  {proposal.routesRemoved + proposal.routesRemaining}
                  {closesIt ? " — fixes it completely" : ""}
                  {/* A capped sample presented as a total makes a partial fix
                      look decisive. Say so. */}
                  {proposal.sampled ? " (more routes exist beyond those shown)" : ""}
                </p>
              </div>
              <span
                className={`shrink-0 text-[28px] font-semibold leading-none tabular-nums ${
                  closesIt ? "text-safe" : "text-watch"
                }`}
              >
                −{proposal.routesRemoved}
              </span>
            </div>

            {isConfirming ? (
              <div className="mt-5 border-t border-alert-line pt-5">
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                  Before you approve
                </p>
                <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
                  {proposal.consequence}
                </p>
                {proposal.affected.length > 0 ? (
                  <p className="mt-2 text-[13px] text-ink-subtle">
                    Cuts off: {proposal.affected.slice(0, 6).join(", ")}
                    {proposal.affected.length > 6
                      ? ` and ${proposal.affected.length - 6} more`
                      : ""}
                  </p>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Button
                    variant="danger"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setResult(
                          await applyRemediation(
                            boundaryId,
                            proposal.from,
                            proposal.to,
                            proposal.relation,
                          ),
                        );
                      })
                    }
                  >
                    {pending ? "Applying and re-checking…" : "Approve and apply"}
                  </Button>
                  <Button variant="ghost" disabled={pending} onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                  <span className="text-[13px] text-ink-faint">
                    this changes the graph for real
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <Button size="sm" onClick={() => setConfirming(proposal.id)}>
                  Review this fix
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Figure({
  label,
  value,
  tone = "text-ink",
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div>
      <p className={`text-[32px] font-semibold leading-none tabular-nums ${tone}`}>
        {value}
      </p>
      <p className="mt-2 text-[12px] uppercase tracking-wider text-ink-subtle">{label}</p>
    </div>
  );
}
