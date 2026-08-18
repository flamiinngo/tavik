import type { ReachabilityPath } from "@/lib/domain/entities";

/**
 * The Path Trace — Tavik's signature component.
 *
 * A boundary violation is not a score and not an alert; it is a specific,
 * checkable route through infrastructure. So the route itself is the hero
 * object, and it is rendered the same way everywhere it appears — dashboard,
 * boundary detail, timeline, notification. Consistency matters here more than
 * anywhere else in the product: this is the thing a human is asked to believe,
 * and to act on.
 *
 * Read top to bottom, in the direction influence travels. The source is what can
 * act; the target is what would be affected. Every hop names the relationship
 * that permits it, because "these are connected" is not evidence — "this account
 * can publish to this package, which supplies this service" is.
 *
 * The vertical rail is continuous and coloured, so the eye follows one unbroken
 * line from cause to consequence rather than hopping between boxes.
 */

const KIND_GLYPH: Record<string, string> = {
  Maintainer: "◈",
  Package: "▣",
  Release: "▪",
  Service: "◉",
  Repository: "⬡",
  Environment: "◇",
  CiJob: "▶",
  Role: "◆",
  Datastore: "▬",
};

export interface PathTraceProps {
  path: ReachabilityPath;
  /**
   * `danger` for a live violation, `muted` for historical or resolved paths.
   * A path that no longer exists must not read with the same urgency as one
   * that does.
   */
  tone?: "danger" | "muted" | "accent";
  /** Index shown in the gutter when several paths are listed together. */
  ordinal?: number;
  className?: string;
}

const TONES = {
  danger: { rail: "bg-alert/40", node: "text-alert", edge: "text-alert/70" },
  accent: { rail: "bg-accent/40", node: "text-accent", edge: "text-accent/70" },
  muted: { rail: "bg-line-strong", node: "text-ink-subtle", edge: "text-ink-faint" },
} as const;

export function PathTrace({ path, tone = "danger", ordinal, className = "" }: PathTraceProps) {
  const colors = TONES[tone];
  const nodes = [path.hops[0].from, ...path.hops.map((hop) => hop.to)];

  return (
    <figure className={className}>
      <figcaption className="mb-3 flex items-baseline gap-3">
        {ordinal !== undefined ? (
          <span className="font-mono text-2xs tabular-nums text-ink-faint">
            {String(ordinal).padStart(2, "0")}
          </span>
        ) : null}
        <span className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
          {path.length} hop{path.length === 1 ? "" : "s"}
        </span>
      </figcaption>

      <ol className="relative">
        {nodes.map((node, index) => {
          const incoming = index === 0 ? null : path.hops[index - 1];
          const isLast = index === nodes.length - 1;

          return (
            <li key={`${node.urn}-${index}`} className="relative pl-6">
              {/* The rail. Stops at the final node so the line does not trail
                  past the consequence it is pointing at. */}
              {!isLast ? (
                <span
                  className={`absolute left-[3px] top-2 h-full w-px ${colors.rail}`}
                  aria-hidden
                />
              ) : null}

              {/* Relationship that permitted this hop. */}
              {incoming ? (
                <p className="py-1.5">
                  <span className={`font-mono text-2xs tracking-tight ${colors.edge}`}>
                    {incoming.relation.toLowerCase().replace(/_/g, " ")}
                  </span>
                </p>
              ) : null}

              <div className="flex items-baseline gap-2">
                <span
                  className={`absolute left-0 top-[7px] text-[9px] leading-none ${colors.node}`}
                  aria-hidden
                >
                  {KIND_GLYPH[node.kind] ?? "•"}
                </span>
                <span className="font-mono text-sm text-ink break-all">{node.name}</span>
                <span className="shrink-0 text-2xs uppercase tracking-wider text-ink-faint">
                  {node.kind}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

/**
 * A single-line form, for dense lists where a full trace would dominate.
 *
 * Scrolls horizontally rather than truncating: a half-shown package name is how
 * one dependency gets mistaken for another.
 */
export function PathTraceInline({
  path,
  tone = "danger",
  className = "",
}: {
  path: ReachabilityPath;
  tone?: PathTraceProps["tone"];
  className?: string;
}) {
  const colors = TONES[tone ?? "danger"];

  return (
    <div className={`overflow-x-auto ${className}`}>
      <div className="flex items-center gap-2 whitespace-nowrap py-0.5">
        <span className="font-mono text-xs text-ink">{path.hops[0].from.name}</span>
        {path.hops.map((hop, index) => (
          <span key={index} className="flex items-center gap-2">
            <span className={`font-mono text-2xs ${colors.edge}`}>
              ──{hop.relation.toLowerCase().replace(/_/g, " ")}──▸
            </span>
            <span className="font-mono text-xs text-ink">{hop.to.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
