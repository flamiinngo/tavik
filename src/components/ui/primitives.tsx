import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Tavik's core primitives.
 *
 * Small on purpose. A design system earns its keep by making the common case
 * consistent, not by anticipating every case — a component nobody uses twice is
 * indirection, not abstraction.
 *
 * Two rules run through all of these: consistent heights (so rows of controls
 * align without per-screen nudging), and hairline borders over shadows (so
 * elevation reads as structure rather than decoration).
 */

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ── Button ──────────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-base font-medium hover:bg-accent-strong active:bg-accent-strong",
  secondary:
    "bg-raised text-ink border border-line-strong hover:border-line-focus hover:bg-overlay",
  ghost: "text-ink-muted hover:bg-raised hover:text-ink",
  // Destructive actions are outlined rather than filled: a solid red button
  // invites the reflexive click that this product specifically must not get.
  danger:
    "border border-violated/40 text-violated hover:bg-violated-dim hover:border-violated/60",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center rounded-md whitespace-nowrap",
        "transition-colors duration-150 ease-out",
        "disabled:pointer-events-none disabled:opacity-40",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────

export interface PanelProps {
  children: ReactNode;
  className?: string;
}

export function Panel({ children, className }: PanelProps) {
  return (
    <section
      className={cx(
        "rounded-lg border border-line bg-surface shadow-panel",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-ink-subtle">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

// ── Metric ──────────────────────────────────────────────────────────────────

/**
 * A single number with its label.
 *
 * `tone` exists so the four boundary states can be counted in a row without
 * each caller re-deriving the colour and drifting out of step with Status.tsx.
 */
export function Metric({
  value,
  label,
  tone = "neutral",
  hint,
}: {
  value: ReactNode;
  label: string;
  tone?: "neutral" | "verified" | "violated" | "investigating" | "unknown";
  hint?: string;
}) {
  const toneClass = {
    neutral: "text-ink",
    verified: "text-verified",
    violated: "text-violated",
    investigating: "text-investigating",
    unknown: "text-unknown",
  }[tone];

  return (
    <div className="min-w-0">
      <p
        className={cx(
          "font-mono text-3xl leading-none tabular-nums tracking-tight",
          toneClass,
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-xs font-medium text-ink-muted">{label}</p>
      {hint ? <p className="mt-0.5 text-2xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

// ── Identifier ──────────────────────────────────────────────────────────────

/**
 * Infrastructure identifiers: package names, versions, URNs, account handles.
 *
 * Always monospace, never truncated silently — a half-shown package name is how
 * someone mistakes one dependency for another. Long values wrap or scroll, and
 * the full value is always in the DOM for copying.
 */
export function Identifier({
  children,
  title,
  className,
}: {
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cx("font-mono text-xs text-ink break-all", className)}
    >
      {children}
    </span>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

export function EmptyState({
  title,
  description,
  action,
  illustration,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  /** The mascot belongs here — an empty screen is a state, and it has a voice. */
  illustration?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {illustration ? <div className="mb-5">{illustration}</div> : null}
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-ink-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

// ── Timestamp ───────────────────────────────────────────────────────────────

/**
 * Absolute UTC, monospace, always.
 *
 * Relative times ("2 hours ago") are friendlier and worse: an incident timeline
 * is compared against other systems' logs, and "2 hours ago" cannot be
 * correlated with anything. Tavik's timestamps are evidence, so they are stated
 * precisely and unambiguously.
 */
export function Timestamp({ at, className }: { at: number; className?: string }) {
  const iso = new Date(at).toISOString();
  return (
    <time
      dateTime={iso}
      title={iso}
      className={cx("font-mono text-2xs tabular-nums text-ink-subtle", className)}
    >
      {iso.replace("T", " ").slice(0, 19)}
    </time>
  );
}

// ── Demo banner ─────────────────────────────────────────────────────────────

/**
 * Marks data that did not come from the viewer's own infrastructure.
 *
 * Required by the product's honesty rules and never suppressible. A viewer must
 * always be able to tell live state from a demonstration.
 */
export function DemoBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-investigating/20 bg-investigating-dim px-4 py-2">
      <span className="rounded-xs bg-investigating/20 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider text-investigating">
        Demo environment
      </span>
      <span className="text-xs text-ink-muted">
        {children ??
          "This workspace shows a scripted scenario running through the real ingestion and verification pipeline."}
      </span>
    </div>
  );
}
