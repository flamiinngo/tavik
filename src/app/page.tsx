import Link from "next/link";

import { PathTrace } from "@/components/graph/PathTrace";
import { Tavik } from "@/components/mascot/Tavik";
import { Button } from "@/components/ui/primitives";
import { loadLandingProof } from "@/lib/server/landing";

export const metadata = {
  title: "Tavik — prove who can reach your production code",
  description:
    "Every package you install can be updated by someone you've never met. Tavik proves which of them can reach production, and shows you the exact route.",
};

// Never cached: the numbers on this page are live, and a marketing page quoting
// a stale measurement as fact would undercut the entire pitch.
export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const proof = await loadLandingProof();

  return (
    <div className="min-h-screen bg-canvas">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="flex items-center gap-3">
          <Tavik pose="profile" size="sm" alt="" />
          <span className="text-[17px] font-semibold tracking-tight text-ink">Tavik</span>
        </span>
        <nav className="flex items-center gap-2">
          <Link href="/app/onboarding">
            <Button size="sm">Scan my project</Button>
          </Link>
          <Link href="/app">
            <Button size="sm" variant="primary">
              Open dashboard
            </Button>
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="grid items-center gap-10 py-12 lg:grid-cols-[1.3fr_1fr] lg:py-20">
          <div className="min-w-0">
            <p className="text-[13px] font-medium uppercase tracking-[0.16em] text-accent">
              Software supply chain security
            </p>

            {/* Two lines, with the number inline. Breaking after the figure
                stranded it on a line of its own and the sentence stopped
                reading as a sentence. */}
            <h1 className="mt-6 text-display-sm text-ink sm:text-display">
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

            <p className="mt-8 max-w-lg text-[17px] leading-relaxed text-ink-soft">
              Every package you install can be updated by someone you&apos;ve never met,
              and it lands in production automatically. Tavik proves exactly which of
              them can reach you — and shows you the route they&apos;d take.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link href="/app/onboarding">
                <Button variant="primary" size="lg">
                  Scan your own project <span aria-hidden>↗</span>
                </Button>
              </Link>
              <Link href="/app">
                <Button size="lg">See it working</Button>
              </Link>
            </div>

            <p className="mt-5 text-[13px] text-ink-faint">
              Free and open source. Runs on your machine. No account needed.
            </p>
          </div>

          <div className="flex justify-center lg:justify-end">
            <Tavik pose="hero" size="xl" priority alt="Tavik" className="w-64 lg:w-full lg:max-w-sm" />
          </div>
        </section>

        {/* ── Live proof ────────────────────────────────────────────────────
            Real measurements from this very repository. A landing page that
            asserts capability is marketing; one that shows its own current
            numbers is evidence, and it costs nothing to be honest when the
            product actually works. */}
        {proof.available ? (
          <section className="rounded-lg bg-card p-8 shadow-card sm:p-10">
            <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
              Live, from this repository, right now
            </p>

            <dl className="mt-7 grid gap-8 sm:grid-cols-3">
              <Figure
                value={proof.entities?.toLocaleString() ?? "—"}
                label="packages, versions and publishers mapped"
              />
              <Figure
                value={proof.routes !== null ? `${proof.routes}${proof.truncated ? "+" : ""}` : "—"}
                label="ways an outside publisher can reach production"
              />
              <Figure
                value={proof.elapsedMs !== null ? `${proof.elapsedMs}ms` : "—"}
                label="to prove it, inside HydraDB"
              />
            </dl>

            {proof.shortestPath ? (
              <div className="mt-9 border-t border-line pt-8">
                <p className="text-[14px] text-ink-soft">
                  The shortest of those routes, in full — every link checkable
                  against the public npm registry:
                </p>
                <div className="mt-5 max-w-md rounded-md bg-inset p-5">
                  <PathTrace path={proof.shortestPath} />
                </div>
              </div>
            ) : null}

            {proof.topPublisher ? (
              <p className="mt-8 border-t border-line pt-6 text-[15px] leading-relaxed text-ink-soft">
                One account —{" "}
                <span className="font-medium text-ink">{proof.topPublisher.name}</span> — can
                publish to{" "}
                <span className="font-medium text-ink">
                  {proof.topPublisher.packages}
                </span>{" "}
                of the packages this project depends on. That is not an accusation; it is
                simply what the registry says, and it is the kind of single point of
                failure every large supply-chain attack has exploited.
              </p>
            ) : null}
          </section>
        ) : (
          <section className="rounded-lg bg-card p-8 shadow-card">
            <p className="text-[15px] text-ink-soft">
              Start the database with{" "}
              <code className="rounded-xs bg-inset px-1.5 py-0.5 font-mono text-[13px]">
                npm run hydra:up
              </code>{" "}
              and ingest a project to see live numbers here.
            </p>
          </section>
        )}

        {/* ── How it works ──────────────────────────────────────────────── */}
        <section className="py-20">
          <h2 className="max-w-2xl text-display-sm text-ink">
            <span className="block">Three steps.</span>
            <span className="block text-ink-subtle">Then it never stops.</span>
          </h2>

          <ol className="mt-12 grid gap-6 md:grid-cols-3">
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
              body="Not a risk score — a specific chain of relationships you can follow yourself. When something changes, it checks again."
            />
          </ol>
        </section>

        {/* ── The difference ────────────────────────────────────────────── */}
        <section className="grid gap-10 rounded-lg bg-card p-8 shadow-card sm:p-12 lg:grid-cols-2">
          <div>
            <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
              Every other tool
            </p>
            <p className="mt-4 text-[19px] leading-relaxed text-ink-soft">
              Finds problems and hands you a list. You decide what matters, and you find
              out it&apos;s wrong the next time something changes.
            </p>
          </div>
          <div>
            <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-accent">
              Tavik
            </p>
            <p className="mt-4 text-[19px] leading-relaxed text-ink">
              Proves the one thing you said must never happen is still true — and tells
              you the moment it stops being true, with the exact route that broke it.
            </p>
          </div>
        </section>

        {/* ── Honesty ───────────────────────────────────────────────────── */}
        <section className="py-20">
          <h2 className="max-w-2xl text-display-sm text-ink">
            <span className="block">It tells you</span>
            <span className="block text-ink-subtle">when it doesn&apos;t know.</span>
          </h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            <Principle
              title="“Not checked” is never “safe”"
              body="If Tavik can't finish a check, it says so. A false all-clear looks exactly like real safety on screen, which makes it the worst bug this product could have."
            />
            <Principle
              title="Counts are never inflated"
              body="When a result is capped it shows 25+, not 25. A sample presented as a total makes a partial fix look decisive."
            />
            <Principle
              title="Nobody is accused"
              body="Real maintainers appear in your graph. Tavik states only capability — whether an account is on your list — never anything about the person."
            />
          </div>
        </section>

        {/* ── Final CTA ─────────────────────────────────────────────────── */}
        <section className="flex flex-col items-center gap-8 rounded-lg bg-card px-8 py-16 text-center shadow-card">
          <Tavik pose="verified" size="lg" alt="" />
          <h2 className="max-w-xl text-display-sm text-ink">
            Find out who can reach your production code.
          </h2>
          <p className="max-w-md text-[16px] leading-relaxed text-ink-soft">
            It takes about a minute, runs entirely on your machine, and works on any
            project with a package-lock.json.
          </p>
          <Link href="/app/onboarding">
            <Button variant="primary" size="lg">
              Scan your project <span aria-hidden>↗</span>
            </Button>
          </Link>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl border-t border-line px-6 py-10">
        <p className="text-[13px] text-ink-faint">
          Tavik · built on{" "}
          <a
            href="https://github.com/hydra-db/hydradb"
            className="text-ink-soft underline-offset-4 hover:underline"
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
      <dd className="text-[44px] font-semibold leading-none tracking-tight tabular-nums text-ink">
        {value}
      </dd>
      <dt className="mt-3 text-[14px] leading-snug text-ink-soft">{label}</dt>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="rounded-md bg-card p-7 shadow-card">
      <span className="text-[13px] font-medium tabular-nums text-accent">{n}</span>
      <h3 className="mt-4 text-[19px] font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-3 text-[14.5px] leading-relaxed text-ink-soft">{body}</p>
    </li>
  );
}

function Principle({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink-soft">{body}</p>
    </div>
  );
}
