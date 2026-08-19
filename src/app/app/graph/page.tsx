import Link from "next/link";

import { SecurityGraph } from "@/components/graph/SecurityGraph";
import { Tavik } from "@/components/mascot/Tavik";
import { Card, CardHeader, StatusRow } from "@/components/ui/Card";
import { STATUS_PRESENTATION } from "@/components/ui/Status";
import { Button, EmptyState } from "@/components/ui/primitives";
import { buildSubgraph, chokepoints } from "@/lib/domain/subgraph";
import { loadSecurityState } from "@/lib/server/tavik";

export const metadata = { title: "Security graph" };
export const dynamic = "force-dynamic";

/**
 * Every route currently getting through, across every rule.
 *
 * Deliberately not "the whole graph". Drawing 3,000 entities produces an
 * unreadable cloud that is also dishonest about what matters — almost none of
 * them are implicated in anything. What is worth drawing is the union of every
 * violating route, which is exactly the part of the estate that is currently
 * failing a rule someone wrote down.
 */
export default async function GraphPage() {
  const state = await loadSecurityState();

  const violated = state.boundaries.filter(
    (entry) => entry.verification && entry.verification.paths.length > 0,
  );

  const allPaths = violated.flatMap((entry) => entry.verification!.paths);
  const subgraph = allPaths.length > 0 ? buildSubgraph(allPaths) : null;
  const pinch = subgraph ? chokepoints(subgraph, 8) : [];

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between px-6 lg:px-8">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">Security graph</h1>
        {subgraph ? (
          <span className="text-[13px] text-ink-subtle">
            {subgraph.nodes.length} things · {subgraph.edges.length} connections
          </span>
        ) : null}
      </header>

      <main className="w-full space-y-5 px-6 pb-12 lg:px-8">
        <div className="py-6">
          <h2 className="text-display-sm text-ink">
            <span className="block">Everything that</span>
            <span className="block text-ink-subtle">gets through.</span>
          </h2>
          <p className="mt-6 max-w-lg text-[16px] leading-[1.6] text-ink-soft">
            Every route currently breaking a rule, drawn together. Only the
            implicated part of your estate — drawing all{" "}
            {state.entityCount?.toLocaleString() ?? "several thousand"} things
            would be a cloud, and almost none of them are involved.
          </p>
        </div>

        {!subgraph ? (
          <Card>
            <EmptyState
              illustration={<Tavik pose="verified" size="lg" alt="" />}
              title="Nothing is getting through"
              description="Every rule you've written is currently holding, so there are no routes to draw."
              action={
                <Link href="/app/boundaries">
                  <Button variant="primary">See your rules</Button>
                </Link>
              }
            />
          </Card>
        ) : (
          <>
            <Card>
              <div className="p-6">
                <SecurityGraph subgraph={subgraph} />
              </div>
            </Card>

            <div className="grid items-stretch gap-5 lg:grid-cols-2">
              <Card className="flex flex-col">
                <CardHeader
                  title="Weakest links"
                  subtitle="On the most routes at once. Cutting the top one removes the most exposure for a single change."
                />
                <ul className="space-y-1 px-3 pb-5">
                  {pinch.map((node) => (
                    <li key={node.id}>
                      <StatusRow
                        status="violated"
                        title={node.label}
                        subtitle={`${node.kind.toLowerCase()} · on ${node.routeCount} routes`}
                        trailing={`${node.routeCount}`}
                      />
                    </li>
                  ))}
                </ul>
              </Card>

              <Card className="flex flex-col">
                <CardHeader
                  title="Which rules these break"
                  subtitle="The same route often breaks more than one."
                />
                <ul className="space-y-1 px-3 pb-5">
                  {violated.map(({ boundary, verification }) => (
                    <li key={boundary.id}>
                      <StatusRow
                        status={verification!.status}
                        title={boundary.name}
                        subtitle={boundary.statement}
                        trailing={`${verification!.paths.length}${verification!.truncated ? "+" : ""}`}
                        href={`/app/boundaries/${boundary.id}`}
                      />
                    </li>
                  ))}
                  {violated.length === 0 ? (
                    <li className="px-4 py-3 text-[14px] text-ink-soft">
                      Nothing currently broken.
                    </li>
                  ) : null}
                </ul>
              </Card>
            </div>
          </>
        )}
      </main>
    </>
  );
}
