import Link from "next/link";

import { EmptyWorkspace } from "@/components/app/EmptyWorkspace";
import { SetupProgress } from "@/components/app/SetupProgress";
import { lastSweepAt } from "@/lib/engine/scheduler";
import { DemoControl } from "@/components/demo/DemoControl";
import { PathTrace } from "@/components/graph/PathTrace";
import { SecurityGraph } from "@/components/graph/SecurityGraph";
import { Tavik } from "@/components/mascot/Tavik";
import { Card, CardHeader, GroupLabel, HealthBar, StatusRow } from "@/components/ui/Card";
import { STATUS_PRESENTATION, StatusChip } from "@/components/ui/Status";
import { Button, EmptyState, Timestamp } from "@/components/ui/primitives";
import { buildSubgraph, chokepoints } from "@/lib/domain/subgraph";
import { currentOperator } from "@/lib/server/operator";
import {
  demoPublisher,
  isWorkspaceEmpty,
  loadSecurityState,
  loadSetupProgress,
  loadWorkLog,
  quarantinedPublishers,
} from "@/lib/server/tavik";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";



/**
 * How long ago, in words.
 *
 * The one place Tavik uses relative time. Timestamps elsewhere are evidence and
 * stay absolute, but "when did you last look?" is a question about recency, and
 * "3 minutes ago" answers it better than an ISO string.
 */
function describeAge(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 45) return "moments ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * A measurement tile.
 *
 * Figure above label, because at this size the number is the thing being
 * scanned and the label only qualifies it. Reversing them makes a row of tiles
 * read as a form.
 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    // Bare, divided by a hairline rather than boxed. Four cards here made four
    // more edges on a page that already had too many, and a number does not need
    // a container to be legible — it needs space and something to sit against.
    // The divider rules have to know about the wrap: at two columns the third
    // tile starts a row and must not carry a leading edge either.
    <div className="border-l border-line px-5 odd:border-l-0 odd:pl-0 sm:odd:border-l sm:odd:pl-5 sm:first:border-l-0 sm:first:pl-0">
      <dd className="text-[22px] font-semibold leading-none tracking-tight tabular-nums text-ink">
        {value}
      </dd>
      <dt className="mt-2 text-[12.5px] leading-snug text-ink-subtle">{label}</dt>
    </div>
  );
}

