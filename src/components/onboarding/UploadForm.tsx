"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/primitives";
import { ingestLockfile, type IngestUploadResult } from "@/app/app/onboarding/actions";

/**
 * Upload a lockfile and watch it ingest.
 *
 * Ingestion takes real time — one live registry request per package — so the
 * waiting state has to say what is actually happening rather than spin. A
 * progress indicator that explains itself is the difference between "this is
 * slow" and "this is doing something real", and here it happens to be true.
 *
 * Drag-and-drop and file-picking both work, plus a paste field, because someone
 * evaluating this on a remote machine may not have the file locally.
 */

const STAGES = [
  "Reading your lockfile",
  "Asking the registry who can publish",
  "Building the graph in HydraDB",
  "Checking your rules",
] as const;

export function UploadForm() {
  const [result, setResult] = useState<IngestUploadResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState(0);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(formData: FormData) {
    setResult(null);
    setStage(0);

    // The server action is one round trip, so the stages are paced rather than
    // reported. They are honest about *what* runs and in what order; only the
    // timing is estimated, and the real elapsed time is shown on completion.
    const timers = [
      setTimeout(() => setStage(1), 900),
      setTimeout(() => setStage(2), 6000),
      setTimeout(() => setStage(3), 12000),
    ];

    startTransition(async () => {
      const outcome = await ingestLockfile(formData);
      timers.forEach(clearTimeout);
      setResult(outcome);
    });
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  if (result?.ok) {
    return (
      <div className="rounded-lg bg-card p-8 shadow-card">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-safe">
          Scan complete
        </p>
        <h3 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight text-ink">
          {result.serviceName} is mapped.
        </h3>

        <dl className="mt-7 grid grid-cols-3 gap-5">
          <Figure value={result.packages?.toLocaleString() ?? "—"} label="packages" />
          <Figure value={result.publishers?.toLocaleString() ?? "—"} label="publishers" />
          <Figure
            value={result.elapsedMs ? `${(result.elapsedMs / 1000).toFixed(0)}s` : "—"}
            label="elapsed"
          />
        </dl>

        {result.failures ? (
          <p className="mt-6 text-[13px] leading-relaxed text-ink-subtle">
            {result.failures} package{result.failures === 1 ? "" : "s"} couldn&apos;t be
            resolved from the registry. Their routes are missing from the graph, so the
            picture is incomplete by that much — Tavik would rather tell you than quietly
            round up.
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/app">
            <Button variant="primary">See what it found <span aria-hidden>↗</span></Button>
          </Link>
          <Button
            onClick={() => {
              setResult(null);
              setFileName(null);
            }}
          >
            Scan another
          </Button>
        </div>
      </div>
    );
  }

  // ── Working ──────────────────────────────────────────────────────────────
  if (pending) {
    return (
      <div className="rounded-lg bg-card p-8 shadow-card">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">
          Working
        </p>
        <h3 className="mt-3 text-[22px] font-semibold tracking-tight text-ink">
          {STAGES[stage]}…
        </h3>
        <ol className="mt-7 space-y-3">
          {STAGES.map((label, index) => (
            <li key={label} className="flex items-center gap-3">
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-pill text-[11px] font-semibold ${
                  index < stage
                    ? "bg-safe-soft text-safe"
                    : index === stage
                      ? "animate-breathe bg-accent-soft text-accent"
                      : "bg-idle-soft text-ink-faint"
                }`}
                aria-hidden
              >
                {index < stage ? "✓" : index + 1}
              </span>
              <span
                className={`text-[14px] ${index <= stage ? "text-ink" : "text-ink-faint"}`}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-7 text-[13px] leading-relaxed text-ink-subtle">
          One live request per package, paced so the public registry isn&apos;t hammered.
          A typical project takes under a minute.
        </p>
      </div>
    );
  }

  // ── Idle ─────────────────────────────────────────────────────────────────
  return (
    <form ref={formRef} action={submit} className="rounded-lg bg-card p-8 shadow-card">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = event.dataTransfer.files?.[0];
          if (!dropped || !inputRef.current) return;
          const transfer = new DataTransfer();
          transfer.items.add(dropped);
          inputRef.current.files = transfer.files;
          setFileName(dropped.name);
        }}
        className={`rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-inset"
        }`}
      >
        <p className="text-[15px] font-medium text-ink">
          {fileName ?? "Drop your package-lock.json here"}
        </p>
        <p className="mt-1.5 text-[13.5px] text-ink-subtle">
          {fileName ? "Ready to scan" : "or choose it from your computer"}
        </p>

        <input
          ref={inputRef}
          type="file"
          name="lockfile"
          accept=".json,application/json"
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
          className="sr-only"
          id="lockfile-input"
        />
        <label htmlFor="lockfile-input" className="mt-5 inline-block">
          <span className="inline-flex h-10 cursor-pointer items-center rounded-pill bg-card px-5 text-[14px] font-medium text-ink shadow-pill ring-1 ring-line-strong transition-colors hover:bg-inset">
            Choose file
          </span>
        </label>
      </div>

      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="text-[13.5px] font-medium text-ink">
            What should Tavik call this?
          </span>
          <input
            name="serviceName"
            placeholder="e.g. checkout-api"
            className="mt-2 h-11 w-full rounded-sm bg-inset px-4 text-[14.5px] text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <span className="mt-1.5 block text-[12.5px] text-ink-subtle">
            Optional — defaults to the name in your lockfile.
          </span>
        </label>

        <details className="group">
          <summary className="cursor-pointer text-[13.5px] text-ink-soft hover:text-ink">
            Or paste the contents instead
          </summary>
          <textarea
            name="contents"
            rows={5}
            placeholder='{ "lockfileVersion": 3, ... }'
            className="mt-3 w-full rounded-sm bg-inset p-4 font-mono text-[12.5px] text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </details>
      </div>

      {result && !result.ok ? (
        <p className="mt-5 rounded-sm bg-alert-soft px-4 py-3 text-[13.5px] leading-relaxed text-alert">
          {result.message}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" className="mt-7 w-full">
        Scan this project
      </Button>
    </form>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[26px] font-semibold leading-none tabular-nums text-ink">
        {value}
      </p>
      <p className="mt-1.5 text-[12.5px] text-ink-subtle">{label}</p>
    </div>
  );
}
