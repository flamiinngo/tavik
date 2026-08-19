"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Tavik } from "@/components/mascot/Tavik";
import { Button } from "@/components/ui/primitives";
import { ingestSampleProject } from "@/app/app/onboarding/actions";

/**
 * What a new workspace looks like.
 *
 * Genuinely empty — no figures, no rules, no graph. Someone landing on a
 * dashboard full of numbers they did not create cannot tell a product from a
 * screenshot, and reasonably assumes the whole thing is staged. The first
 * numbers anyone sees here are their own.
 *
 * The sample is offered as a second option rather than pre-loaded, because
 * "here is your data" and "here is some data" are very different claims and the
 * difference has to be visible.
 */
export function EmptyWorkspace() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <Tavik pose="standby" size="xl" priority alt="" className="mx-auto" />

      <h2 className="mt-10 text-display-sm text-ink">
        <span className="block">Nothing to watch</span>
        <span className="block text-ink-subtle">just yet.</span>
      </h2>

      <p className="mx-auto mt-6 max-w-md text-[16px] leading-[1.6] text-ink-soft">
        Tavik hasn&apos;t seen any of your code. Give it a project and it will map
        every package you depend on, find out who can publish them, and start
        proving what can reach you.
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
        <Link href="/app/onboarding">
          <Button variant="primary" size="lg">
            Scan a project <span aria-hidden>↗</span>
          </Button>
        </Link>

        <Button
          size="lg"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await ingestSampleProject();
              setError(result.ok ? null : result.message);
            })
          }
        >
          {pending ? "Scanning sample…" : "Try a sample project"}
        </Button>
      </div>

      {pending ? (
        <p className="mt-5 text-[13.5px] text-ink-subtle">
          Asking the npm registry about every package. Takes about a minute — the
          requests are real.
        </p>
      ) : (
        <p className="mt-5 text-[13px] text-ink-faint">
          The sample scans Tavik&apos;s own dependencies. Same pipeline, same live
          registry — just a project you don&apos;t have to go and find.
        </p>
      )}

      {error ? (
        <p className="mx-auto mt-5 max-w-md rounded-sm bg-alert-soft px-4 py-3 text-[13.5px] text-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
