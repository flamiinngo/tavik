import type { BoundaryStatus } from "@/lib/domain/boundary";

/**
 * Status presentation — the single source of truth for how state looks.
 *
 * Every surface reads from here. If two screens ever disagree about what
 * "violated" looks like, someone has to stop and work out which to believe, and
 * in a security product that hesitation is the failure.
 *
 * Deliberately quiet. Status is a **tinted chip with a word**, never a filled
 * red or green block — traffic-light UI is what makes a product read as a
 * dashboard rather than something you trust. The word carries the meaning; the
 * tint only helps you find it. That also means the state survives greyscale and
 * colour-vision deficiency, which a colour-only signal never does.
 *
 * `unknown` is styled as genuinely distinct from `safe` rather than a quieter
 * version of it. One means "checked, and nothing can get through", the other
 * means "not checked". Reading the second as the first is the most dangerous
 * mistake this UI can invite.
 */

export interface StatusPresentation {
  /** The word shown in a chip. Plain language, not jargon. */
  readonly label: string;
  /** Headline form, for page and card titles. */
  readonly headline: string;
  /** One line explaining what the state actually means. */
  readonly meaning: string;
  readonly text: string;
  readonly chip: string;
  readonly dot: string;
  readonly bar: string;
}

export const STATUS_PRESENTATION: Record<BoundaryStatus, StatusPresentation> = {
  verified: {
    label: "Safe",
    headline: "Nothing can get through",
    meaning: "Tavik checked every route and found none.",
    text: "text-safe",
    chip: "bg-safe-soft text-safe ring-1 ring-safe-line",
    dot: "bg-safe",
    bar: "bg-safe",
  },
  violated: {
    label: "Open",
    headline: "There's a way through",
    meaning: "At least one route reaches the thing you're protecting.",
    text: "text-alert",
    chip: "bg-alert-soft text-alert ring-1 ring-alert-line",
    dot: "bg-alert",
    bar: "bg-alert",
  },
  investigating: {
    label: "Looking",
    headline: "Being looked at",
    meaning: "Someone is working on this, or a fix is being applied.",
    text: "text-watch",
    chip: "bg-watch-soft text-watch ring-1 ring-watch-line",
    dot: "bg-watch",
    bar: "bg-watch",
  },
  unknown: {
    label: "Not checked",
    headline: "Tavik couldn't check this",
    meaning: "This is not known to be safe. It simply hasn't been checked.",
    text: "text-idle",
    chip: "bg-idle-soft text-idle ring-1 ring-idle-line",
    dot: "bg-idle",
    bar: "bg-idle",
  },
};

export function StatusChip({
  status,
  className = "",
}: {
  status: BoundaryStatus;
  className?: string;
}) {
  const presentation = STATUS_PRESENTATION[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-1 text-[12px] font-medium ${presentation.chip} ${className}`}
    >
      <span className={`size-1.5 rounded-pill ${presentation.dot}`} aria-hidden />
      {presentation.label}
    </span>
  );
}
