"use client";

import { useState, useTransition } from "react";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/primitives";
import { setPublisherTrust, type DemoResult } from "@/app/app/demo-actions";

/**
 * The demo control.
 *
 * Placing a publisher under review is a real decision a security team makes, and
 * here it does the real thing: the trust label changes in the graph, and the
 * boundary is re-checked by the same engine that reports it everywhere else.
 * Nothing is faked and no state is short-circuited — press it and Tavik goes and
 * looks.
 *
 * It exists because the product's central claim is a *transition*, and a
 * transition needs something to move. Waiting for a real publisher to be
 * reviewed is not a demo; faking the transition would make the whole product
 * unbelievable. Causing it for real is the only honest option.
 *
 * On the wording: these are real npm accounts. "Under review" describes our own
 * process — pausing something pending a look — and says nothing about the
 * person. Nothing here implies wrongdoing by anyone.
 */

export function DemoControl({
  publisher,
  isQuarantined,
}: {
  publisher: string;
  isQuarantined: boolean;
}) {
  const [result, setResult] = useState<DemoResult | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (trust: "quarantined" | "untrusted") =>
    startTransition(async () => {
      setResult(await setPublisherTrust(publisher, trust));
    });

  return (
    <Card className="overflow-hidden" glow={isQuarantined ? "violated" : undefined}>
      <div className="flex items-center gap-2.5 border-b border-investigating/20 bg-investigating-dim px-5 py-2.5">
        <span className="rounded-xs bg-investigating/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-investigating">
          Try it
        </span>
        <span className="text-[13px] text-ink-muted">
          This makes a real change and re-checks for real.
        </span>
      </div>

      <div className="p-5">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">
          Watch a boundary break and heal
        </h2>
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-muted">
          Put{" "}
          <span className="font-mono text-ink">{publisher}</span> under review —
          the same thing a security team does when it wants to pause a publisher
          and look properly. Tavik will find every route their code already takes
          into production.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {isQuarantined ? (
            <Button variant="secondary" disabled={pending} onClick={() => run("untrusted")}>
              {pending ? "Re-checking…" : "Finish the review"}
            </Button>
          ) : (
            <Button variant="primary" disabled={pending} onClick={() => run("quarantined")}>
              {pending ? "Checking…" : `Put ${publisher} under review`}
            </Button>
          )}

          {result ? (
            <span
              className={`text-[13px] ${
                result.status === "violated"
                  ? "text-violated"
                  : result.status === "verified"
                    ? "text-verified"
                    : "text-ink-muted"
              }`}
            >
              {result.message}
            </span>
          ) : null}
        </div>

        {result?.status === "violated" ? (
          <p className="mt-3 text-[13px] text-ink-muted">
            Open{" "}
            <a
              href="/app/boundaries/blocked-publishers"
              className="text-accent underline-offset-2 hover:underline"
            >
              Quarantined publishers
            </a>{" "}
            to see the routes and approve a fix.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
