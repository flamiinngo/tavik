import Link from "next/link";

import { VerificationReceipt } from "@/components/boundary/VerificationReceipt";
import { PathTrace } from "@/components/graph/PathTrace";
import { SecurityGraph } from "@/components/graph/SecurityGraph";
import { Tavik } from "@/components/mascot/Tavik";
import { STATUS_PRESENTATION } from "@/components/ui/Status";
import { Button, EmptyState, Timestamp } from "@/components/ui/primitives";
import type { BoundaryStatus } from "@/lib/domain/boundary";
import { buildSubgraph, chokepoints } from "@/lib/domain/subgraph";
import { loadSecurityState, loadWorkLog } from "@/lib/server/tavik";

export const metadata = { title: "Overview" };

/**
 * The overview.
 *
 * The graph is the centrepiece, because the graph is the product. Everything
 * Tavik claims is a claim about reachability, and a list of routes rendered as
 * text asks the reader to assemble that picture in their head. Drawing it shows
 * the shape of the problem — where the routes converge, which single node
 * carries most of them — in a way no table does.
 *
 * The hero above it is deliberately compact. An earlier version filled the
 * viewport with the state and forced a scroll before any information appeared,
 * which looked impressive in a screenshot and was useless to work with.
 */

export const dynamic = "force-dynamic";

const RAIL: Record<BoundaryStatus, string> = {
  verified: "bg-verified",
  violated: "bg-violated",
  investigating: "bg-investigating",
  unknown: "bg-unknown",
};

