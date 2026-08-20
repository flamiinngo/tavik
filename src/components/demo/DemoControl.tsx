"use client";

import Link from "next/link";
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
    <Card className="overflow-hidden">
      {/* A compact strip rather than a full card. This is an invitation, not a
          section — giving it the height of a real panel left most of it empty
          and made the page read as a pile of unrelated boxes. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 px-6 py-5">
        <span className="inline-flex shrink-0 items-center rounded-pill bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent">
          Try it yourself
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold tracking-tight text-ink">
            Watch a rule break, then heal
          </h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
            Put <span className="font-medium text-ink">{publisher}</span> under review, the
            way a team pauses a publisher to look properly. Real change, real re-check.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {isQuarantined ? (
            <Button variant="secondary" disabled={pending} onClick={() => run("untrusted")}>
              {pending ? "Re-checking…" : "Finish the review"}
            </Button>
          ) : (
            <Button variant="primary" disabled={pending} onClick={() => run("quarantined")}>
              {pending ? "Checking…" : `Put ${publisher} under review`}
            </Button>
          )}

        </div>
      </div>

      {result ? (
        <div className="border-t border-line px-6 py-4">
          <p
            className={`text-[14px] ${
              result.status === "violated"
                ? "text-alert"
                : result.status === "verified"
                  ? "text-safe"
                  : "text-ink-soft"
            }`}
          >
            {result.message}
          </p>
          {result.status === "violated" ? (
            // A plain anchor here reloaded the whole application to move one
            // screen, which is slow anywhere and painful against a database
            // across the internet.
            <Link
              href="/app/boundaries/blocked-publishers"
              className="mt-2 inline-block text-[14px] font-medium text-accent underline-offset-4 hover:underline"
            >
              See the routes and approve a fix →
            </Link>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
