import Link from "next/link";
import type { ReactNode } from "react";

import type { BoundaryStatus } from "@/lib/domain/boundary";

/**
 * Card and row primitives.
 *
 * A rounded, elevated card with an icon-title-chevron row is the vocabulary
 * people already read fluently from every well-made app on their phone. Using it
 * here is not decoration: a security tool is only useful if someone can scan it
 * under pressure, and familiarity is what makes scanning fast.
 *
 * The earlier version of this UI used flat sections and hairline rules. It was
 * information-dense and read as a terminal dump — precise, and quietly hostile.
 */

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ── Card ────────────────────────────────────────────────────────────────────

export function Card({
  children,
  className,
  glow,
}: {
  children: ReactNode;
  className?: string;
  /** Reserved for live state — a violated boundary, an active scan. */
  glow?: "violated" | "verified" | "accent";
}) {
  const glowClass =
    glow === "violated"
      ? "shadow-glow-violated"
      : glow === "verified"
        ? "shadow-glow-verified"
        : glow === "accent"
          ? "shadow-glow-accent"
          : "shadow-card";

  return (
    <section
      className={cx(
        "rounded-lg border border-line bg-raised",
        glowClass,
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/** A small section label above a group of rows. */
export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-1 pb-2 text-[13px] font-medium text-ink-muted">{children}</p>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<BoundaryStatus, { glyph: string; ring: string; text: string }> = {
  verified: { glyph: "✓", ring: "bg-verified/15", text: "text-verified" },
  violated: { glyph: "!", ring: "bg-violated/15", text: "text-violated" },
  investigating: { glyph: "◑", ring: "bg-investigating/15", text: "text-investigating" },
  unknown: { glyph: "?", ring: "bg-unknown/15", text: "text-unknown" },
};

/**
 * A tappable row: status disc, title, supporting line, trailing detail, chevron.
 *
 * The disc carries a glyph as well as a colour, so state survives greyscale and
 * colour-vision deficiency without needing a legend.
 */
export function StatusRow({
  status,
  title,
  subtitle,
  trailing,
  href,
}: {
  status: BoundaryStatus;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  href?: string;
}) {
  const icon = STATUS_ICON[status];

  const body = (
    <>
      <span
        className={cx(
          "flex size-9 shrink-0 items-center justify-center rounded-pill text-sm font-semibold",
          icon.ring,
          icon.text,
        )}
        aria-hidden
      >
        {icon.glyph}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ink">{title}</span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-[13px] text-ink-subtle">
            {subtitle}
          </span>
        ) : null}
      </span>

      {trailing ? (
        <span className="shrink-0 text-right font-mono text-[12px] tabular-nums text-ink-subtle">
          {trailing}
        </span>
      ) : null}

      {href ? (
        <span className="shrink-0 text-ink-faint" aria-hidden>
          ›
        </span>
      ) : null}
    </>
  );

  const shared =
    "flex items-center gap-3.5 rounded-md px-3 py-3 transition-colors";

  if (!href) {
    return <div className={shared}>{body}</div>;
  }

  return (
    <Link href={href} className={cx(shared, "hover:bg-overlay")}>
      {body}
    </Link>
  );
}

// ── Health bar ──────────────────────────────────────────────────────────────

/**
 * How much of the estate is currently proven safe.
 *
 * One glance, one number. Segmented rather than a single fill, because the
 * segments are countable — you can see "three of four" without reading the
 * label, which a continuous bar never lets you do.
 */
export function HealthBar({
  counts,
  className,
}: {
  counts: Record<BoundaryStatus, number>;
  className?: string;
}) {
  const total =
    counts.verified + counts.violated + counts.investigating + counts.unknown;
  if (total === 0) return null;

  const segments: { status: BoundaryStatus; count: number; color: string }[] = [
    { status: "violated", count: counts.violated, color: "bg-violated" },
    { status: "investigating", count: counts.investigating, color: "bg-investigating" },
    { status: "unknown", count: counts.unknown, color: "bg-unknown" },
    { status: "verified", count: counts.verified, color: "bg-verified" },
  ];

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[13px] font-medium text-ink-muted">Boundary health</p>
        <p className="font-mono text-[13px] tabular-nums text-ink">
          <span className={counts.verified === total ? "text-verified" : "text-ink"}>
            {counts.verified}
          </span>
          <span className="text-ink-faint">/{total} holding</span>
        </p>
      </div>

      <div className="mt-2.5 flex h-2 gap-1 overflow-hidden rounded-pill">
        {segments.flatMap((segment) =>
          Array.from({ length: segment.count }, (_, index) => (
            <span
              key={`${segment.status}-${index}`}
              className={cx("h-full flex-1 rounded-pill", segment.color)}
            />
          )),
        )}
      </div>
    </div>
  );
}
