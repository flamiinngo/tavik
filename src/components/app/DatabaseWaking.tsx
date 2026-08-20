"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Card } from "@/components/ui/Card";
import { StatusChip } from "@/components/ui/Status";
import { Tavik } from "@/components/mascot/Tavik";

/**
 * What to show when the database is not answering.
 *
 * The honest state has always been "not checked", and that has to stay — a
 * dashboard that goes quiet when it cannot reach its data, or worse goes green,
 * is the failure this whole product exists to prevent.
 *
 * But on the hosted demo the overwhelmingly likely cause is not a fault at all.
 * The free plan it runs on hibernates after fifteen minutes with no visitors,
 * and the first person back waits about a minute while it gets up. Showing them
 * a red error for a minute, with no explanation and no sign anything is
 * happening, loses people who would otherwise have waited — and it misdescribes
 * what is going on.
 *
 * So it says which it is, counts, and retries by itself. It still says "not
 * checked" the whole time, because that is still true.
 */

const RETRY_AFTER_SECONDS = 12;

export function DatabaseWaking({
  reason,
  hosted,
}: {
  reason: string;
  /** True on the public demo, where hibernation is the likely explanation. */
  hosted: boolean;
}) {
  const router = useRouter();
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setWaited((seconds) => seconds + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    // Retries on its own rather than asking someone to keep pressing reload.
    // A cold start takes about a minute, so this will usually be the third or
    // fourth attempt that lands.
    if (waited > 0 && waited % RETRY_AFTER_SECONDS === 0) router.refresh();
  }, [waited, router]);

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start gap-5">
        <Tavik pose="standby" size="sm" alt="" className="shrink-0" />

        <div className="min-w-0 flex-1">
          <StatusChip status="unknown" />

          <p className="mt-3 text-[17px] font-semibold text-ink">
            {hosted ? "Waking the demo database up" : "Tavik can't read your security state"}
          </p>

          {hosted ? (
            <>
              <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
                This demo runs on a free plan that goes to sleep after fifteen
                minutes without visitors. It takes about a minute to get up
                again. Nothing is broken and you don&apos;t need to do anything —
                this page is retrying by itself.
              </p>
              <p className="mt-3 text-[13px] text-ink-subtle tabular-nums">
                Waiting {waited}s · retrying every {RETRY_AFTER_SECONDS}s
              </p>
            </>
          ) : (
            <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
              Start it with <code className="font-mono text-ink">npm run hydra:up</code>.
              Retrying every {RETRY_AFTER_SECONDS} seconds.
            </p>
          )}

          {/* Kept regardless of which message is shown. It is the fact that
              matters, and it is equally true whether the cause is a nap or a
              real outage. */}
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
            Until it answers, every rule is marked{" "}
            <strong className="text-ink">not checked</strong> — which is not the
            same as safe.
          </p>

          <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">{reason}</p>
        </div>
      </div>
    </Card>
  );
}
