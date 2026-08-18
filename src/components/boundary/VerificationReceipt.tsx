import type { BoundaryVerification, SecurityBoundary } from "@/lib/domain/boundary";

/**
 * The Verification Receipt.
 *
 * States exactly what was checked, against what, and how long it took. It is the
 * component that earns an engineer's trust, and it exists because "verified" is
 * a claim — a claim with no method attached is a slogan.
 *
 * It also makes the product's limits legible rather than hidden. The hop bound
 * is shown because a boundary checked to 8 hops has not been checked to 9, and
 * saying so is the difference between a tool that is honest about its scope and
 * one that quietly overstates it.
 */

export function VerificationReceipt({
  boundary,
  verification,
  className = "",
}: {
  boundary: SecurityBoundary;
  verification: BoundaryVerification;
  className?: string;
}) {
  const fields: readonly { label: string; value: string }[] = [
    { label: "engine", value: "hydradb algo.mspaths" },
    { label: "consistency", value: "strong" },
    { label: "hop bound", value: String(boundary.maxHops) },
    { label: "relations", value: boundary.relations.join(" ") },
    { label: "sources", value: verification.sourceCount.toLocaleString() },
    { label: "targets", value: verification.targetCount.toLocaleString() },
    { label: "routes found", value: verification.paths.length.toLocaleString() },
    { label: "elapsed", value: `${verification.elapsedMs.toFixed(0)}ms` },
    { label: "checked at", value: new Date(verification.verifiedAt).toISOString() },
  ];

  return (
    <dl
      className={`grid grid-cols-1 gap-x-8 gap-y-1.5 font-mono text-2xs sm:grid-cols-2 lg:grid-cols-3 ${className}`}
    >
      {fields.map((field) => (
        <div key={field.label} className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-1.5">
          <dt className="shrink-0 uppercase tracking-wider text-ink-faint">
            {field.label}
          </dt>
          <dd className="truncate text-right tabular-nums text-ink-muted" title={field.value}>
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
