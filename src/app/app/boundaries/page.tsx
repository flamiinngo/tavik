import Link from "next/link";

import { Tavik } from "@/components/mascot/Tavik";
import { Card, HealthBar, StatusRow } from "@/components/ui/Card";
import { Button, EmptyState } from "@/components/ui/primitives";
import { loadSecurityState } from "@/lib/server/tavik";

export const metadata = { title: "Rules" };
export const dynamic = "force-dynamic";

export default async function BoundariesPage() {
  const state = await loadSecurityState();
  const open = state.counts.violated;

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between px-6 lg:px-8">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">Your rules</h1>
        <Link href="/app/boundaries/new">
          <Button size="sm" variant="primary">
            Write a rule
          </Button>
        </Link>
      </header>

      <main className="w-full space-y-5 px-6 pb-12 lg:px-8">
        <Card raised>
          <div className="grid gap-8 p-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="min-w-0">
              <h2 className="text-display-sm text-ink">
                <span className="block tabular-nums">
                  {state.counts.verified} of {state.boundaries.length}
                </span>
                <span className="block text-ink-subtle">rules are holding.</span>
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-soft">
                A rule is something you&apos;ve said must never happen. Tavik re-checks
                each one against what&apos;s actually installed, and proves the answer
                with a chain you can follow.
              </p>
            </div>

            <div className="w-full rounded-md bg-inset p-5 lg:w-64">
              <HealthBar counts={state.counts} />
              <p className="mt-4 text-[13px] leading-relaxed text-ink-subtle">
                {open > 0
                  ? `${open} ${open === 1 ? "rule has" : "rules have"} a way through right now.`
                  : "Nothing can currently get through."}
              </p>
            </div>
          </div>
        </Card>

        <Card>
          {state.boundaries.length === 0 ? (
            <EmptyState
              illustration={<Tavik pose="standby" size="lg" alt="" />}
              title="No rules yet"
              description="Tell Tavik what must never happen, and it will start proving it — continuously."
              action={
                <Link href="/app/boundaries/new">
                  <Button variant="primary">Write your first rule</Button>
                </Link>
              }
            />
          ) : (
            <ul className="space-y-1 p-3">
              {state.boundaries.map(({ boundary, verification }) => (
                <li key={boundary.id}>
                  <StatusRow
                    status={verification?.status ?? "unknown"}
                    title={boundary.name}
                    subtitle={verification?.failureReason ?? boundary.statement}
                    trailing={
                      verification
                        ? verification.paths.length === 0
                          ? "no way in"
                          : `${verification.paths.length}${verification.truncated ? "+" : ""} ways in`
                        : "—"
                    }
                    href={`/app/boundaries/${boundary.id}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}
