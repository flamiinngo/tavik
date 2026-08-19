import { PublisherList, type PublisherRow } from "@/components/publishers/PublisherList";
import { Tavik } from "@/components/mascot/Tavik";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/primitives";
import { tavik } from "@/lib/server/tavik";

export const metadata = { title: "Publishers" };
export const dynamic = "force-dynamic";

/**
 * Everyone who can put code into your projects.
 *
 * This is the other way to close a rule, and the one a team is far more likely
 * to reach for. Removing a dependency usually breaks a build; looking at an
 * account and deciding it belongs on your list usually does not. Offering only
 * the first answer would be telling half the truth about how this work actually
 * gets done.
 */
export default async function PublishersPage() {
  let publishers: PublisherRow[] = [];
  let error: string | null = null;

  try {
    publishers = await tavik().store.listPublishers();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Couldn't read your publishers.";
  }

  const approved = publishers.filter((p) => p.trust === "trusted").length;
  const widest = publishers[0];

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between px-6 lg:px-8">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">Publishers</h1>
        <span className="text-[13px] text-ink-subtle">
          {approved} of {publishers.length} approved
        </span>
      </header>

      <main className="w-full px-6 pb-12 lg:px-8">
        <div className="py-6">
          <h2 className="text-display-sm text-ink">
            <span className="block tabular-nums">{publishers.length} people</span>
            <span className="block text-ink-subtle">can change your code.</span>
          </h2>
          <p className="mt-6 max-w-lg text-[16px] leading-[1.6] text-ink-soft">
            {widest ? (
              <>
                The widest reach belongs to{" "}
                <span className="font-medium text-ink">{widest.name}</span>, who can
                publish to {widest.packages} of the packages you depend on. Approving an
                account says you&apos;ve looked and accepted it — it says nothing about
                the person, and neither does leaving it unapproved.
              </>
            ) : (
              "Scan a project and Tavik will list everyone who can publish into it."
            )}
          </p>
        </div>

        {error ? (
          <Card className="p-6">
            <p className="text-[15px] font-medium text-ink">Couldn&apos;t read publishers</p>
            <p className="mt-1.5 text-[13.5px] text-ink-soft">{error}</p>
          </Card>
        ) : publishers.length === 0 ? (
          <Card>
            <EmptyState
              illustration={<Tavik pose="standby" size="lg" alt="" />}
              title="No publishers yet"
              description="Scan a project and Tavik will find everyone who can publish into it."
            />
          </Card>
        ) : (
          <PublisherList publishers={publishers} />
        )}
      </main>
    </>
  );
}
