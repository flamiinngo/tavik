"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/primitives";
import { addWatch, removeWatch, syncNow } from "@/app/app/watches/actions";
import type { WatchedRepo } from "@/lib/engine/watched-repos";

/**
 * Repositories Tavik re-reads on its own.
 *
 * A failing watch shows its error rather than sitting quietly. A row that has
 * been broken for a week must not look like a repository that simply has not
 * changed — those are opposite situations that would otherwise render
 * identically, and mistaking one for the other means believing you have
 * coverage you lost days ago.
 */

export function WatchList({ watches }: { watches: readonly WatchedRepo[] }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <form
        action={(formData) =>
          startTransition(async () => {
            const result = await addWatch(formData);
            setMessage({ ok: result.ok, text: result.message });
          })
        }
        className="rounded-lg bg-card p-6 shadow-card"
      >
        <label className="block">
          <span className="text-[14px] font-medium text-ink">Watch a repository</span>
          <span className="mt-1.5 block text-[13px] leading-relaxed text-ink-soft">
            Tavik re-reads it every fifteen minutes and only does the expensive
            work when its lockfile has actually moved.
          </span>
          <div className="mt-3 flex flex-wrap gap-3">
            <input
              name="repo"
              placeholder="vercel/next.js"
              autoComplete="off"
              className="h-11 min-w-56 flex-1 rounded-sm bg-inset px-4 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Reading…" : "Watch it"}
            </Button>
          </div>
        </label>

        {message ? (
          <p
            className={`mt-4 rounded-sm px-4 py-3 text-[13.5px] leading-relaxed ${
              message.ok ? "bg-safe-soft text-safe" : "bg-alert-soft text-alert"
            }`}
          >
            {message.text}
          </p>
        ) : null}
      </form>

      {watches.length > 0 ? (
        <ul className="mt-5 overflow-hidden rounded-lg bg-card shadow-card">
          {watches.map((watched) => {
            const name = `${watched.owner}/${watched.repo}`;
            const isBusy = busy === name;

            return (
              <li
                key={name}
                className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4 last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[14px] text-ink">{name}</span>
                  <span className="mt-0.5 block text-[12.5px] text-ink-subtle">
                    {watched.lastError ? (
                      <span className="text-alert">{watched.lastError}</span>
                    ) : watched.lastChangedAt > 0 ? (
                      <>
                        last changed{" "}
                        {new Date(watched.lastChangedAt)
                          .toISOString()
                          .replace("T", " ")
                          .slice(0, 16)}
                        {watched.lastSha ? ` · ${watched.lastSha.slice(0, 7)}` : ""}
                      </>
                    ) : (
                      "not read yet"
                    )}
                  </span>
                </span>

                <span className="shrink-0 text-[12.5px] text-ink-faint">
                  {watched.lastCheckedAt > 0
                    ? `checked ${describeAge(watched.lastCheckedAt)}`
                    : "never checked"}
                </span>

                <span className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    disabled={isBusy}
                    onClick={() =>
                      startTransition(async () => {
                        setBusy(name);
                        const result = await syncNow(watched.owner, watched.repo);
                        setMessage({ ok: result.ok, text: result.message });
                        setBusy(null);
                      })
                    }
                  >
                    {isBusy ? "Reading…" : "Check now"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await removeWatch(watched.owner, watched.repo);
                        setMessage({ ok: result.ok, text: result.message });
                      })
                    }
                  >
                    Stop
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function describeAge(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
