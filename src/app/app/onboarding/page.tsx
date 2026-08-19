import { SourcePicker } from "@/components/onboarding/SourcePicker";
import { Tavik } from "@/components/mascot/Tavik";

export const metadata = { title: "Scan a project" };

/**
 * Bring your own project.
 *
 * The whole engine runs against whatever lockfile is handed to it, so this is
 * the screen that turns Tavik from something we can demonstrate into something
 * anyone can use on their own code.
 */
export default function OnboardingPage() {
  return (
    <>
      <header className="flex h-16 shrink-0 items-center px-6 lg:px-8">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">Scan a project</h1>
      </header>

      <main className="w-full px-6 pb-16 lg:px-8">
        <div className="grid gap-12 py-6 lg:grid-cols-[1.1fr_1fr] lg:items-start lg:gap-16">
          <div className="min-w-0">
            <h2 className="text-display-sm text-ink">
              <span className="block">Point Tavik at</span>
              <span className="block text-ink-subtle">your own code.</span>
            </h2>
            <p className="mt-6 max-w-md text-[16px] leading-relaxed text-ink-soft">
              Give Tavik a repository, a lockfile, or your AWS account. It maps what
              you actually depend on, works out who can change it, and starts proving
              what can reach you.
            </p>

            <ol className="mt-9 space-y-5">
              <Step n="1" title="Reads what you actually installed">
                Exact resolved versions — npm, Yarn or pnpm — plus whose code runs in
                your CI workflows.
              </Step>
              <Step n="2" title="Finds out who can change it">
                One live request per package to the public registry. No credentials;
                the registry is public.
              </Step>
              <Step n="3" title="Builds the graph and checks your rules">
                Then shows every route into your service, with a chain you can follow
                yourself.
              </Step>
            </ol>

            <p className="mt-9 max-w-md text-[13.5px] leading-relaxed text-ink-subtle">
              Takes about a minute for a typical project. Nothing leaves your machine
              except the package names, which go to the public registry — the same
              request <code className="font-mono">npm install</code> makes.
            </p>
          </div>

          <div className="min-w-0">
            <SourcePicker />
            <div className="mt-6 flex items-center gap-4 rounded-md bg-card p-5 shadow-card">
              <Tavik pose="analyzing" size="sm" alt="" className="shrink-0" />
              <p className="text-[13.5px] leading-relaxed text-ink-soft">
                Nothing to hand? Paste{" "}
                <span className="font-mono text-ink">prettier/prettier</span> — a real,
                public repository with 900+ packages behind it.
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-[13px] font-semibold text-accent">
        {n}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[14px] leading-relaxed text-ink-soft">
          {children}
        </span>
      </span>
    </li>
  );
}
