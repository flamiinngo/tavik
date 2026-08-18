import Link from "next/link";
import { notFound } from "next/navigation";

import { RemediationPanel } from "@/components/boundary/RemediationPanel";
import { PathTrace } from "@/components/graph/PathTrace";
import { SecurityGraph } from "@/components/graph/SecurityGraph";
import { Tavik } from "@/components/mascot/Tavik";
import { Card, CardHeader, StatusRow } from "@/components/ui/Card";
import { STATUS_PRESENTATION, StatusChip } from "@/components/ui/Status";
import { EmptyState, Timestamp } from "@/components/ui/primitives";
import type { StatusChangeDetail } from "@/lib/domain/change";
import { buildSubgraph, chokepoints } from "@/lib/domain/subgraph";
import { proposeRemediations } from "@/lib/engine/remediation";
import { loadBoundary } from "@/lib/server/tavik";

export const dynamic = "force-dynamic";

/**
 * One rule, in full.
 *
 * Ordered the way an investigation actually runs: is it true, why not, what
 * would fix it, what changed, and how it was checked. Someone arriving from an
 * alert should be able to read straight down and reach a decision without
 * navigating anywhere else.
 *
 * Every route is shown rather than a sample, because this is the evidence page.
 * Summarising here would be asking someone to act on a partial picture.
 */
