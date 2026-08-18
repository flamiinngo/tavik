import Link from "next/link";

import { DemoControl } from "@/components/demo/DemoControl";
import { PathTrace } from "@/components/graph/PathTrace";
import { SecurityGraph } from "@/components/graph/SecurityGraph";
import { Tavik } from "@/components/mascot/Tavik";
import { Card, CardHeader, GroupLabel, HealthBar, StatusRow } from "@/components/ui/Card";
import { STATUS_PRESENTATION } from "@/components/ui/Status";
import { Button, EmptyState, Timestamp } from "@/components/ui/primitives";
import type { BoundaryStatus } from "@/lib/domain/boundary";
import { buildSubgraph, chokepoints } from "@/lib/domain/subgraph";
import { loadSecurityState, loadWorkLog, quarantinedPublishers } from "@/lib/server/tavik";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

/** The publisher the demo control acts on. Chosen because its exposure is small
 *  enough that a couple of changes genuinely close the boundary. */
const DEMO_PUBLISHER = "sebmarkbage";

const RAIL: Record<BoundaryStatus, string> = {
  verified: "bg-verified",
  violated: "bg-violated",
  investigating: "bg-investigating",
  unknown: "bg-unknown",
};

export default async function OverviewPage() {
  const [state, workLog, quarantined] = await Promise.all([
    loadSecurityState(),
    loadWorkLog(5),
    quarantinedPublishers(),
  ]);

  const critical = state.boundaries.find((e) => e.verification?.status === "violated");
  const headline = critical ?? state.boundaries[0];
  const verification = headline?.verification ?? null;
  const status = verification?.status ?? "unknown";
  const presentation = STATUS_PRESENTATION[status];

  const subgraph = verification ? buildSubgraph(verification.paths) : null;
  const pinch = subgraph ? chokepoints(subgraph, 4) : [];
  const allHolding = state.counts.verified === state.boundaries.length;

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-6 border-b border-line px-6">
        <div className="flex items-center gap-2.5">
          <span
            className={`size-2 animate-breathe rounded-pill ${RAIL[allHolding ? "verified" : status]}`}
            aria-hidden
          />
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">Overview</h1>
        </div>
        <p className="font-mono text-[12px] text-ink-faint">
          {state.entityCount !== null
            ? `${state.entityCount.toLocaleString()} things watched`
            : "unavailable"}
        </p>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
        {state.connectionError ? (
          <Card className="border-unknown/25 bg-unknown-dim p-5">
            <p className="text-[15px] font-semibold text-ink">
              Tavik can&apos;t read your security state.
            </p>
            <p className="mt-1.5 text-[13px] text-ink-muted">
              Every boundary is marked <span className="text-unknown">unknown</span> — not
              safe. Tavik doesn&apos;t know whether these hold.
            </p>
          </Card>
        ) : null}

        {/* ── The answer, with Tavik delivering it ─────────────────────────── */}
        {headline ? (
          <Card
            glow={status === "violated" ? "violated" : allHolding ? "verified" : undefined}
            className="overflow-hidden"
          >
            <div className="relative">
              <div
                className={`pointer-events-none absolute inset-0 opacity-[0.15] ${
                  status === "violated"
                    ? "bg-[radial-gradient(70%_140%_at_12%_0%,var(--color-violated),transparent_72%)]"
                    : "bg-[radial-gradient(70%_140%_at_12%_0%,var(--color-verified),transparent_72%)]"
                }`}
                aria-hidden
              />
              <div className="relative flex flex-wrap items-center gap-x-7 gap-y-5 p-6">
                <Tavik
                  pose={status === "violated" ? "alert" : "verified"}
                  size="lg"
                  priority
                  alt=""
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-[12px] font-semibold uppercase tracking-[0.18em] ${presentation.text}`}>
                    {headline.boundary.name}
                  </p>
                  <h2 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
                    {status === "violated"
                      ? `${verification?.paths.length}${verification?.truncated ? "+" : ""} ways in`
                      : "Nothing can get in"}
                  </h2>
                  <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-muted">
                    {headline.boundary.statement}
                  </p>

                  {verification ? (
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <Link href={`/app/boundaries/${headline.boundary.id}`}>
                        <Button variant="primary">
                          {status === "violated" ? "See how, and fix it" : "See the proof"}
                        </Button>
                      </Link>
                      <span className="font-mono text-[12px] text-ink-faint">
                        checked in {verification.elapsedMs.toFixed(0)}ms
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="border-t border-line px-6 py-4">
              <HealthBar counts={state.counts} />
            </div>
          </Card>
        ) : null}

        {/* ── Try it ───────────────────────────────────────────────────────── */}
        <DemoControl
          publisher={DEMO_PUBLISHER}
          isQuarantined={quarantined.includes(DEMO_PUBLISHER)}
        />

        {/* ── The graph ────────────────────────────────────────────────────── */}
        {subgraph && subgraph.nodes.length > 0 ? (
          <Card>
            <CardHeader
              title="How they get in"
              subtitle="Everyone on the left can reach your service on the right. Hover any dot to follow just its routes."
              action={
                <span className="font-mono text-[12px] text-ink-faint">
                  {subgraph.nodes.length} things
                </span>
              }
            />
            <div className="px-5 pb-5">
              <SecurityGraph subgraph={subgraph} />
            </div>

            {pinch.length > 0 ? (
              <div className="border-t border-line px-5 py-4">
                <GroupLabel>
                  Weakest links — cut the top one to remove the most risk at once
                </GroupLabel>
                <ul className="space-y-1">
                  {pinch.map((node) => (
                    <li key={node.id}>
                      <StatusRow
                        status="violated"
                        title={node.label}
                        subtitle={`${node.kind.toLowerCase()} · sits on ${node.routeCount} routes`}
                        trailing={`${node.routeCount}`}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        ) : null}

        {/* ── Evidence ─────────────────────────────────────────────────────── */}
        {verification && verification.paths.length > 0 ? (
          <Card>
            <CardHeader
              title="The shortest ways in"
              subtitle="Each one is a real chain you can check yourself."
              action={
                <Link
                  href={`/app/boundaries/${headline!.boundary.id}`}
                  className="font-mono text-[12px] text-ink-subtle transition-colors hover:text-ink"
                >
                  all {verification.paths.length}
                  {verification.truncated ? "+" : ""} ›
                </Link>
              }
            />
            <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
              {verification.paths
                .slice()
                .sort((a, b) => a.length - b.length)
                .slice(0, 3)
                .map((path, index) => (
                  <div
                    key={index}
                    className="animate-trace-in rounded-md border border-line bg-surface p-4"
                    style={{ animationDelay: `${index * 70}ms` }}
                  >
                    <PathTrace path={path} ordinal={index + 1} />
                  </div>
                ))}
            </div>
          </Card>
        ) : null}

        {/* ── Rules ────────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Your rules"
            subtitle="Things you've said must never happen. Tavik re-checks each one."
            action={
              <Link
                href="/app/boundaries"
                className="font-mono text-[12px] text-ink-subtle transition-colors hover:text-ink"
              >
                all ›
              </Link>
            }
          />
          <ul className="space-y-1 px-3 pb-4">
            {state.boundaries.map(({ boundary, verification: check }) => (
              <li key={boundary.id}>
                <StatusRow
                  status={check?.status ?? "unknown"}
                  title={boundary.name}
                  subtitle={check?.failureReason ?? boundary.statement}
                  trailing={
                    check
                      ? check.paths.length === 0
                        ? "safe"
                        : `${check.paths.length}${check.truncated ? "+" : ""} ways`
                      : "—"
                  }
                  href={`/app/boundaries/${boundary.id}`}
                />
              </li>
            ))}
          </ul>
        </Card>

        {/* ── Work log ─────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="What Tavik has been doing"
            subtitle="It works whether or not anyone is watching."
            action={
              <Link
                href="/app/work-log"
                className="font-mono text-[12px] text-ink-subtle transition-colors hover:text-ink"
              >
                all ›
              </Link>
            }
          />
          {workLog.events.length === 0 ? (
            <EmptyState
              illustration={<Tavik pose="working" size="md" alt="" />}
              title="Nothing yet"
              description="Tavik writes a line every time it checks a rule or spots a change."
            />
          ) : (
            <ul className="space-y-0.5 px-3 pb-4">
              {workLog.events.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md px-3 py-2"
                >
                  <Timestamp at={entry.at} className="shrink-0" />
                  <span className="min-w-0 flex-1 text-[13px] text-ink-muted">
                    {entry.summary}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}