export default async function OverviewPage() {
  // A workspace with nothing scanned gets the empty state, not empty panels.
  if (await isWorkspaceEmpty()) {
    return (
      <>
        <header className="flex h-16 shrink-0 items-center px-6 lg:px-8">
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">Overview</h1>
        </header>
        <main className="w-full">
          <EmptyWorkspace />
        </main>
      </>
    );
  }

  const operator = await currentOperator();
  const [state, workLog, quarantined, lastSweep, setup, demoTarget] = await Promise.all([
    loadSecurityState(),
    loadWorkLog(5),
    quarantinedPublishers(),
    lastSweepAt(),
    loadSetupProgress(operator.identified),
    demoPublisher(),
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
        {/* States when it actually last ran, not that it is always running.
            The previous copy claimed continuous checking while nothing was
            scheduled — the exact kind of overstatement this product refuses. */}
        <span className="hidden items-center gap-2 rounded-pill bg-card px-3 py-1.5 text-[12.5px] text-ink-soft shadow-card sm:inline-flex">
          <span className="size-1.5 animate-breathe rounded-pill bg-safe" aria-hidden />
          {lastSweep
            ? `Last checked ${describeAge(lastSweep)}`
            : "First check starting…"}
        </span>
      </header>

      <main className="w-full space-y-5 px-6 pb-12 lg:px-8">
        {/* Above everything, until it is finished. Somebody who has not wired
            Tavik into CI has a half-installed product, and that matters more
            than today's numbers. */}
        <SetupProgress progress={setup} />

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

        {/* ── The answer ──────────────────────────────────────────────────────
            Deliberately NOT in a card.

            Putting the headline in a rounded rectangle like everything else is
            what made this read as a template: five identical full-width boxes
            stacked down the page, none of them louder than the others. The
            answer belongs directly on the paper, with the cards below it
            grouping the detail. That contrast — bare hero, boxed lists — is
            most of what separates an editorial layout from a dashboard kit. */}
        {headline && verification ? (
          <section className="overflow-hidden">
            <div className="grid gap-8 py-6 lg:grid-cols-[auto_1fr_auto] lg:items-center lg:gap-12">
              <Tavik
                pose={status === "violated" ? "alert" : "verified"}
                size="xl"
                priority
                alt=""
                className="mx-auto lg:mx-0"
              />

              <div className="min-w-0 text-center lg:text-left">
                <StatusChip status={status} />

                {/* Stacked over two lines at display size. The answer should
                    carry across a room; a headline the size of a form label is
                    what made this read as a settings screen. */}
                <h2 className="mt-5 text-display-sm text-ink sm:text-display">
                  {status === "violated" ? (
                    <>
                      <span className="block tabular-nums">
                        {verification.paths.length}
                        {verification.truncated ? "+" : ""} ways
                      </span>
                      <span className="block text-ink-subtle">into production.</span>
                    </>
                  ) : (
                    <>
                      <span className="block">Nothing</span>
                      <span className="block text-ink-subtle">can get in.</span>
                    </>
                  )}
                </h2>

                <p className="mx-auto mt-6 max-w-md text-[15px] leading-relaxed text-ink-soft lg:mx-0">
                  {headline.boundary.statement}
                </p>

                <div className="mt-8 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
                  <Link href={`/app/boundaries/${headline.boundary.id}`}>
                    <Button variant="primary" size="lg">
                      {status === "violated" ? "Show me how" : "See the proof"}
                      <span aria-hidden>↗</span>
                    </Button>
                  </Link>
                  <span className="text-[13px] text-ink-faint">
                    proven in {verification.elapsedMs.toFixed(0)}ms
                  </span>
                </div>
              </div>

              <div className="w-full rounded-md bg-card p-6 shadow-card lg:w-64">
                <HealthBar counts={state.counts} />
                <p className="mt-4 border-t border-line pt-4 text-[12.5px] leading-relaxed text-ink-subtle">
                  {openCount > 0
                    ? `${openCount} of your ${state.boundaries.length} rules ${openCount === 1 ? "has" : "have"} a way through right now.`
                    : "Every rule you've written is currently holding."}
                </p>
              </div>
            </div>

            {/* A compact measurement strip. Small tiles under a large headline
                give the eye somewhere to land between the display type and the
                dense panels below, instead of dropping straight from 64px into
                a graph. */}
            <dl className="grid grid-cols-2 gap-y-6 border-t border-line pt-6 sm:grid-cols-4">
              <Stat
                label="Publishers who can reach you"
                value={verification.sourceCount.toLocaleString()}
              />
              <Stat
                label="Things being watched"
                value={(state.entityCount ?? 0).toLocaleString()}
              />
              <Stat
                label="Rules holding"
                value={`${state.counts.verified} of ${state.boundaries.length}`}
              />
              <Stat label="Time to prove" value={`${verification.elapsedMs.toFixed(0)}ms`} />
            </dl>
          </section>
        ) : null}

        {/* ── Try it ──────────────────────────────────────────────────────── */}
        {/* Only when there is somebody real to act on. A control offering to
            review an account that is not in the graph fails the moment it is
            pressed, in front of whoever is being shown the product. */}
        {demoTarget ? (
          <DemoControl
            publisher={demoTarget}
            isQuarantined={quarantined.includes(demoTarget)}
          />
        ) : null}

        {/* ── Graph + weakest links ───────────────────────────────────────── */}
        {subgraph && subgraph.nodes.length > 0 ? (
          <div className="grid items-stretch gap-5 xl:grid-cols-[1fr_360px]">
            <Card className="flex min-w-0 flex-col">
              <CardHeader
                title="How they get in"
                subtitle="Everyone on the left can reach your service on the right. Hover any dot to follow only its routes."
              />
              <div className="px-6 pb-6">
                <SecurityGraph subgraph={subgraph} />
              </div>
            </Card>

            <Card className="flex flex-col">
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
            <div className="grid items-stretch gap-4 px-6 pb-6 md:grid-cols-2 2xl:grid-cols-3">
              {verification.paths
                .slice()
                .sort((a, b) => a.length - b.length)
                .slice(0, 3)
                .map((path, index) => (
                  <div
                    key={index}
                    className="animate-rise h-full rounded-md bg-inset p-5"
                    style={{ animationDelay: `${index * 70}ms` }}
                  >
                    <PathTrace path={path} ordinal={index + 1} />
                  </div>
                ))}
            </div>
          </Card>
        ) : null}

        {/* ── Rules + work log ──────────────────────────────────────────────
            `items-stretch` so the two cards match height. Letting each size to
            its own content left one full and the other two-thirds empty beside
            it, which is most of what made the page look like scattered boxes. */}
        <div className="grid items-stretch gap-5 lg:grid-cols-2">
          <Card className="flex flex-col">
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

          <Card className="flex flex-col">
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
