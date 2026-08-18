import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Core primitives.
 *
 * Buttons are pills, because on a light interface a rectangle reads as a form
 * control and a pill reads as an action. The primary is solid ink rather than a
 * saturated brand colour — the most confident thing on a white page is black
 * type on a black button, and it keeps the single accent free for meaning.
 */

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-card hover:bg-ink/90 shadow-pill",
  secondary: "bg-card text-ink ring-1 ring-line-strong hover:bg-inset shadow-pill",
  ghost: "text-ink-soft hover:bg-inset hover:text-ink",
  // Outlined, never filled. A solid red button invites the reflexive click that
  // an irreversible action specifically must not get.
  danger: "text-alert ring-1 ring-alert-line hover:bg-alert-soft",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-[13px] gap-1.5",
  md: "h-10 px-5 text-[14px] gap-2",
  lg: "h-12 px-6 text-[15px] gap-2",
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
        "inline-flex items-center justify-center rounded-pill font-medium whitespace-nowrap",
        "transition-all duration-150 ease-out",
        "disabled:pointer-events-none disabled:opacity-40",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Infrastructure identifiers: package names, versions, account handles.
 *
 * Always monospace, never silently truncated — a half-shown package name is how
 * one dependency gets mistaken for another.
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
      className={cx(
        "rounded-xs bg-inset px-1.5 py-0.5 font-mono text-[12.5px] text-ink break-all",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  illustration,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  illustration?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {illustration ? <div className="mb-5">{illustration}</div> : null}
      <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-ink-soft">
        {description}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/**
 * Absolute UTC, monospace, always.
 *
 * Relative times ("2 hours ago") are friendlier and worse: an incident timeline
 * gets compared against other systems' logs, and "2 hours ago" correlates with
 * nothing. These timestamps are evidence.
 */
export function Timestamp({ at, className }: { at: number; className?: string }) {
  const iso = new Date(at).toISOString();
  return (
    <time
      dateTime={iso}
      title={iso}
      className={cx("font-mono text-[12px] tabular-nums text-ink-faint", className)}
    >
      {iso.replace("T", " ").slice(0, 16)}
    </time>
  );
}
