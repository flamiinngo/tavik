import Link from "next/link";

/**
 * The Tavik logomark.
 *
 * Drawn from the character rather than invented alongside it: the chevron is the
 * emblem on the mascot's chest, set in a rounded shield. A brand holds together
 * when the mark and the character are obviously the same idea, and it means the
 * logo still reads as Tavik at 16px where the character itself would be an
 * unreadable smudge.
 *
 * Vector, so it stays crisp at every size and takes its colour from context —
 * a cropped photograph of the mascot could do neither.
 */

export function LogoMark({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Tavik"
      className={className}
    >
      {/* Shield. Squared at the shoulders, tapering to a point — the silhouette
          reads as protection without resorting to a padlock. */}
      <path
        d="M16 2.5 3.5 6.8v9.4c0 6.6 5.1 11.4 12.5 13.3 7.4-1.9 12.5-6.7 12.5-13.3V6.8L16 2.5Z"
        className="fill-ink"
      />
      {/* The chevron from the mascot's chest, in its cyan. */}
      <path
        d="M9.6 12.4 16 18.6l6.4-6.2"
        stroke="var(--color-accent)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.9 19.2 16 23.2l4.1-4"
        stroke="var(--color-accent)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.45"
      />
    </svg>
  );
}

/** Mark plus wordmark, linked home. */
export function Logo({
  href = "/",
  size = 28,
  className = "",
}: {
  href?: string;
  size?: number;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2.5 transition-opacity hover:opacity-80 ${className}`}
    >
      <LogoMark size={size} />
      <span className="text-[17px] font-semibold tracking-tight text-ink">Tavik</span>
    </Link>
  );
}
