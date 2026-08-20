"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { IdentifyForm } from "@/components/team/IdentifyForm";
import { RuleBuilder } from "@/components/rules/RuleBuilder";
import { SourcePicker } from "@/components/onboarding/SourcePicker";
import { Tavik } from "@/components/mascot/Tavik";
import { Button } from "@/components/ui/primitives";
import type { Operator } from "@/lib/server/operator";
import type { SetupProgress } from "@/lib/server/tavik";

/**
 * The guided path through Tavik, one step at a time.
 *
 * Each step does the thing rather than describing it and sending you elsewhere.
 * A walkthrough made of links is a table of contents: you leave on step one and
 * never come back, which is exactly how someone ended up on a dashboard with no
 * idea what to do second.
 *
 * The tick beside each step comes from real state — a service in the graph, a
 * name on the cookie, a rule that is not one of the five Tavik seeds, a check
 * that actually ran from the command line. Nothing here can be marked done by
 * clicking Next, because a checklist that ticks without the work being done
 * tells a team they are covered when they are not.
 */

const CONTENT: readonly {
  eyebrow: string;
  heading: readonly [string, string];
  blurb: string;
}[] = [
  {
    eyebrow: "Step 1",
    heading: ["Show Tavik", "your code."],
    blurb:
      "Point it at a repository, a lockfile, or an AWS account. It reads exactly what you install, asks the public registry who is allowed to publish each of those packages, and reads your CI workflows to see whose code runs inside your pipeline.",
  },
  {
    eyebrow: "Step 2",
    heading: ["Put your name", "on your decisions."],
    blurb:
      "Tavik proposes; a person decides. Every fix you apply and every publisher you approve gets filed under your name, so the work log is something you could take into a review months later.",
  },
  {
    eyebrow: "Step 3",
    heading: ["Say what must", "never happen."],
    blurb:
      "A rule is one claim: nothing over here should ever be able to reach anything over there. Tavik answers it against your real graph and keeps answering it. The five it starts with are a beginning, not your policy.",
  },
  {
    eyebrow: "Step 4",
    heading: ["Make it hold,", "not just watch."],
    blurb:
      "This is the step that turns Tavik from something you look at into something that stops a bad change. The same rules, run from your terminal or your CI, failing the build when one breaks.",
  },
];

