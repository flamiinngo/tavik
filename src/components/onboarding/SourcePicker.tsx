"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/primitives";
import { ingestLockfile, type IngestUploadResult } from "@/app/app/onboarding/actions";
import { scanRepository, type ScanRepoResult } from "@/app/app/onboarding/github-actions";
import { ingestIamExport, type IamUploadResult } from "@/app/app/onboarding/iam-actions";

/**
 * Where Tavik gets its data.
 *
 * Three sources, one screen. Pasting a repository is first because it is the
 * only one that asks for nothing the person does not already have — no file to
 * find, no export to run — and a product that can be tried in five seconds gets
 * tried.
 *
 * Every source ends in the same place: entities and relationships in HydraDB,
 * checked by the same rules. What differs is only which door someone walks
 * through.
 */

type Source = "github" | "lockfile" | "cloud";

const SOURCES: { id: Source; label: string; hint: string }[] = [
  { id: "github", label: "A GitHub repository", hint: "Paste a URL. Nothing to install." },
  { id: "lockfile", label: "A lockfile", hint: "npm, Yarn or pnpm." },
  { id: "cloud", label: "AWS IAM", hint: "Who can reach your data." },
];

export function SourcePicker() {
  const [source, setSource] = useState<Source>("github");

  return (
    <div className="rounded-lg bg-card p-8 shadow-card">
      <div role="tablist" aria-label="Where to scan from" className="flex flex-wrap gap-2">
        {SOURCES.map((option) => {
          const selected = option.id === source;
          return (
            <button
              key={option.id}
              role="tab"
              aria-selected={selected}
              onClick={() => setSource(option.id)}
              className={`rounded-pill px-4 py-2 text-[13.5px] font-medium transition-colors ${
                selected
                  ? "bg-ink text-card"
                  : "bg-inset text-ink-soft hover:bg-sunken hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[13px] text-ink-subtle">
        {SOURCES.find((option) => option.id === source)?.hint}
      </p>

      <div className="mt-7">
        {source === "github" ? <GitHubForm /> : null}
        {source === "lockfile" ? <LockfileForm /> : null}
        {source === "cloud" ? <CloudForm /> : null}
      </div>
    </div>
  );
}

// ── GitHub ──────────────────────────────────────────────────────────────────

function GitHubForm() {
  const [result, setResult] = useState<ScanRepoResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (result?.ok) {
    return (
      <Done
        title={`${result.repo} is mapped.`}
        figures={[
          { value: result.packages?.toLocaleString() ?? "—", label: "packages" },
          { value: result.publishers?.toLocaleString() ?? "—", label: "publishers" },
          { value: String(result.actions ?? 0), label: "CI actions" },
        ]}
        note={
          result.unpinnedActions
            ? `${result.unpinnedActions} of those actions run from a moving tag rather than a fixed commit, so the code they run can change without the workflow changing.`
            : undefined
        }
        onReset={() => setResult(null)}
      />
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => setResult(await scanRepository(formData)))
      }
    >
      <label className="block">
        <span className="text-[14px] font-medium text-ink">Repository</span>
        <input
          name="repo"
          placeholder="vercel/next.js"
          autoComplete="off"
          className="mt-2 h-12 w-full rounded-sm bg-inset px-4 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <span className="mt-2 block text-[12.5px] leading-relaxed text-ink-subtle">
          Any public repository. Tavik finds the lockfile itself and also reads
          <span className="font-mono"> .github/workflows</span> to see whose code runs in CI.
        </span>
      </label>

      {result && !result.ok ? <Problem message={result.message} /> : null}

      {pending ? <Working /> : null}

      <Button type="submit" variant="primary" size="lg" disabled={pending} className="mt-6 w-full">
        {pending ? "Scanning…" : "Scan this repository"}
      </Button>
    </form>
  );
}

// ── Lockfile ────────────────────────────────────────────────────────────────

function LockfileForm() {
  const [result, setResult] = useState<IngestUploadResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (result?.ok) {
    return (
      <Done
        title={`${result.serviceName} is mapped.`}
        figures={[
          { value: result.packages?.toLocaleString() ?? "—", label: "packages" },
          { value: result.publishers?.toLocaleString() ?? "—", label: "publishers" },
          {
            value: result.elapsedMs ? `${(result.elapsedMs / 1000).toFixed(0)}s` : "—",
            label: "elapsed",
          },
        ]}
        note={
          result.failures
            ? `${result.failures} package${result.failures === 1 ? "" : "s"} couldn't be resolved from the registry, so their routes are missing from the graph. The picture is incomplete by exactly that much.`
            : undefined
        }
        onReset={() => {
          setResult(null);
          setFileName(null);
        }}
      />
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => setResult(await ingestLockfile(formData)))
      }
    >
      <input
        type="file"
        name="lockfile"
        id="lockfile-input"
        accept=".json,.yaml,.yml,.lock,application/json"
        onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
        className="sr-only"
      />
      <label
        htmlFor="lockfile-input"
        className="block cursor-pointer rounded-md border-2 border-dashed border-line-strong bg-inset px-6 py-10 text-center transition-colors hover:border-accent"
      >
        <span className="block text-[15px] font-medium text-ink">
          {fileName ?? "Choose a lockfile"}
        </span>
        <span className="mt-1.5 block text-[13px] text-ink-subtle">
          {fileName
            ? "Ready to scan"
            : "package-lock.json, yarn.lock or pnpm-lock.yaml"}
        </span>
      </label>

      <label className="mt-5 block">
        <span className="text-[14px] font-medium text-ink">What should Tavik call it?</span>
        <input
          name="serviceName"
          placeholder="checkout-api"
          className="mt-2 h-11 w-full rounded-sm bg-inset px-4 text-[14.5px] text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </label>

      {result && !result.ok ? <Problem message={result.message} /> : null}
      {pending ? <Working /> : null}

      <Button type="submit" variant="primary" size="lg" disabled={pending} className="mt-6 w-full">
        {pending ? "Scanning…" : "Scan this project"}
      </Button>
    </form>
  );
}

// ── Cloud ───────────────────────────────────────────────────────────────────

function CloudForm() {
  const [result, setResult] = useState<IamUploadResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (result?.ok) {
    return (
      <Done
        title="Your account is mapped."
        figures={[
          { value: String(result.roles ?? 0), label: "roles" },
          { value: String(result.ciIdentities ?? 0), label: "CI identities" },
          { value: String(result.datastores ?? 0), label: "data stores" },
        ]}
        note={result.message}
        onReset={() => {
          setResult(null);
          setFileName(null);
        }}
      />
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => setResult(await ingestIamExport(formData)))
      }
    >
      <div className="rounded-md bg-inset p-5">
        <p className="text-[13.5px] font-medium text-ink">Export your account first</p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          Read-only. Tavik never touches AWS itself — you run the export, and give
          Tavik the file.
        </p>
        <code className="mt-3 block overflow-x-auto rounded-xs bg-card px-3 py-2.5 font-mono text-[12.5px] text-ink">
          aws iam get-account-authorization-details &gt; iam.json
        </code>
      </div>

      <input
        type="file"
        name="iam"
        id="iam-input"
        accept=".json,application/json"
        onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
        className="sr-only"
      />
      <label
        htmlFor="iam-input"
        className="mt-5 block cursor-pointer rounded-md border-2 border-dashed border-line-strong bg-inset px-6 py-8 text-center transition-colors hover:border-accent"
      >
        <span className="block text-[15px] font-medium text-ink">
          {fileName ?? "Choose iam.json"}
        </span>
        <span className="mt-1.5 block text-[13px] text-ink-subtle">
          {fileName ? "Ready to import" : "The file the command above wrote"}
        </span>
      </label>

      {result && !result.ok ? <Problem message={result.message} /> : null}
      {pending ? <Working /> : null}

      <Button type="submit" variant="primary" size="lg" disabled={pending} className="mt-6 w-full">
        {pending ? "Importing…" : "Import this account"}
      </Button>
    </form>
  );
}

// ── Shared ──────────────────────────────────────────────────────────────────

function Done({
  title,
  figures,
  note,
  onReset,
}: {
  title: string;
  figures: { value: string; label: string }[];
  note?: string;
  onReset: () => void;
}) {
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-safe">
        Scan complete
      </p>
      <h3 className="mt-3 text-[24px] font-semibold leading-tight tracking-tight text-ink">
        {title}
      </h3>

      <dl className="mt-7 grid grid-cols-3 gap-5">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dd className="text-[26px] font-semibold leading-none tabular-nums text-ink">
              {figure.value}
            </dd>
            <dt className="mt-1.5 text-[12.5px] text-ink-subtle">{figure.label}</dt>
          </div>
        ))}
      </dl>

      {note ? (
        <p className="mt-6 text-[13px] leading-relaxed text-ink-subtle">{note}</p>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/app">
          <Button variant="primary">
            See what it found <span aria-hidden>↗</span>
          </Button>
        </Link>
        <Button onClick={onReset}>Scan something else</Button>
      </div>
    </div>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <p className="mt-5 rounded-sm bg-alert-soft px-4 py-3 text-[13.5px] leading-relaxed text-alert">
      {message}
    </p>
  );
}

/** Says what is happening, because it genuinely takes a while and silence reads
 *  as a hang. */
function Working() {
  return (
    <p className="mt-5 flex items-center gap-2.5 text-[13px] text-ink-soft">
      <span className="size-1.5 animate-breathe rounded-pill bg-accent" aria-hidden />
      Asking the registry about every package. A minute or so — the requests are real.
    </p>
  );
}
