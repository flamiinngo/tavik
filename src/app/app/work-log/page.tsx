import { Tavik } from "@/components/mascot/Tavik";
import { Card } from "@/components/ui/Card";
import { EmptyState, Timestamp } from "@/components/ui/primitives";
import { loadWorkLog } from "@/lib/server/tavik";

export const metadata = { title: "Work log" };
export const dynamic = "force-dynamic";

/**
 * What Tavik has done.
 *
 * Append-only, and every line was produced by something that actually ran — a
 * check, a change, a fix a human approved. Nothing is written to make the page
 * look busy, which is why a quiet log is a good sign rather than a broken one.
 */
export default async function WorkLogPage() {
  const { events, connectionError } = await loadWorkLog(200);

  // Grouped by day so a long log stays navigable without a date filter.
  const byDay = new Map<string, typeof events>();
  for (const entry of events) {
    const day = new Date(entry.at).toISOString().slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  }

  return (
    <>
      <header className="flex h-16 shrink-0 items-center px-6 lg:px-8">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">Work log</h1>
      </header>

      <main className="w-full space-y-5 px-6 pb-12 lg:px-8">
        <Card raised>
          <div className="grid gap-8 p-8 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-10">
            <Tavik pose="working" size="lg" alt="" className="mx-auto lg:mx-0" />
            <div className="min-w-0 text-center lg:text-left">
              <h2 className="text-display-sm text-ink">
                <span className="block">Tavik works</span>
                <span className="block text-ink-subtle">whether you watch or not.</span>
              </h2>
              <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-ink-soft lg:mx-0">
                Every line below is something that actually happened — a rule checked, a
                change noticed, a fix approved. Nothing is written here to fill space.
              </p>
            </div>
          </div>
        </Card>

        {connectionError ? (
          <Card className="p-6">
            <p className="text-[15px] font-medium text-ink">Couldn&apos;t read the log</p>
            <p className="mt-1.5 text-[13.5px] text-ink-soft">{connectionError}</p>
          </Card>
        ) : null}

        {events.length === 0 ? (
          <Card>
            <EmptyState
              illustration={<Tavik pose="standby" size="lg" alt="" />}
              title="Nothing recorded yet"
              description="Run a check and Tavik will start keeping a record of what it finds."
            />
          </Card>
        ) : (
          [...byDay.entries()].map(([day, entries]) => (
            <Card key={day}>
              <p className="px-6 pt-5 text-[13px] font-medium text-ink-subtle">{day}</p>
              <ul className="space-y-1 p-3">
                {entries.map((entry) => (
                  <li key={entry.id} className="rounded-md px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <p className="min-w-0 flex-1 text-[14.5px] leading-relaxed text-ink">
                        {entry.summary}
                      </p>
                      <Timestamp at={entry.at} className="shrink-0" />
                    </div>
                    <p className="mt-1 text-[12.5px] text-ink-subtle">
                      {/* Who did it matters: Tavik observes and proposes, people
                          approve. An audit trail that cannot tell them apart is
                          not much of an audit trail. */}
                      {entry.actor.kind === "tavik"
                        ? "Tavik"
                        : entry.actor.kind === "user"
                          ? entry.actor.name
                          : entry.actor.reason}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ))
        )}
      </main>
    </>
  );
}
