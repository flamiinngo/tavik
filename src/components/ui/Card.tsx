import Link from "next/link";
import type { ReactNode } from "react";

import type { BoundaryStatus } from "@/lib/domain/boundary";
import { STATUS_PRESENTATION } from "./Status";

/**
 * Card and row primitives.
 *
 * White cards on an off-white canvas, separated by soft layered shadow rather
 * than by borders. On a light interface a visible border around everything is
 * what makes it look like a form; letting the card be *lighter* than the page is
 * how paper behaves, and it is more convincing.
 *
 * Rows use the icon → title/subtitle → chevron pattern people already read
 * fluently from every well-made app on their phone. A security tool is only
 * useful if it can be scanned under pressure, and familiarity is what makes
 * scanning fast.
 */

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  raised,
}: {
  children: ReactNode;
  className?: string;
  /** For the one card that should sit above the others. */
  raised?: boolean;
}) {
  return (
    <section
      className={cx(
        "rounded-lg bg-card",
        raised ? "shadow-raised" : "shadow-card",
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
    <header className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle ? (
          <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pb-2.5 text-[13px] font-medium text-ink-subtle">{children}</p>
  );
}

/**
 * A row: status disc, title, supporting line, trailing detail, chevron.
 *
 * The disc carries a glyph as well as a tint, so the state is legible without
 * relying on colour.
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
  const presentation = STATUS_PRESENTATION[status];
  const glyph =
    status === "verified" ? "✓" : status === "violated" ? "!" : status === "investigating" ? "◑" : "?";

  const body = (
    <>
      <span
        className={cx(
          "flex size-10 shrink-0 items-center justify-center rounded-pill text-[15px] font-semibold",
          presentation.chip,
        )}
        aria-hidden
      >
        {glyph}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-ink">{title}</span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-[13.5px] text-ink-subtle">
            {subtitle}
          </span>
        ) : null}
      </span>

      {trailing ? (
        <span className="shrink-0 text-right text-[13px] font-medium tabular-nums text-ink-soft">
          {trailing}
        </span>
      ) : null}

      {href ? (
        <span className="shrink-0 text-[18px] leading-none text-ink-faint" aria-hidden>
          ›
        </span>
      ) : null}
    </>
  );

  const shared = "flex items-center gap-4 rounded-md px-4 py-3.5 transition-colors";

  if (!href) return <div className={shared}>{body}</div>;

  return (
    <Link href={href} className={cx(shared, "hover:bg-inset")}>
      {body}
    </Link>
  );
}

/**
 * How much of the estate is currently proven safe.
 *
 * Segmented rather than a continuous fill, because the segments are countable —
 * "two of four" is readable without the label, which a solid bar never allows.
 */
export function HealthBar({
  counts,
  className,
}: {
  counts: Record<BoundaryStatus, number>;
  className?: string;
}) {
  const total = counts.verified + counts.violated + counts.investigating + counts.unknown;
  if (total === 0) return null;

  const order: BoundaryStatus[] = ["violated", "investigating", "unknown", "verified"];

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[13px] font-medium text-ink-subtle">Rules holding</p>
        <p className="text-[13px] font-medium tabular-nums text-ink">
          {counts.verified}
          <span className="text-ink-faint"> of {total}</span>
        </p>
      </div>

      <div className="mt-2.5 flex gap-1.5">
        {order.flatMap((status) =>
          Array.from({ length: counts[status] }, (_, index) => (
            <span
              key={`${status}-${index}`}
              className={cx("h-1.5 flex-1 rounded-pill", STATUS_PRESENTATION[status].bar)}
            />
          )),
        )}
      </div>
    </div>
  );
}
