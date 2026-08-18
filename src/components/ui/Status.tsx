import type { BoundaryStatus } from "@/lib/domain/boundary";

/**
 * Status presentation — the single source of truth for how state looks.
 *
 * Every surface that shows a boundary's state reads from here. If two screens
 * ever disagree about what "violated" looks like, a user has to stop and work
 * out which one to believe, and in a security product that hesitation is the
 * failure.
 *
 * `unknown` is styled as genuinely distinct from `verified` rather than as a
 * quieter version of it. The two must never be confusable at a glance: one means
 * "checked, and safe", the other means "not checked". Reading the second as the
 * first is the most dangerous mistake this UI can invite.
 */

export interface StatusPresentation {
  /** Shown in badges and pills. */
  readonly label: string;
  /** The full-sentence form used in headers. */
  readonly headline: string;
  /** One line explaining what the state actually means. */
  readonly meaning: string;
  readonly text: string;
  readonly background: string;
  readonly border: string;
  readonly dot: string;
}

export const STATUS_PRESENTATION: Record<BoundaryStatus, StatusPresentation> = {
  verified: {
    label: "Verified",
    headline: "Boundary verified",
    meaning: "No path exists between the source and the target.",
    text: "text-verified",
    background: "bg-verified-dim",
    border: "border-verified/25",
    dot: "bg-verified",
  },
  violated: {
    label: "Violated",
    headline: "Boundary violated",
    meaning: "At least one path makes the target reachable.",
    text: "text-violated",
    background: "bg-violated-dim",
    border: "border-violated/30",
    dot: "bg-violated",
  },
  investigating: {
    label: "Investigating",
    headline: "Under investigation",
    meaning: "A violation is being triaged, or a remediation is in flight.",
    text: "text-investigating",
    background: "bg-investigating-dim",
    border: "border-investigating/25",
    dot: "bg-investigating",
  },
  unknown: {
    label: "Unknown",
    headline: "Not evaluated",
    meaning: "Tavik could not check this boundary. It is not known to hold.",
    text: "text-unknown",
    background: "bg-unknown-dim",
    border: "border-unknown/25",
    dot: "bg-unknown",
  },
};

export interface StatusPillProps {
  status: BoundaryStatus;
  size?: "sm" | "md";
  className?: string;
}

export function StatusPill({ status, size = "md", className = "" }: StatusPillProps) {
  const presentation = STATUS_PRESENTATION[status];
  const scale =
    size === "sm"
      ? "h-5 gap-1.5 px-2 text-2xs"
      : "h-6 gap-2 px-2.5 text-xs";

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border font-medium uppercase tracking-wide ${scale} ${presentation.background} ${presentation.border} ${presentation.text} ${className}`}
    >
      <span className={`size-1.5 rounded-full ${presentation.dot}`} aria-hidden />
      {presentation.label}
    </span>
  );
}

/**
 * A larger status treatment for page headers.
 *
 * Pairs the state with what it means, because a colour alone is not an
 * explanation — and colour alone is also unavailable to a colourblind reader.
 */
export function StatusBanner({
  status,
  detail,
  className = "",
}: {
  status: BoundaryStatus;
  /** Overrides the default meaning, e.g. with a failure reason. */
  detail?: string;
  className?: string;
}) {
  const presentation = STATUS_PRESENTATION[status];

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${presentation.background} ${presentation.border} ${className}`}
    >
      <span
        className={`mt-1.5 size-2 shrink-0 rounded-full ${presentation.dot}`}
        aria-hidden
      />
      <div className="min-w-0">
        <p className={`text-sm font-medium ${presentation.text}`}>
          {presentation.headline}
        </p>
        <p className="mt-0.5 text-sm text-ink-muted">
          {detail ?? presentation.meaning}
        </p>
      </div>
    </div>
  );
}
