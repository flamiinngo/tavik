import Link from "next/link";

import type { Operator } from "@/lib/server/operator";

/**
 * Who Tavik will file the next approval under.
 *
 * Sits in the sidebar rather than on a settings screen because the moment it
 * matters is the moment someone is about to approve something — and by then
 * they are not going looking for it. An unidentified operator gets a visibly
 * unfinished state, since a work log full of "Unnamed operator" is the failure
 * this is meant to prevent.
 */

export function OperatorBadge({ operator }: { operator: Operator }) {
  if (!operator.identified) {
    return (
      <Link
        href="/app/team"
        className="block rounded-md border border-dashed border-line px-4 py-3 transition-colors hover:border-accent hover:bg-accent-soft"
      >
        <p className="text-[12.5px] font-medium text-ink">Nobody signed in</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-subtle">
          Approvals are recorded unattributed. Say who you are →
        </p>
      </Link>
    );
  }

  return (
    <Link
      href="/app/team"
      className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-card"
    >
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-pill bg-accent-soft text-[12px] font-semibold text-accent"
      >
        {initials(operator.name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium text-ink">
          {operator.name}
        </span>
        <span className="block text-[11.5px] text-ink-subtle capitalize">
          {operator.role}
        </span>
      </span>
    </Link>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}
