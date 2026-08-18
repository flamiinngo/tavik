import Link from "next/link";

import { BoundaryGap } from "@/components/boundary/BoundaryGap";
import { VerificationReceipt } from "@/components/boundary/VerificationReceipt";
import { PathTrace } from "@/components/graph/PathTrace";
import { Tavik } from "@/components/mascot/Tavik";
import { STATUS_PRESENTATION } from "@/components/ui/Status";
import { Button, EmptyState, Timestamp } from "@/components/ui/primitives";
import type { BoundaryStatus } from "@/lib/domain/boundary";
import { loadSecurityState, loadWorkLog } from "@/lib/server/tavik";

export const metadata = { title: "Overview" };

/**
 * The overview.
 *
 * Built to answer one question from across a room: is anything untrue right now?
 * So the state is stated at display size with the character beside it, and the
 * evidence follows immediately underneath.
 *
 * The visual weight is deliberate. An earlier version was uniformly dense and
 * restrained, which read as unfinished rather than serious — with one boundary
 * declared, "restrained" is indistinguishable from "empty". Scale and contrast
 * are doing the work that volume of content otherwise would.
 *
 * Glow and motion appear only on live state. Nothing here animates for
 * decoration; the pulse means Tavik is running now, and that is all it means.
 */

// Never cached. A stale security verdict is a false safety claim.
export const dynamic = "force-dynamic";

const RAIL: Record<BoundaryStatus, string> = {
  verified: "bg-verified",
  violated: "bg-violated",
  investigating: "bg-investigating",
  unknown: "bg-unknown",
};

const HERO_GLOW: Record<BoundaryStatus, string> = {
  verified: "shadow-glow-verified",
  violated: "shadow-glow-violated",
  investigating: "",
  unknown: "",
};

