import Link from "next/link";

import { Tavik } from "@/components/mascot/Tavik";
import { STATUS_PRESENTATION } from "@/components/ui/Status";
import { Button, EmptyState } from "@/components/ui/primitives";
import type { BoundaryStatus } from "@/lib/domain/boundary";
import { loadSecurityState } from "@/lib/server/tavik";

export const metadata = { title: "Boundaries" };
export const dynamic = "force-dynamic";

const RAIL: Record<BoundaryStatus, string> = {
  verified: "bg-verified",
  violated: "bg-violated",
  investigating: "bg-investigating",
  unknown: "bg-unknown",
};

export default async function BoundariesPage() {
  const state = await loadSecurityState();

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
        <h1 className="text-sm font-medium text-ink">Boundaries</h1>
        <span className="font-mono text-2xs text-ink-faint">
          {state.boundaries.length} declared
        </span>
      </header>

      <main className="min-w-0 flex-1">
        <div className="border-b border-line px-6 py-5">
          <p className="max-w-2xl text-sm text-ink-muted">
            A boundary is a claim about what must never become true. Tavik
            re-checks each one against current state and proves the answer with a
            concrete path.
          </p>
        </div>

        {state.boundaries.length === 0 ? (
          <EmptyState
            illustration={<Tavik pose="standby" size="lg" alt="" />}
            title="Nothing to verify yet"
            description="Declare what must never happen and Tavik will start proving it, continuously."
            action={<Button variant="primary">Declare a boundary</Button>}
          />
        ) : (
          <ul>
            {state.boundaries.map(({ boundary, verification }) => {
              const status = verification?.status ?? "unknown";
              return (
                <li key={boundary.id} className="border-b border-line">
                  <Link
                    href={`/app/boundaries/${boundary.id}`}
                    className="flex items-stretch transition-colors hover:bg-raised/40"
                  >
                    <span className={`w-0.5 shrink-0 ${RAIL[status]}`} aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-3">
                          <span className="text-sm text-ink">{boundary.name}</span>
                          <span
                            className={`font-mono text-2xs uppercase tracking-wider ${STATUS_PRESENTATION[status].text}`}
                          >
                            {status}
                          </span>
                        </div>
                        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-subtle">
                          {verification?.failureReason ?? boundary.statement}
                        </p>
                      </div>
                      <div className="shrink-0 text-right font-mono text-2xs tabular-nums text-ink-faint">
                        <p>
                          {verification
                            ? `${verification.paths.length} route${verification.paths.length === 1 ? "" : "s"}`
                            : "—"}
                        </p>
                        <p className="mt-0.5">
                          {verification ? `${verification.elapsedMs.toFixed(0)}ms` : ""}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
