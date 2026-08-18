import Link from "next/link";
import { notFound } from "next/navigation";

import { BoundaryGap } from "@/components/boundary/BoundaryGap";
import { VerificationReceipt } from "@/components/boundary/VerificationReceipt";
import { PathTrace } from "@/components/graph/PathTrace";
import { Tavik } from "@/components/mascot/Tavik";
import { STATUS_PRESENTATION } from "@/components/ui/Status";
import { Button, EmptyState, Timestamp } from "@/components/ui/primitives";
import type { StatusChangeDetail } from "@/lib/domain/change";
import { loadBoundary } from "@/lib/server/tavik";

export const dynamic = "force-dynamic";

/**
 * The investigation screen.
 *
 * Ordered as an investigation actually proceeds: what is the claim, is it true,
 * why not, what changed, and what would fix it. Someone arriving from an alert
 * should be able to read straight down and reach a decision without navigating
 * anywhere else.
 *
 * Every route is shown rather than a sample. This is the evidence page — a
 * summary here would mean asking someone to act on a partial picture.
 */
export default async function BoundaryPage({ params }: PageProps<"/app/boundaries/[id]">) {
  const { id } = await params;
  const data = await loadBoundary(id);
  if (!data) notFound();

  const { boundary, verification, history, connectionError } = data;
  const status = verification?.status ?? "unknown";
  const presentation = STATUS_PRESENTATION[status];

  const lastChange = history.find(
    (event) => event.type === "boundary.status_changed",
  );
  const changeDetail =
    lastChange?.detail?.kind === "status_change"
      ? (lastChange.detail as StatusChangeDetail)
      : null;

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        <Link
          href="/app"
          className="font-mono text-2xs text-ink-subtle transition-colors hover:text-ink"
        >
          ← overview
        </Link>
        <span className="text-ink-faint">/</span>
        <h1 className="truncate text-sm font-medium text-ink">{boundary.name}</h1>
      </header>

      <main className="min-w-0 flex-1 pb-16">
        {/* ── The claim, and whether it holds ────────────────────────────── */}
        <section className="border-b border-line px-6 py-7">
          <div className="flex items-start gap-5">
            <Tavik
              pose={status === "violated" ? "alert" : status === "verified" ? "verified" : "standby"}
              size="md"
              alt=""
              className="hidden shrink-0 md:block"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span
                  className={`inline-flex items-center gap-2 font-mono text-2xs uppercase tracking-widest ${presentation.text}`}
                >
                  <span className={`size-1.5 rounded-full ${presentation.dot}`} aria-hidden />
                  {presentation.headline}
                </span>
              </div>
              <h2 className="mt-2 text-2xl font-medium tracking-tight text-ink">
                {boundary.name}
              </h2>
              <p className="mt-2 max-w-3xl text-base leading-relaxed text-ink-muted">
                {boundary.statement}
              </p>
              {verification?.failureReason ? (
                <p className="mt-3 max-w-3xl rounded-md border border-unknown/25 bg-unknown-dim px-3 py-2 text-sm text-ink-muted">
                  {verification.failureReason}
                </p>
              ) : null}
              {connectionError ? (
                <p className="mt-3 max-w-3xl rounded-md border border-unknown/25 bg-unknown-dim px-3 py-2 text-sm text-ink-muted">
                  {connectionError}
                </p>
              ) : null}
            </div>
          </div>

          {verification ? (
            <div className="mt-8">
              <BoundaryGap
                boundary={boundary}
                status={status}
                pathCount={verification.paths.length}
                sourceCount={verification.sourceCount}
                targetCount={verification.targetCount}
              />
            </div>
          ) : null}
        </section>

        {/* ── Why ─────────────────────────────────────────────────────────── */}
        {verification && verification.paths.length > 0 ? (
          <section className="border-b border-line px-6 py-7">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-sm font-medium text-ink">
                Why it is violated
              </h3>
              <span className="font-mono text-2xs text-ink-faint">
                {verification.paths.length} route
                {verification.paths.length === 1 ? "" : "s"} · shortest{" "}
                {Math.min(...verification.paths.map((p) => p.length))} hops
              </span>
            </div>
            <p className="mt-1.5 max-w-3xl text-sm text-ink-muted">
              Each route below is a chain of real relationships. Every one is
              checkable against the source it came from.
            </p>

            <div className="mt-6 grid gap-x-10 gap-y-9 sm:grid-cols-2 xl:grid-cols-3">
              {verification.paths
                .slice()
                .sort((a, b) => a.length - b.length)
                .map((path, index) => (
                  <PathTrace key={index} path={path} ordinal={index + 1} />
                ))}
            </div>
          </section>
        ) : null}

        {/* ── What changed ────────────────────────────────────────────────── */}
        {changeDetail ? (
          <section className="border-b border-line px-6 py-7">
            <h3 className="text-sm font-medium text-ink">What changed</h3>
            <p className="mt-1.5 text-sm text-ink-muted">{lastChange?.summary}</p>
            <p className="mt-2 font-mono text-2xs text-ink-faint">
              {changeDetail.from} → {changeDetail.to} ·{" "}
              {lastChange ? new Date(lastChange.at).toISOString() : ""}
            </p>

            {changeDetail.appearedPaths.length > 0 ? (
              <div className="mt-5">
                <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                  Routes that appeared
                </p>
                <ul className="mt-3 space-y-2">
                  {changeDetail.appearedPaths.slice(0, 6).map((path) => (
                    <li
                      key={path.signature}
                      className="overflow-x-auto rounded-md border border-line bg-inset px-3 py-2"
                    >
                      <span className="whitespace-nowrap font-mono text-2xs text-ink-muted">
                        {path.hops[0]?.from.split(":").slice(2).join(":")}
                        {path.hops.map((hop, i) => (
                          <span key={i}>
                            <span className="text-violated/70">
                              {" "}
                              ─{hop.relation.toLowerCase()}→{" "}
                            </span>
                            {hop.to.split(":").slice(2).join(":")}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ── Recommendation ──────────────────────────────────────────────── */}
        {status === "violated" ? (
          <section className="border-b border-line px-6 py-7">
            <h3 className="text-sm font-medium text-ink">Recommendation</h3>
            <p className="mt-1.5 max-w-3xl text-sm text-ink-muted">
              This boundary is violated by publish rights, not by a known-bad
              artifact. Restoring it means either adding these publishers to the
              allowlist as an accepted risk, or removing the dependency path that
              reaches production.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" disabled>
                Prepare remediation
              </Button>
              <span className="font-mono text-2xs text-ink-faint">
                remediation workflow not built yet
              </span>
            </div>
          </section>
        ) : null}

        {/* ── When ────────────────────────────────────────────────────────── */}
        <section className="border-b border-line px-6 py-7">
          <h3 className="text-sm font-medium text-ink">History</h3>
          {history.length === 0 ? (
            <EmptyState
              illustration={<Tavik pose="working" size="md" alt="" />}
              title="No history recorded yet"
              description="Tavik writes an entry each time this boundary is verified. Run `npm run verify` to record one."
            />
          ) : (
            <ul className="mt-4 border-t border-line">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-line/60 py-2.5"
                >
                  <Timestamp at={entry.at} className="shrink-0" />
                  <span
                    className={`shrink-0 font-mono text-2xs uppercase tracking-wider ${
                      entry.type === "boundary.status_changed"
                        ? "text-accent"
                        : "text-ink-faint"
                    }`}
                  >
                    {entry.type.split(".")[1]?.replace(/_/g, " ")}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-ink-muted">
                    {entry.summary}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Method ──────────────────────────────────────────────────────── */}
        {verification ? (
          <section className="bg-inset px-6 py-6">
            <h3 className="mb-4 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
              How this was checked
            </h3>
            <VerificationReceipt boundary={boundary} verification={verification} />
          </section>
        ) : null}
      </main>
    </>
  );
}
