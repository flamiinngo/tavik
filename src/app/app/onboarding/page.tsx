import { Guide } from "@/components/onboarding/Guide";
import { currentOperator } from "@/lib/server/operator";
import { loadSetupProgress } from "@/lib/server/tavik";

export const metadata = { title: "Get started" };
export const dynamic = "force-dynamic";

/**
 * The way in.
 *
 * This used to be one screen that scanned a project and then let go of you. Each
 * of Tavik's screens worked and nothing connected them, so someone scanned once
 * and was left on a dashboard to guess what came next — which is how a product
 * with good parts still reads as a pile of features.
 *
 * Four steps now, paged through, each one doing the thing rather than pointing
 * at it. What every step is worth is stated in the same breath as what it is,
 * because "add your name" means nothing until you know it is what makes the work
 * log worth reading later.
 *
 * The ticks are earned, never awarded. Every one is read back out of real state,
 * so clicking Next cannot mark anything done.
 */
export default async function GetStartedPage() {
  const operator = await currentOperator();
  const progress = await loadSetupProgress(operator.identified);

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between gap-6 px-6 lg:px-8">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">Get started</h1>
        <p className="text-[13px] text-ink-subtle">
          {progress.complete
            ? "All set up"
            : `${progress.doneCount} of ${progress.steps.length} done`}
        </p>
      </header>

      <main className="w-full px-6 pb-16 lg:px-8">
        <div className="py-6">
          <Guide progress={progress} operator={operator} />
        </div>
      </main>
    </>
  );
}
