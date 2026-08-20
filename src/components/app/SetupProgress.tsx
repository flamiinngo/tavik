import Link from "next/link";

import type { SetupProgress as Progress } from "@/lib/server/tavik";

/**
 * The thread between the screens, in one line.
 *
 * Every screen worked and nothing told anyone what to do second — but the fix
 * for that cannot be another panel. This started life as a card with four rows
 * and a progress bar, which pushed the actual answer, the thing the whole
 * product exists to say, below the fold behind a to-do list. A dashboard that
 * leads with its own setup is talking about itself.
 *
 * So: one quiet line above the headline, naming only the next thing. It carries
 * the count for anyone who wants to know how much is left, and gets out of the
 * way. It disappears entirely once setup is done rather than staying on as
 * furniture.
 */
export function SetupProgress({ progress }: { progress: Progress }) {
  if (progress.complete) return null;

  const next = progress.steps.find((step) => !step.done);
  if (!next) return null;

  return (
    <Link
      href={next.href}
      className="group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm bg-accent-soft px-4 py-2.5 transition-colors hover:bg-accent-soft/70"
    >
      <span className="text-[12px] font-medium tabular-nums text-accent">
        {progress.doneCount}/{progress.steps.length}
      </span>
      <span className="text-[13.5px] font-medium text-ink">{next.title}</span>

      {/* Dropped entirely on a phone rather than truncated to an ellipsis.
          There is no width for it beside the title and the action, and half a
          sentence cut off mid-word explains less than nothing — the title and
          the action already say what to do. */}
      <span className="hidden min-w-0 flex-1 truncate text-[13px] text-ink-soft sm:block">
        {next.why}
      </span>
      <span className="shrink-0 text-[13px] font-medium text-accent">
        {next.action}{" "}
        <span aria-hidden className="inline-block transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </span>
    </Link>
  );
}
