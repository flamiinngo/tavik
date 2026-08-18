import type { BoundaryStatus, SecurityBoundary } from "@/lib/domain/boundary";

/**
 * The Boundary Claim — source, crossing, target, in one horizontal flow.
 *
 * A boundary asserts that nothing gets from one side to the other, so it is
 * drawn as a flow left to right, in the direction influence actually travels.
 * The centre states the crossing: how many routes exist, or that none do.
 *
 * An earlier version stacked an absolutely-positioned badge over a three-column
 * grid. It collided with the text at real content widths — truncating the
 * descriptions and overlapping the count. This version uses ordinary flow layout
 * with a fixed-width centre, so the two sides can wrap freely and nothing can
 * ever overlap regardless of how long a selector description is.
 *
 * Legible without colour: the connector is drawn as a broken line when routes
 * exist and a solid barrier when they do not, so the state survives greyscale
 * and colour-vision deficiency.
 */

export interface BoundaryGapProps {
  boundary: SecurityBoundary;
  status: BoundaryStatus;
  pathCount: number;
  sourceCount?: number;
  targetCount?: number;
  className?: string;
}

const ACCENT: Record<BoundaryStatus, string> = {
  verified: "text-verified",
  violated: "text-violated",
  investigating: "text-investigating",
  unknown: "text-unknown",
};

const LINE: Record<BoundaryStatus, string> = {
  verified: "bg-verified/40",
  violated: "bg-violated/50",
  investigating: "bg-investigating/40",
  unknown: "bg-unknown/40",
};

function Side({
  role,
  description,
  kind,
  property,
  value,
  count,
  align,
}: {
  role: string;
  description: string;
  kind: string;
  property: string;
  value: string;
  count?: number;
  align: "left" | "right";
}) {
  const alignment = align === "right" ? "items-end text-right" : "items-start text-left";
  return (
    <div className={`flex min-w-0 flex-1 flex-col justify-center gap-1.5 ${alignment}`}>
      <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
        {role}
      </p>
      <p className="text-sm leading-snug text-ink">{description}</p>
      <p className="font-mono text-2xs leading-relaxed text-ink-subtle">
        {kind.toLowerCase()} · {property}={value}
      </p>
      {count !== undefined ? (
        <p className="font-mono text-2xs tabular-nums text-ink-faint">
          {count.toLocaleString()} matched
        </p>
      ) : null}
    </div>
  );
}

export function BoundaryGap({
  boundary,
  status,
  pathCount,
  sourceCount,
  targetCount,
  className = "",
}: BoundaryGapProps) {
  const breached = status === "violated";
  const uncertain = status === "unknown";

  return (
    <div
      className={`flex flex-col gap-6 sm:flex-row sm:items-stretch sm:gap-4 ${className}`}
    >
      <Side
        role="Source"
        description={boundary.source.description}
        kind={boundary.source.kind}
        property={boundary.source.property}
        value={boundary.source.value}
        count={sourceCount}
        align="right"
      />

      {/* The crossing. Fixed width so the sides never compete with it. */}
      <div className="flex w-full shrink-0 flex-row items-center justify-center gap-3 sm:w-44 sm:flex-col sm:gap-2">
        <span className={`h-px flex-1 sm:h-8 sm:w-px sm:flex-none ${LINE[status]}`} aria-hidden />

        <span className="flex shrink-0 flex-col items-center">
          {breached ? (
            <>
              <span className={`font-mono text-2xl leading-none tabular-nums ${ACCENT[status]}`}>
                {pathCount}
              </span>
              <span className="mt-1 text-2xs uppercase tracking-wider text-ink-faint">
                {pathCount === 1 ? "route across" : "routes across"}
              </span>
            </>
          ) : (
            <>
              <span className={`text-lg leading-none ${ACCENT[status]}`} aria-hidden>
                {uncertain ? "?" : "|"}
              </span>
              <span className={`mt-1.5 text-2xs uppercase tracking-wider ${ACCENT[status]}`}>
                {uncertain ? "unchecked" : "no route"}
              </span>
            </>
          )}
        </span>

        <span className={`h-px flex-1 sm:h-8 sm:w-px sm:flex-none ${LINE[status]}`} aria-hidden />
      </div>

      <Side
        role="Target"
        description={boundary.target.description}
        kind={boundary.target.kind}
        property={boundary.target.property}
        value={boundary.target.value}
        count={targetCount}
        align="left"
      />
    </div>
  );
}
