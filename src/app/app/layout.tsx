import { Logo } from "@/components/brand/Logo";
import { MobileNav } from "@/components/app/MobileNav";
import { NAV_SECTIONS } from "@/lib/nav";
import { NavLink } from "@/components/app/NavLink";
import { OperatorBadge } from "@/components/app/OperatorBadge";
import { currentOperator } from "@/lib/server/operator";

/**
 * The application shell.
 *
 * Navigation is grouped by the question each screen answers rather than by
 * feature name, because that is how someone actually arrives: they want to know
 * what is wrong, or what changed, or what Tavik has been doing.
 *
 * Every item here is built and works. `ready` stays on each entry rather than
 * being deleted now that they are all true: a nav that silently omits an
 * unfinished screen makes it impossible to tell scope from progress, and the
 * next screen added should have to declare itself either way.
 */



export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const operator = await currentOperator();

  return (
    <div className="flex min-h-screen flex-col bg-canvas lg:flex-row">
      {/* Below lg the sidebar is hidden, so without this there is no way off
          whichever screen you landed on. */}
      <MobileNav sections={NAV_SECTIONS} />

      <aside className="hidden w-64 shrink-0 flex-col px-4 py-5 lg:flex">
        <div className="mb-7 px-2">
          <Logo href="/app" />
        </div>

        <nav className="flex-1" aria-label="Main">
          {NAV_SECTIONS.map((section, index) => (
            <div key={section.heading} className={index > 0 ? "mt-7" : undefined}>
              <h2 className="px-3 pb-2 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
                {section.heading}
              </h2>
              <ul className="space-y-1">
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

        <div className="mt-4">
          <OperatorBadge operator={operator} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