export default async function OverviewPage() {
  const [state, workLog] = await Promise.all([loadSecurityState(), loadWorkLog(6)]);

  const critical = state.boundaries.find(
    (entry) => entry.verification?.status === "violated",
  );
  const headline = critical ?? state.boundaries[0];
  const verification = headline?.verification ?? null;
  const status = verification?.status ?? "unknown";
  const presentation = STATUS_PRESENTATION[status];

  const subgraph = verification ? buildSubgraph(verification.paths) : null;
  const pinch = subgraph ? chokepoints(subgraph, 5) : [];

  return (
    <>
      {/* ── Status bar ───────────────────────────────────────────────────── */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-6 border-b border-line px-5">
        <div className="flex items-center gap-2.5">
          <span className={`size-1.5 animate-breathe rounded-full ${RAIL[status]}`} aria-hidden />
          <h1 className="text-sm font-medium text-ink">Security state</h1>
          <span className="font-mono text-2xs text-ink-faint">continuous · live</span>
        </div>
        <p className="hidden font-mono text-2xs text-ink-faint sm:block">
          {state.entityCount !== null
            ? `${state.entityCount.toLocaleString()} entities · ${state.boundaries.length} boundaries`
            : "state unavailable"}
        </p>
      </header>

      <main className="min-w-0 flex-1">
        {state.connectionError ? (
          <section className="border-b border-unknown/25 bg-unknown-dim px-5 py-3">
            <p className="text-sm text-ink">Unable to read the security state.</p>
            <p className="mt-1 text-sm text-ink-muted">
              Every boundary is <span className="text-unknown">unknown</span> — not verified.
            </p>
            <p className="mt-1.5 font-mono text-2xs text-ink-subtle">{state.connectionError}</p>
          </section>
        ) : null}

        {/* ── Compact hero ─────────────────────────────────────────────────── */}
        {headline ? (
          <section className="relative overflow-hidden border-b border-line">
            <div
              className={`pointer-events-none absolute inset-0 opacity-[0.14] ${
                status === "violated"
                  ? "bg-[radial-gradient(50%_140%_at_10%_0%,var(--color-violated),transparent_70%)]"
                  : "bg-[radial-gradient(50%_140%_at_10%_0%,var(--color-verified),transparent_70%)]"
              }`}
              aria-hidden
            />
            <div className="relative flex flex-wrap items-center gap-x-8 gap-y-5 px-5 py-5">
              <Tavik
                pose={status === "violated" ? "alert" : status === "verified" ? "verified" : "standby"}
                size="md"
                priority
                alt=""
                className="shrink-0"
              />

              <div className="min-w-0 flex-1">
                <p className={`font-mono text-2xs uppercase tracking-[0.2em] ${presentation.text}`}>
                  {headline.boundary.name}
                </p>
                <h2
                  className={`mt-1 text-3xl font-medium leading-none tracking-tight sm:text-4xl ${presentation.text}`}
                >
                  {presentation.headline}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
                  {headline.boundary.statement}
                </p>
              </div>

              {verification ? (
                <div className="flex shrink-0 items-end gap-7">
                  <Figure value={verification.paths.length} label="routes" tone={presentation.text} />
                  <Figure value={verification.sourceCount} label="publishers" />
                  <Figure value={`${verification.elapsedMs.toFixed(0)}ms`} label="to prove" />
                  <Link href={`/app/boundaries/${headline.boundary.id}`}>
                    <Button variant="primary">Investigate</Button>
                  </Link>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* ── The graph ────────────────────────────────────────────────────── */}
        {subgraph && subgraph.nodes.length > 0 ? (
          <section className="border-b border-line">
            <div className="grid xl:grid-cols-[1fr_260px]">
              <div className="min-w-0 border-b border-line p-5 xl:border-b-0 xl:border-r">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-ink">
                      How they reach production
                    </h3>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      Every entity and relationship on a violating route. Left to
                      right in the direction influence travels.
                    </p>
                  </div>
                  <span className="font-mono text-2xs text-ink-faint">
                    {subgraph.nodes.length} entities · {subgraph.edges.length} relationships
                  </span>
                </div>
                <SecurityGraph subgraph={subgraph} />
              </div>

              {/* Chokepoints — the actionable read of the picture. */}
              <aside className="p-5">
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                  Chokepoints
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
                  Entities carrying the most routes. Cutting the highest removes
                  the most exposure for one change.
                </p>
                <ul className="mt-4 space-y-2.5">
                  {pinch.map((node) => (
                    <li key={node.id} className="flex items-baseline gap-3">
                      <span className="w-8 shrink-0 text-right font-mono text-sm tabular-nums text-violated">
                        {node.routeCount}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs text-ink">
                          {node.label}
                        </span>
                        <span className="text-2xs uppercase tracking-wider text-ink-faint">
                          {node.kind}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </aside>
            </div>
          </section>
        ) : null}

        {/* ── Evidence ─────────────────────────────────────────────────────── */}
        {verification && verification.paths.length > 0 ? (
          <section className="border-b border-line p-5">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-sm font-medium text-ink">Shortest routes</h3>
              <Link
                href={`/app/boundaries/${headline!.boundary.id}`}
                className="font-mono text-2xs text-ink-subtle transition-colors hover:text-ink"
              >
                all {verification.paths.length} →
              </Link>
            </div>
            <div className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
              {verification.paths
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
        {verification ? (
          <section className="border-b border-line bg-inset px-5 py-5">
            <h3 className="mb-3.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
              How this was proven
            </h3>
            <VerificationReceipt boundary={headline!.boundary} verification={verification} />
          </section>
        ) : null}

        {/* ── Ledger + work log ────────────────────────────────────────────── */}
        <div className="grid lg:grid-cols-2">
          <section className="border-b border-line lg:border-r">
            <div className="flex items-baseline justify-between px-5 py-3.5">
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
            <ul>
              {state.boundaries.map(({ boundary, verification: check }) => {
                const rowStatus = check?.status ?? "unknown";
                return (
                  <li key={boundary.id} className="border-t border-line">
                    <Link
                      href={`/app/boundaries/${boundary.id}`}
                      className="flex items-stretch transition-colors hover:bg-raised/50"
                    >
                      <span className={`w-0.5 shrink-0 ${RAIL[rowStatus]}`} aria-hidden />
                      <div className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2.5">
                            <span className="text-sm text-ink">{boundary.name}</span>
                            <span
                              className={`font-mono text-2xs uppercase tracking-wider ${STATUS_PRESENTATION[rowStatus].text}`}
                            >
                              {rowStatus}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-ink-subtle">
                            {check?.failureReason ?? boundary.statement}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-faint">
                          {check ? check.paths.length : "—"}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="border-b border-line">
            <div className="flex items-baseline justify-between px-5 py-3.5">
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
                description="Tavik writes an entry every time it verifies a boundary."
              />
            ) : (
              <ul>
                {workLog.events.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line px-5 py-2.5"
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

function Figure({
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
      <p className={`font-mono text-3xl leading-none tabular-nums tracking-tight ${tone}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      <p className="mt-1.5 text-2xs uppercase tracking-wider text-ink-faint">{label}</p>
    </div>
  );
}
