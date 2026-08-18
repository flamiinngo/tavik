"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A navigation item that knows whether it is current.
 *
 * The only client component in the shell — it needs the current path, and
 * nothing else here does.
 *
 * Items for screens that are not built yet render as disabled and labelled
 * rather than being hidden or linking to a broken page. Someone evaluating this
 * product should be able to see the intended shape without being misled about
 * what works today.
 */
export function NavLink({
  href,
  ready,
  children,
}: {
  href: string;
  ready: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // `/app` must not match every child route, so the root is compared exactly.
  const isActive = href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  if (!ready) return null;

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`flex items-center rounded-sm px-3 py-2.5 text-[14.5px] transition-colors duration-150 ${
        isActive
          ? "bg-card font-medium text-ink shadow-card"
          : "text-ink-soft hover:bg-card/60 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
