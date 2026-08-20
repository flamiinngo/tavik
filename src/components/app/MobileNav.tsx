"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Logo } from "@/components/brand/Logo";
import type { NavSection } from "@/lib/nav";

/**
 * Navigation on a narrow screen.
 *
 * The sidebar is `hidden lg:flex`, which on a phone meant there was no way to
 * reach anything. You could open the overview and then you were stuck on it:
 * no rules, no publishers, no graph, no way back to the guide. Not a degraded
 * layout — an application with nine screens and one door.
 *
 * A panel rather than a squeezed-down sidebar, because the sections carry
 * headings and descriptions that are worth keeping. It closes on navigation,
 * which sounds obvious and is the thing most hand-rolled menus forget.
 */
export function MobileNav({ sections }: { sections: readonly NavSection[] }) {
  const pathname = usePathname();

  // Remembers which page it was opened on, rather than holding a boolean and
  // clearing it when the route changes. Closing on navigation is essential —
  // otherwise the panel sits over the page someone just asked for — but doing it
  // by setting state inside an effect costs a second render on every visit, and
  // React now flags it. Derived from the pathname there is nothing to clear: the
  // moment the route changes, this stops matching and the panel is shut.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null);

  // Escape closes it, and the page behind does not scroll while it is open.
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur-sm lg:hidden">
        <Logo href="/app" />

        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="-mr-2 grid size-10 place-items-center rounded-sm text-ink"
        >
          {/* Two bars that become a cross. Drawn rather than imported: an icon
              package for one glyph is a dependency in a product about
              dependencies. */}
          <span className="relative block h-4 w-5" aria-hidden>
            <span
              className={`absolute left-0 block h-0.5 w-5 rounded-pill bg-current transition-transform duration-200 ${
                open ? "top-1.5 rotate-45" : "top-0.5"
              }`}
            />
            <span
              className={`absolute left-0 block h-0.5 w-5 rounded-pill bg-current transition-transform duration-200 ${
                open ? "top-1.5 -rotate-45" : "top-3"
              }`}
            />
          </span>
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 top-14 z-40 overflow-y-auto overscroll-contain bg-canvas px-4 pt-4 pb-10 lg:hidden">
          <nav aria-label="Main">
            {sections.map((section, index) => (
              <div key={section.heading} className={index > 0 ? "mt-7" : undefined}>
                <h2 className="px-3 pb-2 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
                  {section.heading}
                </h2>
                <ul className="space-y-1">
                  {section.items.map((item) => {
                    const active =
                      item.href === "/app"
                        ? pathname === "/app"
                        : pathname.startsWith(item.href);

                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`block rounded-md px-3 py-3 text-[15px] ${
                            active
                              ? "bg-card font-medium text-ink shadow-card"
                              : "text-ink-soft"
                          }`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      ) : null}
    </>
  );
}
