import { Tavik } from "@/components/mascot/Tavik";
import { WatchList } from "@/components/watches/WatchList";
import { lastSyncAt } from "@/lib/engine/scheduler";
import { tavik } from "@/lib/server/tavik";
import type { WatchedRepo } from "@/lib/engine/watched-repos";

export const metadata = { title: "Watched repositories" };
export const dynamic = "force-dynamic";

/**
 * What Tavik re-reads without being asked.
 *
 * Rules were already re-checked every minute, but against a graph that only
 * changed when somebody scanned. So Tavik noticed a rule breaking within a
 * minute of the graph changing, and never noticed the graph needing to change at
 * all — a new dependency stayed invisible until a human intervened. Watching a
 * repository removes that last manual step.
 */
export default async function WatchesPage() {
  let watches: WatchedRepo[] = [];
  let error: string | null = null;

  try {
    watches = await tavik().watches.list();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Couldn't read your watches.";
  }

  const lastSync = await lastSyncAt();
  const failing = watches.filter((watched) => watched.lastError).length;

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between px-6 lg:px-8">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">
          Watched repositories
        </h1>
        <span className="text-[13px] text-ink-subtle">
          {lastSync
            ? `last swept ${new Date(lastSync).toISOString().replace("T", " ").slice(11, 16)} UTC`
            : "not swept yet"}
        </span>
      </header>

      <main className="w-full px-6 pb-12 lg:px-8">
        <div className="py-6">
          <h2 className="text-display-sm text-ink">
            <span className="block">Tavik reads these</span>
            <span className="block text-ink-subtle">without being asked.</span>
          </h2>
          <p className="mt-6 max-w-lg text-[16px] leading-[1.6] text-ink-soft">
            Every fifteen minutes it checks whether a repository&apos;s lockfile has
            moved. If it hasn&apos;t, that costs one small request. If it has, Tavik
            re-reads the whole thing and the next check catches what changed.
          </p>
          {failing > 0 ? (
            <p className="mt-4 text-[14px] text-alert">
              {failing} watch{failing === 1 ? "" : "es"} failing — see below.
            </p>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-lg bg-card p-6 shadow-card">
            <p className="text-[15px] font-medium text-ink">Couldn&apos;t read your watches</p>
            <p className="mt-1.5 text-[13.5px] text-ink-soft">{error}</p>
          </div>
        ) : (
          <WatchList watches={watches} />
        )}

        {watches.length === 0 && !error ? (
          <div className="mt-8 flex items-center gap-4 rounded-lg bg-card p-6 shadow-card">
            <Tavik pose="watching" size="sm" alt="" className="shrink-0" />
            <p className="text-[13.5px] leading-relaxed text-ink-soft">
              Nothing watched yet. Add a repository above and Tavik will notice the
              next time somebody adds a dependency to it — without anyone having to
              remember to scan.
            </p>
          </div>
        ) : null}
      </main>
    </>
  );
}
