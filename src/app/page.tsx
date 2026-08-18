import Link from "next/link";

import { Logo, LogoMark } from "@/components/brand/Logo";
import { PathTrace } from "@/components/graph/PathTrace";
import { Tavik } from "@/components/mascot/Tavik";
import { Button } from "@/components/ui/primitives";
import { loadLandingProof } from "@/lib/server/landing";

export const metadata = {
  title: "Tavik — prove who can reach your production code",
  description:
    "Every package you install can be updated by someone you've never met. Tavik proves which of them can reach production, and shows you the exact route.",
};

// Never cached: the figures here are live, and a page quoting a stale
// measurement as fact would undercut the whole pitch.
export const dynamic = "force-dynamic";

/**
 * The landing page.
 *
 * Composed as one continuous document rather than a stack of cards. Sections are
 * separated by hairline rules and space, and almost nothing sits in a container
 * — a page where every section is a rounded rectangle reads as a template, and
 * containers stop being meaningful when everything has one.
 *
 * The only boxed elements are the two things that genuinely are objects rather
 * than prose: the route evidence, and the closing call to action.
 */
export default async function LandingPage() {
  const proof = await loadLandingProof();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <Logo />
        <nav className="flex items-center gap-6">
          <Link
            href="/app"
            className="text-[14px] text-ink-soft transition-colors hover:text-ink"
          >
            Dashboard
          </Link>
          <Link href="/app/onboarding">
            <Button size="sm" variant="primary">
              Scan a project
            </Button>
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="grid items-center gap-8 py-10 lg:grid-cols-[1.35fr_1fr] lg:py-16">
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium uppercase tracking-[0.18em] text-accent">
              Software supply chain security
            </p>

            <h1 className="mt-7 text-display-sm text-ink sm:text-display">
              <span className="block">Your code trusts</span>
              <span className="block">
                <span className="tabular-nums">
                  {proof.publishers !== null
                    ? proof.publishers.toLocaleString()
                    : "hundreds of"}
                </span>{" "}
                <span className="text-ink-subtle">strangers.</span>
              </span>
            </h1>

            <p className="mt-8 max-w-md text-[17px] leading-[1.6] text-ink-soft">
              Every package you install can be updated by someone you&apos;ve never met,
              and it lands in production automatically. Tavik proves exactly which of
              them can reach you, and shows the route they&apos;d take.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link href="/app/onboarding">
                <Button variant="primary" size="lg">
                  Scan your own project <span aria-hidden>↗</span>
                </Button>
              </Link>
              <Link
                href="/app"
                className="text-[15px] font-medium text-ink underline decoration-line-strong underline-offset-[6px] transition-colors hover:decoration-ink"
              >
                See it working
              </Link>
            </div>

            <p className="mt-6 text-[13px] text-ink-faint">
              Open source · runs on your machine · no account
            </p>
          </div>

          <div className="flex justify-center lg:justify-end">
            <Tavik pose="hero" size="xl" priority alt="Tavik" />
          </div>
        </section>

        {/* ── Live proof ────────────────────────────────────────────────── */}
        <section className="border-t border-line py-14">
          <p className="text-[12.5px] font-medium uppercase tracking-[0.16em] text-ink-subtle">
            Live, from this repository, right now
          </p>

          {proof.available ? (
            <>
              <dl className="mt-8 grid gap-8 sm:grid-cols-3">
                <Figure
                  value={proof.entities?.toLocaleString() ?? "—"}
                  label="packages, versions and publishers mapped"
                />
                <Figure
                  value={
                    proof.routes !== null
                      ? `${proof.routes}${proof.truncated ? "+" : ""}`
                      : "—"
                  }
                  label="ways an outside publisher can reach production"
                />
                <Figure
                  value={proof.elapsedMs !== null ? `${proof.elapsedMs}ms` : "—"}
                  label="to prove it, inside HydraDB"
                />
              </dl>

              {proof.shortestPath ? (
                <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
                  <div className="rounded-md bg-card p-6 shadow-card">
                    <PathTrace path={proof.shortestPath} />
                  </div>
                  <div>
                    <h3 className="text-[22px] font-semibold leading-snug tracking-tight text-ink">
                      This is the whole answer.
                    </h3>
                    <p className="mt-4 max-w-md text-[15.5px] leading-[1.6] text-ink-soft">
                      Not a severity score. A specific chain of relationships, every link
                      of which you can check against the public npm registry yourself.
                      That is what Tavik means by proof.
                    </p>
                    {proof.topPublisher ? (
                      <p className="mt-5 max-w-md text-[15.5px] leading-[1.6] text-ink-soft">
                        One account —{" "}
                        <span className="font-medium text-ink">
                          {proof.topPublisher.name}
                        </span>{" "}
                        — can publish to{" "}
                        <span className="font-medium text-ink">
                          {proof.topPublisher.packages}
                        </span>{" "}
                        of this project&apos;s packages. Not an accusation, just what the
                        registry says — and exactly the single point of failure every
                        large supply-chain attack has used.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-8 max-w-lg text-[16px] leading-relaxed text-ink-soft">
              Start the database with{" "}
              <code className="rounded-xs bg-card px-1.5 py-0.5 font-mono text-[14px]">
                npm run hydra:up
              </code>{" "}
              and scan a project to see live figures here.
            </p>
          )}
        </section>

        {/* ── How it works ──────────────────────────────────────────────── */}
        <section className="border-t border-line py-14">
          <h2 className="text-display-sm text-ink">
            <span className="block">Three steps.</span>
            <span className="block text-ink-subtle">Then it never stops.</span>
          </h2>

          <ol className="mt-10 space-y-9">
            <Step
              n="01"
              title="Point it at your project"
              body="Drop in a package-lock.json. Tavik reads what you actually installed, then asks the public npm registry who can publish each one."
            />
            <Step
              n="02"
              title="Say what must never happen"
              body="In your own words. “Nobody outside our approved list should reach production.” Tavik turns that into a question it can answer."
            />
            <Step
              n="03"
              title="It proves the answer, continuously"
              body="Not a risk score — a chain you can follow yourself. When anything changes, it checks again, and tells you the moment the answer changes."
            />
          </ol>
        </section>

        {/* ── The difference ────────────────────────────────────────────── */}
        <section className="border-t border-line py-14">
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <p className="text-[12.5px] font-medium uppercase tracking-[0.16em] text-ink-faint">
                Every other tool
              </p>
              <p className="mt-5 max-w-sm text-[20px] leading-[1.5] text-ink-subtle">
                Finds problems and hands you a list. You decide what matters — and you
                find out it was wrong the next time something changes.
              </p>
            </div>
            <div>
              <p className="text-[12.5px] font-medium uppercase tracking-[0.16em] text-accent">
                Tavik
              </p>
              <p className="mt-5 max-w-sm text-[20px] leading-[1.5] text-ink">
                Proves the one thing you said must never happen is still true, and tells
                you the moment it stops — with the exact route that broke it.
              </p>
            </div>
          </div>
        </section>

        {/* ── Honesty ───────────────────────────────────────────────────── */}
        <section className="border-t border-line py-14">
          <h2 className="max-w-xl text-display-sm text-ink">
            <span className="block">It tells you</span>
            <span className="block text-ink-subtle">when it doesn&apos;t know.</span>
          </h2>

          <dl className="mt-10 grid gap-9 md:grid-cols-3">
            <Principle
              title="“Not checked” is never “safe”"
              body="If Tavik can't finish a check, it says so. A false all-clear looks exactly like real safety on screen, which makes it the worst bug this product could have."
            />
            <Principle
              title="Counts are never inflated"
              body="When a result is capped it shows 25+, not 25. A sample presented as a total makes a partial fix look decisive when it isn't."
            />
            <Principle
              title="Nobody is accused"
              body="Real maintainers appear in your graph. Tavik states only capability — whether an account is on your list — never anything about the person."
            />
          </dl>
        </section>

        {/* ── Final CTA ─────────────────────────────────────────────────── */}
        <section className="border-t border-line py-14">
          <div className="flex flex-col items-center gap-8 rounded-lg bg-card px-8 py-12 text-center shadow-card">
            <Tavik pose="verified" size="lg" alt="" />
            <h2 className="max-w-xl text-display-sm text-ink">
              Find out who can reach your code.
            </h2>
            <p className="max-w-sm text-[16px] leading-[1.6] text-ink-soft">
              About a minute, entirely on your machine, on any project with a
              package-lock.json.
            </p>
            <Link href="/app/onboarding">
              <Button variant="primary" size="lg">
                Scan your project <span aria-hidden>↗</span>
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 border-t border-line px-6 py-10">
        <LogoMark size={22} />
        <p className="text-[13px] text-ink-faint">
          Built on{" "}
          <a
            href="https://github.com/hydra-db/hydradb"
            className="text-ink-soft underline underline-offset-4 hover:text-ink"
          >
            HydraDB
          </a>{" "}
          · package and publisher data from the public npm registry
        </p>
      </footer>
    </div>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dd className="text-[38px] font-semibold leading-none tracking-tight tabular-nums text-ink">
        {value}
      </dd>
      <dt className="mt-4 max-w-[16rem] text-[14px] leading-snug text-ink-soft">
        {label}
      </dt>
    </div>
  );
}

/** A numbered step. No container — the rule and the number carry the structure. */
function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="grid gap-4 sm:grid-cols-[4rem_1fr] sm:gap-8">
      <span className="text-[14px] font-medium tabular-nums text-accent">{n}</span>
      <div className="max-w-xl">
        <h3 className="text-[24px] font-semibold leading-snug tracking-tight text-ink">
          {title}
        </h3>
        <p className="mt-3 text-[16px] leading-[1.6] text-ink-soft">{body}</p>
      </div>
    </li>
  );
}

function Principle({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <dt className="text-[16.5px] font-semibold leading-snug tracking-tight text-ink">
        {title}
      </dt>
      <dd className="mt-3 text-[14.5px] leading-[1.6] text-ink-soft">{body}</dd>
    </div>
  );
}