export default async function OverviewPage() {
  const [state, workLog] = await Promise.all([loadSecurityState(), loadWorkLog(6)]);

  const critical = state.boundaries.find(
    (entry) => entry.verification?.status === "violated",
  );
  const headline = critical ?? state.boundaries[0];
  const headlineStatus = headline?.verification?.status ?? "unknown";
  const presentation = STATUS_PRESENTATION[headlineStatus];

  return (
    <>
      {/* ── Status bar ───────────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-6 border-b border-line px-6">
        <div className="flex items-center gap-3">
          <span className="relative flex size-2">
            <span
              className={`absolute inline-flex size-full animate-breathe rounded-full ${RAIL[headlineStatus]}`}
              aria-hidden
            />
          </span>
          <h1 className="text-sm font-medium text-ink">Security state</h1>
          <span className="font-mono text-2xs text-ink-faint">
            continuous verification · live
          </span>
        </div>
        <p className="hidden font-mono text-2xs text-ink-faint sm:block">
          {state.entityCount !== null
            ? `${state.entityCount.toLocaleString()} entities · ${state.boundaries.length} boundaries`
            : "state unavailable"}
        </p>
      </header>

      <main className="min-w-0 flex-1">
        {state.connectionError ? (
          <section className="border-b border-unknown/25 bg-unknown-dim px-6 py-4">
            <p className="text-sm text-ink">Unable to read the security state.</p>
            <p className="mt-1 max-w-3xl text-sm text-ink-muted">
              Every boundary is reported as <span className="text-unknown">unknown</span> — not
              verified. Tavik does not know whether these boundaries hold.
            </p>
            <p className="mt-2 font-mono text-2xs text-ink-subtle">{state.connectionError}</p>
          </section>
        ) : null}

        {/* ── The hero: state at display size ──────────────────────────────── */}
        {headline ? (
          <section className="relative overflow-hidden border-b border-line">
            {/* A single soft field behind the hero, tinted by state. Not a
                gradient for its own sake — it is what lets the numbers sit at
                display size without the panel feeling like a flat slab. */}
            <div
              className={`pointer-events-none absolute inset-0 opacity-[0.16] ${
                headlineStatus === "violated"
                  ? "bg-[radial-gradient(60%_120%_at_15%_0%,var(--color-violated),transparent_70%)]"
                  : "bg-[radial-gradient(60%_120%_at_15%_0%,var(--color-verified),transparent_70%)]"
              }`}
              aria-hidden
            />

            <div className="relative flex flex-col gap-8 px-6 py-9 lg:flex-row lg:items-center lg:gap-12">
              {/* Tavik, at a size where the character actually reads. */}
              <div className={`relative shrink-0 self-center rounded-full ${HERO_GLOW[headlineStatus]}`}>
                <Tavik
                  pose={
                    headlineStatus === "violated"
                      ? "alert"
                      : headlineStatus === "verified"
                        ? "verified"
                        : "standby"
                  }
                  size="xl"
                  priority
                  alt=""
                />
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className={`flex items-center gap-2.5 font-mono text-2xs uppercase tracking-[0.2em] ${presentation.text}`}
                >
                  <span
                    className={`size-1.5 animate-breathe rounded-full ${RAIL[headlineStatus]}`}
                    aria-hidden
                  />
                  {headline.boundary.name}
                </p>

                <h2
                  className={`mt-3 text-5xl font-medium leading-[0.95] tracking-tight sm:text-6xl ${presentation.text}`}
                >
                  {presentation.headline}
                </h2>

                <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-muted">
                  {headline.boundary.statement}
                </p>

                {/* Scoreboard. The three numbers that describe the finding. */}
                {headline.verification ? (
                  <div className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-5">
                    <ScoreboardFigure
                      value={headline.verification.paths.length}
                      label={headline.verification.paths.length === 1 ? "route across" : "routes across"}
                      tone={presentation.text}
                    />
                    <ScoreboardFigure
                      value={headline.verification.sourceCount}
                      label="publishers in scope"
                    />
                    <ScoreboardFigure
                      value={`${headline.verification.elapsedMs.toFixed(0)}ms`}
                      label="to prove it"
                    />
                    <Link href={`/app/boundaries/${headline.boundary.id}`}>
                      <Button variant="primary">Investigate</Button>
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {/* ── The claim ────────────────────────────────────────────────────── */}
        {headline?.verification ? (
          <section className="border-b border-line px-6 py-8">
            <BoundaryGap
              boundary={headline.boundary}
              status={headlineStatus}
              pathCount={headline.verification.paths.length}
              sourceCount={headline.verification.sourceCount}
              targetCount={headline.verification.targetCount}
            />
          </section>
        ) : null}

        {/* ── Evidence ─────────────────────────────────────────────────────── */}
        {headline?.verification && headline.verification.paths.length > 0 ? (
          <section className="border-b border-line px-6 py-8">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-sm font-medium text-ink">Shortest routes</h3>
              <Link
                href={`/app/boundaries/${headline.boundary.id}`}
                className="font-mono text-2xs text-ink-subtle transition-colors hover:text-ink"
              >
                all {headline.verification.paths.length} routes →
              </Link>
            </div>

            <div className="mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
              {headline.verification.paths
                .slice()
                .sort((a, b) => a.length - b.length)
                .slice(0, 3)
                .map((path, index) => (
                  <div
                    key={index}
                    className="animate-trace-in rounded-lg border border-line bg-surface p-4"
                    style={{ animationDelay: `${index * 70}ms` }}
                  >
                    <PathTrace path={path} ordinal={index + 1} />
                  </div>
                ))}
            </div>
          </section>
        ) : null}

        {/* ── Method ───────────────────────────────────────────────────────── */}
        {headline?.verification ? (
          <section className="border-b border-line bg-inset px-6 py-6">
            <h3 className="mb-4 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
              How this was proven
            </h3>
            <VerificationReceipt
              boundary={headline.boundary}
              verification={headline.verification}
            />
          </section>
        ) : null}

        {/* ── Ledger + work log ────────────────────────────────────────────── */}
        <div className="grid lg:grid-cols-2">
          <section className="border-b border-line lg:border-r">
            <div className="flex items-baseline justify-between px-6 py-4">
              <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                Boundaries
              </h3>
              <Link
                href="/app/boundaries"
                className="font-mono text-2xs text-ink-subtle transition-colors hover:text-ink"
              >
                all →
              </Link>
            </div>

            {state.boundaries.length === 0 ? (
              <EmptyState
                illustration={<Tavik pose="standby" size="md" alt="" />}
                title="Nothing to verify yet"
                description="Declare what must never happen and Tavik will prove it, continuously."
                action={<Button variant="primary">Declare a boundary</Button>}
              />
            ) : (
              <ul>
                {state.boundaries.map(({ boundary, verification }) => {
                  const status = verification?.status ?? "unknown";
                  return (
                    <li key={boundary.id} className="border-t border-line">
                      <Link
                        href={`/app/boundaries/${boundary.id}`}
                        className="flex items-stretch transition-colors hover:bg-raised/50"
                      >
                        <span className={`w-0.5 shrink-0 ${RAIL[status]}`} aria-hidden />
                        <div className="flex min-w-0 flex-1 items-center gap-4 px-5 py-3.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2.5">
                              <span className="text-sm text-ink">{boundary.name}</span>
                              <span
                                className={`font-mono text-2xs uppercase tracking-wider ${STATUS_PRESENTATION[status].text}`}
                              >
                                {status}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-xs text-ink-subtle">
                              {verification?.failureReason ?? boundary.statement}
                            </p>
                          </div>
                          <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-faint">
                            {verification ? `${verification.paths.length}` : "—"}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="border-b border-line">
            <div className="flex items-baseline justify-between px-6 py-4">
              <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                Tavik work log
              </h3>
              <Link
                href="/app/work-log"
                className="font-mono text-2xs text-ink-subtle transition-colors hover:text-ink"
              >
                all →
              </Link>
            </div>

            {workLog.events.length === 0 ? (
              <EmptyState
                illustration={<Tavik pose="working" size="md" alt="" />}
                title="Nothing recorded yet"
                description="Tavik writes an entry every time it verifies a boundary or observes a change."
              />
            ) : (
              <ul>
                {workLog.events.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line px-6 py-2.5"
                  >
                    <Timestamp at={entry.at} className="shrink-0" />
                    <span className="min-w-0 flex-1 text-sm text-ink-muted">
                      {entry.summary}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

/** A single large figure with its label. The scoreboard vocabulary. */
function ScoreboardFigure({
  value,
  label,
  tone = "text-ink",
}: {
  value: number | string;
  label: string;
  tone?: string;
}) {
  return (
    <div>
      <p className={`font-mono text-4xl leading-none tabular-nums tracking-tight ${tone}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      <p className="mt-2 text-2xs uppercase tracking-wider text-ink-faint">{label}</p>
    </div>
  );
}
