import Link from "next/link";

import { DemoControl } from "@/components/demo/DemoControl";
import { PathTrace } from "@/components/graph/PathTrace";
import { SecurityGraph } from "@/components/graph/SecurityGraph";
import { Tavik } from "@/components/mascot/Tavik";
import { Card, CardHeader, GroupLabel, HealthBar, StatusRow } from "@/components/ui/Card";
import { STATUS_PRESENTATION, StatusChip } from "@/components/ui/Status";
import { Button, EmptyState, Timestamp } from "@/components/ui/primitives";
import { buildSubgraph, chokepoints } from "@/lib/domain/subgraph";
import { loadSecurityState, loadWorkLog, quarantinedPublishers } from "@/lib/server/tavik";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

/** The publisher the demo control acts on — small enough exposure that a couple
 *  of changes genuinely close the boundary. */
const DEMO_PUBLISHER = "sebmarkbage";

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
  const openCount = state.counts.violated;

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between gap-6 px-6 lg:px-8">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">Overview</h1>
          <p className="text-[13px] text-ink-subtle">
            {state.entityCount !== null
              ? `Watching ${state.entityCount.toLocaleString()} things across your supply chain`
              : "State unavailable"}
          </p>
        </div>
        <span className="hidden items-center gap-2 rounded-pill bg-card px-3 py-1.5 text-[12.5px] text-ink-soft shadow-card sm:inline-flex">
          <span className="size-1.5 animate-breathe rounded-pill bg-safe" aria-hidden />
          Checking continuously
        </span>
      </header>

      <main className="w-full space-y-5 px-6 pb-12 lg:px-8">
        {state.connectionError ? (
          <Card className="p-6">
            <StatusChip status="unknown" />
            <p className="mt-3 text-[17px] font-semibold text-ink">
              Tavik can&apos;t read your security state
            </p>
            <p className="mt-1.5 max-w-2xl text-[14px] text-ink-soft">
              Every rule is marked <strong className="text-ink">not checked</strong> — which
              is not the same as safe.
            </p>
          </Card>
        ) : null}

        {/* ── The answer ──────────────────────────────────────────────────── */}
        {headline && verification ? (
          <Card raised className="overflow-hidden">
            <div className="grid gap-8 p-8 lg:grid-cols-[auto_1fr_auto] lg:items-center lg:gap-10">
              <Tavik
                pose={status === "violated" ? "alert" : "verified"}
                size="xl"
                priority
                alt=""
                className="mx-auto lg:mx-0"
              />

              <div className="min-w-0 text-center lg:text-left">
                <StatusChip status={status} />
                <h2 className="mt-4 text-[40px] font-semibold leading-[1.05] tracking-tight text-ink sm:text-[52px]">
                  {status === "violated" ? (
                    <>
                      {verification.paths.length}
                      {verification.truncated ? "+" : ""} ways in
                    </>
                  ) : (
                    presentation.headline
                  )}
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-ink-soft lg:mx-0">
                  {headline.boundary.statement}
                </p>

                <div className="mt-7 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                  <Link href={`/app/boundaries/${headline.boundary.id}`}>
                    <Button variant="primary" size="lg">
                      {status === "violated" ? "Show me how, and fix it" : "See the proof"}
                    </Button>
                  </Link>
                  <span className="text-[13px] text-ink-faint">
                    checked in {verification.elapsedMs.toFixed(0)}ms
                  </span>
                </div>
              </div>

              <div className="w-full lg:w-56">
                <HealthBar counts={state.counts} />
                {openCount > 0 ? (
                  <p className="mt-4 text-[13px] leading-relaxed text-ink-subtle">
                    {openCount} of your {state.boundaries.length} rules {openCount === 1 ? "has" : "have"}{" "}
                    a way through right now.
                  </p>
                ) : (
                  <p className="mt-4 text-[13px] leading-relaxed text-ink-subtle">
                    Every rule you&apos;ve written is currently holding.
                  </p>
                )}
              </div>
            </div>
          </Card>
        ) : null}

        {/* ── Try it ──────────────────────────────────────────────────────── */}
        <DemoControl
          publisher={DEMO_PUBLISHER}
          isQuarantined={quarantined.includes(DEMO_PUBLISHER)}
        />

        {/* ── Graph + weakest links ───────────────────────────────────────── */}
        {subgraph && subgraph.nodes.length > 0 ? (
          <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
            <Card className="min-w-0">
              <CardHeader
                title="How they get in"
                subtitle="Everyone on the left can reach your service on the right. Hover any dot to follow only its routes."
              />
              <div className="px-6 pb-6">
                <SecurityGraph subgraph={subgraph} />
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Weakest links"
                subtitle="Cut the top one and you remove the most risk with a single change."
              />
              <ul className="space-y-1 px-3 pb-5">
                {pinch.map((node) => (
                  <li key={node.id}>
                    <StatusRow
                      status="violated"
                      title={node.label}
                      subtitle={`${node.kind.toLowerCase()} · on ${node.routeCount} routes`}
                      trailing={`${node.routeCount}`}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        ) : null}

        {/* ── Evidence ────────────────────────────────────────────────────── */}
        {verification && verification.paths.length > 0 ? (
          <Card>
            <CardHeader
              title="The shortest ways in"
              subtitle="Each one is a real chain. You can check every link yourself."
              action={
                <Link href={`/app/boundaries/${headline!.boundary.id}`}>
                  <Button size="sm">
                    See all {verification.paths.length}
                    {verification.truncated ? "+" : ""}
                  </Button>
                </Link>
              }
            />
            <div className="grid gap-4 px-6 pb-6 md:grid-cols-2 2xl:grid-cols-3">
              {verification.paths
                .slice()
                .sort((a, b) => a.length - b.length)
                .slice(0, 3)
                .map((path, index) => (
                  <div
                    key={index}
                    className="animate-rise rounded-md bg-inset p-5"
                    style={{ animationDelay: `${index * 70}ms` }}
                  >
                    <PathTrace path={path} ordinal={index + 1} />
                  </div>
                ))}
            </div>
          </Card>
        ) : null}

        {/* ── Rules + work log ────────────────────────────────────────────── */}
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Your rules"
              subtitle="Things you've said must never happen."
              action={
                <Link href="/app/boundaries">
                  <Button size="sm">All</Button>
                </Link>
              }
            />
            <ul className="space-y-1 px-3 pb-5">
              {state.boundaries.map(({ boundary, verification: check }) => (
                <li key={boundary.id}>
                  <StatusRow
                    status={check?.status ?? "unknown"}
                    title={boundary.name}
                    subtitle={check?.failureReason ?? boundary.statement}
                    trailing={
                      check
                        ? check.paths.length === 0
                          ? "none"
                          : `${check.paths.length}${check.truncated ? "+" : ""}`
                        : "—"
                    }
                    href={`/app/boundaries/${boundary.id}`}
                  />
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="What Tavik has been doing"
              subtitle="It works whether or not anyone is watching."
              action={
                <Link href="/app/work-log">
                  <Button size="sm">All</Button>
                </Link>
              }
            />
            {workLog.events.length === 0 ? (
              <EmptyState
                illustration={<Tavik pose="working" size="md" alt="" />}
                title="Nothing yet"
                description="Tavik writes a line every time it checks a rule or notices a change."
              />
            ) : (
              <ul className="space-y-1 px-3 pb-5">
                {workLog.events.map((entry) => (
                  <li key={entry.id} className="rounded-md px-4 py-2.5">
                    <p className="text-[14px] leading-relaxed text-ink-soft">
                      {entry.summary}
                    </p>
                    <Timestamp at={entry.at} className="mt-1 block" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </main>
    </>
  );
}