export default async function BoundaryPage({ params }: PageProps<"/app/boundaries/[id]">) {
  const { id } = await params;
  const data = await loadBoundary(id);
  if (!data) notFound();

  const { boundary, verification, history, connectionError } = data;
  const status = verification?.status ?? "unknown";
  const presentation = STATUS_PRESENTATION[status];

  const lastChange = history.find((event) => event.type === "boundary.status_changed");
  const changeDetail =
    lastChange?.detail?.kind === "status_change"
      ? (lastChange.detail as StatusChangeDetail)
      : null;

  const subgraph =
    verification && verification.paths.length > 0
      ? buildSubgraph(verification.paths)
      : null;
  const pinch = subgraph ? chokepoints(subgraph, 4) : [];

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-3 px-6 lg:px-8">
        <Link
          href="/app"
          className="text-[13px] text-ink-subtle transition-colors hover:text-ink"
        >
          Overview
        </Link>
        <span className="text-ink-faint">/</span>
        <span className="truncate text-[13px] font-medium text-ink">{boundary.name}</span>
      </header>

      <main className="w-full space-y-5 px-6 pb-12 lg:px-8">
        {/* ── The rule, and whether it holds ──────────────────────────────── */}
        <Card raised>
          <div className="grid gap-8 p-8 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-10">
            <Tavik
              pose={status === "violated" ? "alert" : status === "verified" ? "verified" : "standby"}
              size="lg"
              priority
              alt=""
              className="mx-auto lg:mx-0"
            />

            <div className="min-w-0 text-center lg:text-left">
              <StatusChip status={status} />
              <h1 className="mt-5 text-display-sm text-ink">
                {status === "violated" && verification ? (
                  <>
                    <span className="block tabular-nums">
                      {verification.paths.length}
                      {verification.truncated ? "+" : ""} ways
                    </span>
                    <span className="block text-ink-subtle">through this rule.</span>
                  </>
                ) : (
                  <>
                    <span className="block">{boundary.name}</span>
                    <span className="block text-ink-subtle">{presentation.label.toLowerCase()}.</span>
                  </>
                )}
              </h1>
              <p className="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-ink-soft lg:mx-0">
                {boundary.statement}
              </p>

              {verification?.failureReason ? (
                <p className="mx-auto mt-4 max-w-lg rounded-sm bg-idle-soft px-4 py-3 text-[13.5px] leading-relaxed text-ink-soft lg:mx-0">
                  {verification.failureReason}
                </p>
              ) : null}
              {connectionError ? (
                <p className="mx-auto mt-4 max-w-lg rounded-sm bg-idle-soft px-4 py-3 text-[13.5px] text-ink-soft lg:mx-0">
                  {connectionError}
                </p>
              ) : null}
            </div>
          </div>

          {verification ? (
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-b-lg bg-line sm:grid-cols-4">
              <Figure label="What it checks from" value={boundary.source.description} />
              <Figure label="What it protects" value={boundary.target.description} />
              <Figure label="How far it looks" value={`up to ${boundary.maxHops} steps`} />
              <Figure label="Time to prove" value={`${verification.elapsedMs.toFixed(0)}ms`} />
            </dl>
          ) : null}
        </Card>

        {/* ── How to fix it ───────────────────────────────────────────────── */}
        {status === "violated" && verification ? (
          <Card>
            <CardHeader
              title="How to fix it"
              subtitle="Each option removes one real relationship. Tavik applies it, then re-runs the exact check that found the problem and shows you what's left."
            />
            <div className="px-6 pb-6">
              <RemediationPanel
                boundaryId={boundary.id}
                proposals={proposeRemediations(boundary, verification, 3)}
              />
            </div>
          </Card>
        ) : null}

        {/* ── The picture ─────────────────────────────────────────────────── */}
        {subgraph ? (
          <div className="grid items-stretch gap-5 xl:grid-cols-[1fr_360px]">
            <Card className="flex min-w-0 flex-col">
              <CardHeader
                title="How they get in"
                subtitle="Hover any dot to follow only its routes."
              />
              <div className="px-6 pb-6">
                <SecurityGraph subgraph={subgraph} />
              </div>
            </Card>

            <Card className="flex flex-col">
              <CardHeader
                title="Weakest links"
                subtitle="Cut the top one to remove the most risk in a single change."
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

        {/* ── The evidence ────────────────────────────────────────────────── */}
        {verification && verification.paths.length > 0 ? (
          <Card>
            <CardHeader
              title="Every way in"
              subtitle="Each is a real chain of relationships. You can check every link yourself."
              action={
                <span className="text-[13px] text-ink-subtle">
                  {verification.paths.length}
                  {verification.truncated ? "+" : ""} routes · shortest{" "}
                  {Math.min(...verification.paths.map((p) => p.length))} steps
                </span>
              }
            />
            <div className="grid items-stretch gap-4 px-6 pb-6 md:grid-cols-2 2xl:grid-cols-3">
              {verification.paths
                .slice()
                .sort((a, b) => a.length - b.length)
                .map((path, index) => (
                  <div key={index} className="h-full rounded-md bg-inset p-5">
                    <PathTrace path={path} ordinal={index + 1} />
                  </div>
                ))}
            </div>
          </Card>
        ) : null}

        {/* ── What changed ────────────────────────────────────────────────── */}
        {changeDetail ? (
          <Card>
            <CardHeader title="What changed" subtitle={lastChange?.summary} />
            <div className="px-6 pb-6">
              <p className="text-[13px] text-ink-subtle">
                {changeDetail.from} → {changeDetail.to}
                {lastChange ? ` · ${new Date(lastChange.at).toISOString().slice(0, 16).replace("T", " ")}` : ""}
              </p>
              {changeDetail.appearedPaths.length > 0 ? (
                <ul className="mt-4 space-y-2">
                  {changeDetail.appearedPaths.slice(0, 5).map((path) => (
                    <li
                      key={path.signature}
                      className="overflow-x-auto rounded-sm bg-inset px-4 py-2.5"
                    >
                      <span className="whitespace-nowrap font-mono text-[12.5px] text-ink-soft">
                        {path.hops[0]?.from.split(":").slice(2).join(":")}
                        {path.hops.map((hop, i) => (
                          <span key={i}>
                            <span className="text-alert"> → </span>
                            {hop.to.split(":").slice(2).join(":")}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Card>
        ) : null}

        {/* ── History ─────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="History"
            subtitle="Every check Tavik has run against this rule."
          />
          {history.length === 0 ? (
            <EmptyState
              illustration={<Tavik pose="working" size="md" alt="" />}
              title="No history yet"
              description="Tavik writes an entry each time it checks this rule."
            />
          ) : (
            <ul className="space-y-1 px-3 pb-5">
              {history.map((entry) => (
                <li key={entry.id} className="rounded-md px-4 py-2.5">
                  <p className="text-[14px] leading-relaxed text-ink-soft">{entry.summary}</p>
                  <Timestamp at={entry.at} className="mt-1 block" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}

/** One fact in the strip beneath the headline. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-6 py-5">
      <dt className="text-[12.5px] text-ink-subtle">{label}</dt>
      <dd className="mt-1 text-[14px] font-medium leading-snug text-ink">{value}</dd>
    </div>
  );
}
