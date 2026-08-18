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
 * The result is reported as a comparison — routes before, routes after — because
 * "done" is not evidence. The re-check that produced those numbers ran the same
 * query that found the problem in the first place.
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

  // ── After: the outcome, proven ──────────────────────────────────────────
  if (result) {
    const restored = result.ok && result.statusAfter === "verified";
    return (
      <div
        className={`rounded-lg border p-5 ${
          restored
            ? "border-verified/30 bg-verified-dim shadow-glow-verified"
            : result.ok
              ? "border-investigating/30 bg-investigating-dim"
              : "border-violated/30 bg-violated-dim"
        }`}
      >
        <p
          className={`font-mono text-2xs uppercase tracking-[0.2em] ${
            restored ? "text-verified" : result.ok ? "text-investigating" : "text-violated"
          }`}
        >
          {restored ? "boundary restored" : result.ok ? "partially fixed" : "not applied"}
        </p>
        <p className="mt-2 text-lg text-ink">{result.message}</p>

        {result.ok ? (
          <div className="mt-4 flex flex-wrap items-end gap-8">
            <Figure label="routes before" value={result.routesBefore} tone="text-violated" />
            <Figure
              label="routes now"
              value={result.routesAfter}
              tone={result.routesAfter === 0 ? "text-verified" : "text-investigating"}
            />
            <Figure label="re-checked in" value={`${result.elapsedMs}ms`} />
          </div>
        ) : null}

        <p className="mt-4 max-w-2xl text-xs leading-relaxed text-ink-muted">
          Tavik did not take this on trust. It removed the relationship, then ran
          the same check that found the problem and counted what was left.
        </p>
      </div>
    );
  }

  // ── Before: what Tavik suggests ─────────────────────────────────────────
  return (
    <div className="space-y-3">
      {proposals.map((proposal) => {
        const isConfirming = confirming === proposal.id;
        const closesIt = proposal.routesRemaining === 0;

        return (
          <div
            key={proposal.id}
            className={`rounded-lg border p-4 transition-colors ${
              isConfirming ? "border-violated/40 bg-violated-dim" : "border-line bg-surface"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{proposal.summary}</p>
                <p className="mt-1 font-mono text-2xs text-ink-subtle">
                  closes {proposal.routesRemoved} of{" "}
                  {proposal.routesRemoved + proposal.routesRemaining} route
                  {proposal.routesRemoved + proposal.routesRemaining === 1 ? "" : "s"}
                  {closesIt ? " — fixes it completely" : ""}
                </p>
              </div>
              <span
                className={`shrink-0 font-mono text-2xl leading-none tabular-nums ${
                  closesIt ? "text-verified" : "text-investigating"
                }`}
              >
                −{proposal.routesRemoved}
              </span>
            </div>

            {isConfirming ? (
              <div className="mt-4 border-t border-violated/20 pt-4">
                <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                  Before you approve
                </p>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
                  {proposal.consequence}
                </p>
                {proposal.affected.length > 0 ? (
                  <p className="mt-2 font-mono text-2xs text-ink-subtle">
                    cuts off: {proposal.affected.slice(0, 6).join(", ")}
                    {proposal.affected.length > 6
                      ? ` +${proposal.affected.length - 6} more`
                      : ""}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    variant="danger"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const outcome = await applyRemediation(
                          boundaryId,
                          proposal.from,
                          proposal.to,
                          proposal.relation,
                        );
                        setResult(outcome);
                      })
                    }
                  >
                    {pending ? "Applying and re-checking…" : "Approve and apply"}
                  </Button>
                  <Button variant="ghost" disabled={pending} onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                  <span className="font-mono text-2xs text-ink-faint">
                    this changes the graph for real
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <Button size="sm" variant="secondary" onClick={() => setConfirming(proposal.id)}>
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
      <p className={`font-mono text-3xl leading-none tabular-nums ${tone}`}>{value}</p>
      <p className="mt-1.5 text-2xs uppercase tracking-wider text-ink-faint">{label}</p>
    </div>
  );
}
