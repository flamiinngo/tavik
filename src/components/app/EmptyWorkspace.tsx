"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Tavik } from "@/components/mascot/Tavik";
import { Button } from "@/components/ui/primitives";
import { ingestSampleProject } from "@/app/app/onboarding/actions";
import { scanRepository } from "@/app/app/onboarding/github-actions";

/**
 * What a new workspace looks like.
 *
 * Genuinely empty — no figures, no rules, no graph. Someone landing on a
 * dashboard full of numbers they did not create cannot tell a product from a
 * screenshot, and reasonably assumes the whole thing is staged. The first
 * numbers anyone sees here are their own.
 *
 * The box comes first, and that is the whole point of this screen.
 *
 * It used to be two buttons, one of which navigated somewhere else to find the
 * box. That is a fine arrangement for someone exploring and a poor one for
 * somebody who arrived wanting to try their own repository — which is the more
 * valuable visitor, because Tavik finding a route through code they wrote is
 * worth more than any project we could pick for them. So the fast path is
 * typing here and pressing return.
 *
 * The example stays, underneath, quiet. It is for whoever does not want to type
 * anything, and it should never be in the way of whoever does.
 */
export function EmptyWorkspace() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"repo" | "example" | null>(null);
  const [, startTransition] = useTransition();

  const run = (what: "repo" | "example", work: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(what);
    setError(null);
    startTransition(async () => {
      const result = await work();
      setBusy(null);
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  };

  const pending = busy !== null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <Tavik pose="standby" size="xl" priority alt="" className="mx-auto" />

      <h2 className="mt-10 text-display-sm text-ink">
        <span className="block">Nothing to watch</span>
        <span className="block text-ink-subtle">just yet.</span>
      </h2>

      <p className="mx-auto mt-6 max-w-md text-[16px] leading-[1.6] text-ink-soft">
        Give Tavik a public repository. It maps every package you depend on,
        finds out who is allowed to publish them, and starts proving what can
        reach you.
      </p>

      <form
        className="mx-auto mt-9 flex max-w-md flex-wrap gap-3"
        action={(formData) => run("repo", () => scanRepository(formData))}
      >
        <input
          name="repo"
          placeholder="owner/repository"
          autoComplete="off"
          autoFocus
          disabled={pending}
          className="h-12 min-w-48 flex-1 rounded-sm bg-card px-4 text-[15px] text-ink shadow-card placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        />
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {busy === "repo" ? "Scanning…" : "Scan it"}
        </Button>
      </form>

      {busy === "repo" ? (
        <p className="mt-5 text-[13.5px] leading-relaxed text-ink-subtle">
          Reading the lockfile, then asking the npm registry about every package
          in it. Around half a minute — the requests are real.
        </p>
      ) : (
        <p className="mt-4 text-[13px] text-ink-faint">
          Any public repository. Tavik finds the lockfile itself, and also reads
          <code className="mx-1 font-mono">.github/workflows</code>
          to see whose code runs in your CI.
        </p>
      )}

      {/* Secondary on purpose, and separated by a rule so it reads as the
          alternative rather than a second instruction. */}
      <div className="mx-auto mt-10 max-w-md border-t border-line pt-6">
        <p className="text-[13.5px] text-ink-soft">
          Nothing to hand?{" "}
          <button
            type="button"
            disabled={pending}
            onClick={() => run("example", ingestSampleProject)}
            className="font-medium text-accent underline-offset-4 hover:underline disabled:opacity-60"
          >
            {busy === "example" ? "Scanning an example…" : "Try one we picked"}
          </button>
        </p>
        <p className="mt-1.5 text-[12.5px] text-ink-faint">
          A real public project, scanned live. Not a fixture.
        </p>
      </div>

      {error ? (
        <p className="mx-auto mt-6 max-w-md rounded-sm bg-alert-soft px-4 py-3 text-[13.5px] leading-relaxed text-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
