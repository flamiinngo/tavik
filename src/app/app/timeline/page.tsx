import Link from "next/link";

import { Tavik } from "@/components/mascot/Tavik";
import { Card } from "@/components/ui/Card";
import { STATUS_PRESENTATION } from "@/components/ui/Status";
import { EmptyState } from "@/components/ui/primitives";
import type { BoundaryStatus } from "@/lib/domain/boundary";
import type { ChangeEvent, StatusChangeDetail } from "@/lib/domain/change";
import { loadWorkLog, loadRules } from "@/lib/server/tavik";

export const metadata = { title: "Timeline" };
export const dynamic = "force-dynamic";

/**
 * When each rule was true, and when it stopped being.
 *
 * The work log records everything Tavik did; this shows only the moments a
 * rule's answer actually changed. That distinction is the whole point — a
 * timeline of every check is a wall of noise, while a timeline of transitions is
 * the history of the estate.
 *
 * Rendered per rule rather than as one merged stream, because the question
 * people arrive with is "when did *this* break?", and a merged stream makes that
 * a search rather than a glance.
 */
export default async function TimelinePage() {
  const [{ events, connectionError }, rules] = await Promise.all([
    loadWorkLog(400),
    loadRules(),
  ]);

  const transitions = events.filter(
    (event) => event.type === "boundary.status_changed",
  );

  const byRule = new Map<string, ChangeEvent[]>();
  for (const event of transitions) {
    const id = event.boundaryId ?? "unknown";
    byRule.set(id, [...(byRule.get(id) ?? []), event]);
  }

  const ruleName = new Map(rules.map((rule) => [rule.id, rule.name]));

  return (
    <>
      <header className="flex h-16 shrink-0 items-center px-6 lg:px-8">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">Timeline</h1>
      </header>

      <main className="w-full space-y-5 px-6 pb-12 lg:px-8">
        <div className="py-6">
          <h2 className="text-display-sm text-ink">
            <span className="block">Every time</span>
            <span className="block text-ink-subtle">the answer changed.</span>
          </h2>
          <p className="mt-6 max-w-lg text-[16px] leading-[1.6] text-ink-soft">
            Not every check — only the moments a rule stopped being true, or
            became true again. Each one is a real transition Tavik recorded when
            it happened.
          </p>
        </div>

        {connectionError ? (
          <Card className="p-6">
            <p className="text-[15px] font-medium text-ink">Couldn&apos;t read the history</p>
            <p className="mt-1.5 text-[13.5px] text-ink-soft">{connectionError}</p>
          </Card>
        ) : null}

        {transitions.length === 0 ? (
          <Card>
            <EmptyState
              illustration={<Tavik pose="standby" size="lg" alt="" />}
              title="Nothing has changed yet"
              description="Tavik records a moment here whenever a rule stops being true, or becomes true again. Nothing has moved so far."
            />
          </Card>
        ) : (
          [...byRule.entries()].map(([ruleId, ruleEvents]) => (
            <Card key={ruleId}>
              <div className="flex items-baseline justify-between gap-4 px-6 pt-6 pb-2">
                <h3 className="text-[17px] font-semibold tracking-tight text-ink">
                  {ruleName.get(ruleId) ?? ruleId}
                </h3>
                <Link
                  href={`/app/boundaries/${ruleId}`}
                  className="text-[13px] text-ink-subtle transition-colors hover:text-ink"
                >
                  Open →
                </Link>
              </div>

              <ol className="px-6 pb-6">
                {ruleEvents.map((event, index) => {
                  const detail =
                    event.detail?.kind === "status_change"
                      ? (event.detail as StatusChangeDetail)
                      : null;
                  const to = (detail?.to ?? "unknown") as BoundaryStatus;
                  const presentation = STATUS_PRESENTATION[to];
                  const isLast = index === ruleEvents.length - 1;

                  return (
                    <li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
                      {/* A continuous rail so the eye reads one history rather
                          than a stack of separate entries. */}
                      {!isLast ? (
                        <span
                          className="absolute left-[7px] top-5 h-full w-px bg-line-strong"
                          aria-hidden
                        />
                      ) : null}

                      <span
                        className={`mt-1.5 size-[15px] shrink-0 rounded-pill ring-4 ring-card ${presentation.dot}`}
                        aria-hidden
                      />

                      <div className="min-w-0 flex-1">
                        <p className="text-[14.5px] leading-snug text-ink">
                          {event.summary}
                        </p>
                        <p className="mt-1 font-mono text-[12px] tabular-nums text-ink-faint">
                          {new Date(event.at).toISOString().replace("T", " ").slice(0, 19)}
                          {detail ? ` · ${detail.from} → ${detail.to}` : ""}
                        </p>

                        {detail && detail.appearedPaths.length > 0 ? (
                          <div className="mt-3 space-y-1.5">
                            {detail.appearedPaths.slice(0, 3).map((path) => (
                              <p
                                key={path.signature}
                                className="overflow-x-auto whitespace-nowrap rounded-sm bg-inset px-3 py-2 font-mono text-[12px] text-ink-soft"
                              >
                                {path.hops[0]?.from.split(":").slice(2).join(":")}
                                {path.hops.map((hop, i) => (
                                  <span key={i}>
                                    <span className="text-alert"> → </span>
                                    {hop.to.split(":").slice(2).join(":")}
                                  </span>
                                ))}
                              </p>
                            ))}
                            {detail.appearedPaths.length > 3 ? (
                              <p className="text-[12.5px] text-ink-faint">
                                and {detail.appearedPaths.length - 3} more
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Card>
          ))
        )}
      </main>
    </>
  );
}
