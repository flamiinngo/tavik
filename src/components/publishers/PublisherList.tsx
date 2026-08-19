"use client";

import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/primitives";
import { setTrust, type TrustLevel } from "@/app/app/publishers/actions";

/**
 * Everyone who can put code into your projects.
 *
 * Sorted by reach, because that is what makes a decision urgent: an account that
 * can publish to one package is a small call, one that can publish to a hundred
 * is a single point of failure. The top of this list is where a security team's
 * time is actually worth spending.
 *
 * Every one of these is a real npm account. The three states describe *this
 * workspace's* posture — approved, not yet looked at, paused pending review —
 * and say nothing whatsoever about the person. "Not approved" is the honest
 * default for an account nobody has assessed, not an accusation.
 */

export interface PublisherRow {
  readonly urn: string;
  readonly name: string;
  readonly trust: string;
  readonly packages: number;
}

const FILTERS = [
  { id: "all", label: "Everyone" },
  { id: "untrusted", label: "Not approved" },
  { id: "trusted", label: "Approved" },
  { id: "quarantined", label: "Under review" },
] as const;

export function PublisherList({ publishers }: { publishers: readonly PublisherRow[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [search, setSearch] = useState("");
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return publishers
      .map((row) => ({ ...row, trust: overrides[row.name] ?? row.trust }))
      .filter((row) => (filter === "all" ? true : row.trust === filter))
      .filter((row) => (term ? row.name.toLowerCase().includes(term) : true));
  }, [publishers, filter, search, overrides]);

  function apply(name: string, trust: TrustLevel) {
    setPendingName(name);
    startTransition(async () => {
      const result = await setTrust(name, trust);
      setMessage(result.message);
      if (result.ok) setOverrides((current) => ({ ...current, [name]: trust }));
      setPendingName(null);
    });
  }

  const counts = useMemo(() => {
    const withOverrides = publishers.map((row) => overrides[row.name] ?? row.trust);
    return {
      trusted: withOverrides.filter((t) => t === "trusted").length,
      quarantined: withOverrides.filter((t) => t === "quarantined").length,
      untrusted: withOverrides.filter((t) => t === "untrusted").length,
    };
  }, [publishers, overrides]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" className="flex flex-wrap gap-2">
          {FILTERS.map((option) => {
            const selected = option.id === filter;
            const count =
              option.id === "all" ? publishers.length : counts[option.id];
            return (
              <button
                key={option.id}
                role="tab"
                aria-selected={selected}
                onClick={() => setFilter(option.id)}
                className={`rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  selected
                    ? "bg-ink text-card"
                    : "bg-card text-ink-soft shadow-card hover:text-ink"
                }`}
              >
                {option.label}
                <span className={selected ? "text-card/60" : "text-ink-faint"}>
                  {" "}
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a publisher"
          className="ml-auto h-10 w-56 rounded-pill bg-card px-4 text-[14px] text-ink shadow-card placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>

      {message ? (
        <p className="mt-4 rounded-sm bg-accent-soft px-4 py-3 text-[13.5px] text-accent">
          {message}
        </p>
      ) : null}

      <ul className="mt-5 overflow-hidden rounded-lg bg-card shadow-card">
        {rows.length === 0 ? (
          <li className="px-6 py-10 text-center text-[14px] text-ink-soft">
            No publishers match that.
          </li>
        ) : (
          rows.slice(0, 200).map((row) => (
            <li
              key={row.urn}
              className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-3.5 last:border-b-0"
            >
              <span className="w-12 shrink-0 text-right text-[15px] font-semibold tabular-nums text-ink">
                {row.packages}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[14px] text-ink">
                  {row.name}
                </span>
                <span className="text-[12.5px] text-ink-subtle">
                  can publish to {row.packages} package{row.packages === 1 ? "" : "s"} you
                  depend on
                </span>
              </span>

              <TrustBadge trust={row.trust} />

              <span className="flex shrink-0 gap-2">
                {row.trust !== "trusted" ? (
                  <Button
                    size="sm"
                    disabled={pendingName === row.name}
                    onClick={() => apply(row.name, "trusted")}
                  >
                    Approve
                  </Button>
                ) : null}
                {row.trust !== "quarantined" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pendingName === row.name}
                    onClick={() => apply(row.name, "quarantined")}
                  >
                    Review
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pendingName === row.name}
                    onClick={() => apply(row.name, "untrusted")}
                  >
                    End review
                  </Button>
                )}
              </span>
            </li>
          ))
        )}
      </ul>

      {rows.length > 200 ? (
        <p className="mt-4 text-[13px] text-ink-subtle">
          Showing the 200 with the widest reach, of {rows.length}. Search to find
          the rest.
        </p>
      ) : null}
    </div>
  );
}

function TrustBadge({ trust }: { trust: string }) {
  const style =
    trust === "trusted"
      ? "bg-safe-soft text-safe"
      : trust === "quarantined"
        ? "bg-watch-soft text-watch"
        : "bg-idle-soft text-idle";
  const label =
    trust === "trusted" ? "Approved" : trust === "quarantined" ? "Under review" : "Not approved";

  return (
    <span className={`shrink-0 rounded-pill px-2.5 py-1 text-[12px] font-medium ${style}`}>
      {label}
    </span>
  );
}
