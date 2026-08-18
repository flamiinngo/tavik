import Link from "next/link";

import { Tavik } from "@/components/mascot/Tavik";
import { NavLink } from "@/components/app/NavLink";

/**
 * The application shell.
 *
 * Navigation is grouped by the question each screen answers rather than by
 * feature name, because that is how someone actually arrives: they want to know
 * what is wrong, or what changed, or what Tavik has been doing.
 *
 * Sections not yet built are shown but marked, rather than hidden. A nav that
 * silently omits half the product makes it impossible to tell scope from
 * progress — and quietly hiding them would misrepresent what is finished.
 */

const SECTIONS: readonly {
  heading: string;
  items: readonly { href: string; label: string; ready: boolean }[];
}[] = [
  {
    heading: "State",
    items: [
      { href: "/app", label: "Overview", ready: true },
      { href: "/app/boundaries", label: "Boundaries", ready: true },
      { href: "/app/work-log", label: "Work log", ready: true },
    ],
  },
];

/**
 * Screens that are designed but not built.
 *
 * Collected into one quiet line rather than scattered through the nav as six
 * "SOON" badges. Listing them individually made a working product read as an
 * unfinished demo — the eye counted the disabled items, not the live ones —
 * while still being no more honest than naming them once.
 */
const PLANNED = [
  "Security graph",
  "Timeline",
  "Remediations",
  "Environments",
  "Integrations",
  "Team",
];

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
          <Tavik pose="profile" size="xs" alt="" />
          <Link href="/app" className="text-sm font-semibold tracking-tight text-ink">
            Tavik
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4" aria-label="Main">
          {SECTIONS.map((section) => (
            <div key={section.heading} className="mb-5">
              <p className="px-2 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                {section.heading}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <NavLink href={item.href} ready={item.ready}>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="space-y-3 border-t border-line px-4 py-4">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
              Planned
            </p>
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-faint/70">
              {PLANNED.join(" · ")}
            </p>
          </div>
          <p className="flex items-center gap-2 border-t border-line pt-3 font-mono text-2xs text-ink-faint">
            <span className="size-1.5 animate-breathe rounded-full bg-verified" aria-hidden />
            HydraDB · local
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
