import { Logo } from "@/components/brand/Logo";
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
      { href: "/app/boundaries", label: "Rules", ready: true },
      { href: "/app/publishers", label: "Publishers", ready: true },
      { href: "/app/graph", label: "Security graph", ready: true },
      { href: "/app/timeline", label: "Timeline", ready: true },
      { href: "/app/work-log", label: "Work log", ready: true },
      { href: "/app/onboarding", label: "Scan a project", ready: true },
      { href: "/app/watches", label: "Watched repos", ready: true },
      { href: "/app/integrations", label: "Integrations", ready: true },
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
const PLANNED = ["Team accounts"];

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="hidden w-64 shrink-0 flex-col px-4 py-5 lg:flex">
        <div className="mb-7 px-2">
          <Logo href="/app" />
        </div>

        <nav className="flex-1" aria-label="Main">
          <ul className="space-y-1">
            {SECTIONS.flatMap((section) => section.items).map((item) => (
              <li key={item.href}>
                <NavLink href={item.href} ready={item.ready}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="rounded-md bg-card p-4 shadow-card">
          <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <span className="size-1.5 animate-breathe rounded-pill bg-safe" aria-hidden />
            Watching
          </p>
          {/* Says what it does, at the interval it actually does it. */}
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-subtle">
            Re-checks every rule about once a minute and records anything that
            changes.
          </p>
        </div>

        <p className="mt-4 px-2 text-[11.5px] leading-relaxed text-ink-faint">
          Coming soon · {PLANNED.join(" · ")}
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