export function Guide({
  progress,
  operator,
}: {
  progress: SetupProgress;
  operator: Operator;
}) {
  // Opens on the first thing left to do, so someone returning is not made to
  // page past work they have already finished — unless a link named a step, in
  // which case that wins. The overview links straight here to show somebody the
  // command line, and landing them on step one to click through three screens
  // they have already done is how a link stops being followed.
  const params = useSearchParams();
  const asked = progress.steps.findIndex((step) => step.id === params.get("step"));
  const firstUndone = progress.steps.findIndex((step) => !step.done);
  const [index, setIndex] = useState(asked !== -1 ? asked : firstUndone === -1 ? 0 : firstUndone);

  const step = progress.steps[index];
  const copy = CONTENT[index];
  const isLast = index === progress.steps.length - 1;

  return (
    <div>
      {/* ── Where you are ─────────────────────────────────────────────────── */}
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Setup steps">
        {progress.steps.map((entry, position) => (
          <li key={entry.id} className="flex-1 basis-24">
            <button
              type="button"
              onClick={() => setIndex(position)}
              aria-current={position === index ? "step" : undefined}
              className="group w-full text-left"
            >
              <span
                className={`block h-1 rounded-pill transition-colors ${
                  entry.done
                    ? "bg-safe"
                    : position === index
                      ? "bg-accent"
                      : "bg-line group-hover:bg-ink-faint"
                }`}
              />
              <span
                className={`mt-2 block truncate text-[12px] ${
                  position === index ? "font-medium text-ink" : "text-ink-faint"
                }`}
              >
                {entry.done ? "✓ " : ""}
                {entry.title}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {/* ── The step ──────────────────────────────────────────────────────── */}
      <div className="grid gap-10 pt-10 lg:grid-cols-[1fr_1.1fr] lg:items-start lg:gap-14">
        <div className="min-w-0">
          <p className="text-[12px] font-medium tracking-wide text-accent uppercase">
            {copy.eyebrow}
            {step.done ? " · done" : ""}
          </p>

          <h2 className="mt-3 text-display-sm text-ink">
            <span className="block">{copy.heading[0]}</span>
            <span className="block text-ink-subtle">{copy.heading[1]}</span>
          </h2>

          <p className="mt-6 max-w-md text-[15.5px] leading-[1.65] text-ink-soft">{copy.blurb}</p>

          {/* ── Next / previous ───────────────────────────────────────────── */}
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button
              size="md"
              disabled={index === 0}
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
            >
              <span aria-hidden>←</span> Back
            </Button>

            {isLast ? (
              <Link href="/app">
                <Button variant="primary" size="md">
                  Go to the dashboard <span aria-hidden>→</span>
                </Button>
              </Link>
            ) : (
              <Button
                variant="primary"
                size="md"
                onClick={() => setIndex((current) => Math.min(progress.steps.length - 1, current + 1))}
              >
                Next <span aria-hidden>→</span>
              </Button>
            )}

            <span className="text-[13px] text-ink-faint">
              {index + 1} of {progress.steps.length}
            </span>
          </div>

          {/* Said quietly, and only when it is true. A step someone has already
              done should not be nagging them from the same page. */}
          {!step.done ? (
            <p className="mt-6 flex items-start gap-3 text-[13px] leading-relaxed text-ink-subtle">
              <Tavik pose="standby" size="sm" alt="" className="shrink-0" />
              <span>
                You can skip ahead — nothing here is locked. The tick appears on
                its own once the step is genuinely done.
              </span>
            </p>
          ) : null}
        </div>

        {/* ── The thing itself ──────────────────────────────────────────────*/}
        <div className="min-w-0">
          <StepBody id={step.id} operator={operator} />
        </div>
      </div>
    </div>
  );
}

function StepBody({ id, operator }: { id: string; operator: Operator }) {
  switch (id) {
    case "scan":
      return <SourcePicker />;
    case "identify":
      return <IdentifyForm operator={operator} />;
    case "rule":
      return <RuleBuilder />;
    default:
      return <EnforceStep />;
  }
}

/**
 * The command line, shown rather than linked to.
 *
 * The product had a CLI for a while and never mentioned it anywhere someone
 * would look. A team could use Tavik for a week and never learn that the thing
 * on their screen could also fail a build.
 */
function EnforceStep() {
  return (
    <div className="rounded-lg bg-card p-6 shadow-card">
      <h3 className="text-[14.5px] font-semibold tracking-tight text-ink">Install it</h3>
      {/* Not `npm install -g tavik`. Tavik is not published to npm, so that
          command fails — and a setup instruction that does not work is the same
          class of dishonesty as a rule that reports safe without checking. This
          is what actually works today. */}
      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
        Tavik isn&apos;t on npm yet, so it installs from the clone you already
        have. <code className="font-mono text-ink">npm link</code> puts{" "}
        <code className="font-mono text-ink">tavik</code> on your PATH everywhere.
      </p>
      <div className="mt-3 space-y-2">
        <Command text="npm install && npm link" note="once, in the Tavik folder" />
      </div>

      <h3 className="mt-7 border-t border-line pt-6 text-[14.5px] font-semibold tracking-tight text-ink">
        Then, in any project
      </h3>
      <div className="mt-3 space-y-2">
        <Command text="tavik init" note="writes tavik.config.json, checks the connection" />
        <Command text="tavik scan" note="reads your lockfile and CI workflows" />
        <Command text="tavik check" note="answers every rule you've written" />
      </div>

      <h3 className="mt-7 border-t border-line pt-6 text-[14.5px] font-semibold tracking-tight text-ink">
        In CI, on every pull request
      </h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
        Two commands in your workflow, and a change that opens a route into
        production fails the build instead of being found later.
      </p>
      <div className="mt-3">
        <Command text="tavik scan && tavik check" />
      </div>

      <dl className="mt-6 space-y-2 border-t border-line pt-5 text-[12.5px] leading-relaxed">
        <div className="flex gap-3">
          <dt className="w-14 shrink-0 font-mono text-safe">exit 0</dt>
          <dd className="text-ink-soft">every rule was checked, and every rule holds</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-14 shrink-0 font-mono text-alert">exit 1</dt>
          <dd className="text-ink-soft">a rule has a way through</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-14 shrink-0 font-mono text-idle">exit 2</dt>
          <dd className="text-ink-soft">
            a rule could not be checked at all — because &ldquo;we didn&rsquo;t
            check&rdquo; must never pass a build quietly
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Command({ text, note }: { text: string; note?: string }) {
  return (
    <div>
      <code className="block overflow-x-auto rounded-sm bg-inset px-3 py-2.5 font-mono text-[12.5px] whitespace-nowrap text-ink">
        {text}
      </code>
      {note ? <p className="mt-1 px-1 text-[12px] text-ink-faint">{note}</p> : null}
    </div>
  );
}
