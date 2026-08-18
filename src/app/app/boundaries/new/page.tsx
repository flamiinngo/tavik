import Link from "next/link";

import { Tavik } from "@/components/mascot/Tavik";
import { RuleBuilder } from "@/components/rules/RuleBuilder";

export const metadata = { title: "Write a rule" };

export default function NewRulePage() {
  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-3 px-6 lg:px-8">
        <Link
          href="/app/boundaries"
          className="text-[13px] text-ink-subtle transition-colors hover:text-ink"
        >
          Rules
        </Link>
        <span className="text-ink-faint">/</span>
        <span className="text-[13px] font-medium text-ink">New</span>
      </header>

      <main className="w-full px-6 pb-16 lg:px-8">
        <div className="grid gap-12 py-6 lg:grid-cols-[1fr_1.1fr] lg:items-start lg:gap-16">
          <div className="min-w-0">
            <h1 className="text-display-sm text-ink">
              <span className="block">Say what must</span>
              <span className="block text-ink-subtle">never happen.</span>
            </h1>
            <p className="mt-6 max-w-md text-[16px] leading-[1.6] text-ink-soft">
              A rule is a sentence: these things should never be able to reach those
              things. Tavik turns it into a question it can answer against your real
              dependency graph — and re-answers it whenever anything changes.
            </p>

            <div className="mt-10 max-w-md space-y-5 border-t border-line pt-8">
              <Point title="It's answered immediately">
                The moment you save, Tavik checks it and tells you what it found. No
                waiting to see whether your rule was worth writing.
              </Point>
              <Point title="It stays answered">
                Every future scan re-checks it. If it stops being true, that becomes a
                change you can see, with the exact route that broke it.
              </Point>
              <Point title="You'll always know what was checked">
                Tavik reports how far it looked and how many routes it found. If it hits
                its limit it says so, rather than presenting a sample as the total.
              </Point>
            </div>

            <div className="mt-10 flex items-center gap-4">
              <Tavik pose="standby" size="sm" alt="" />
              <p className="max-w-xs text-[13.5px] leading-relaxed text-ink-subtle">
                Not sure where to start? &ldquo;Publishers not on our approved list&rdquo;
                is the rule most teams want first.
              </p>
            </div>
          </div>

          <RuleBuilder />
        </div>
      </main>
    </>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[14.5px] font-medium text-ink">{title}</p>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}
