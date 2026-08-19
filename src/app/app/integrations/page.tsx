import { Card } from "@/components/ui/Card";
import { isSlackConfigured } from "@/lib/notify/slack";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

/**
 * What Tavik is connected to.
 *
 * Every row states what it actually does today, including the ones that do
 * nothing yet. A product that lists an integration it has not built is telling
 * a team they have coverage they do not have, which is the same failure as
 * reporting an unchecked rule as safe — worse, because nobody thinks to
 * question a green tick on a settings page.
 */

interface Integration {
  readonly name: string;
  readonly status: "connected" | "available" | "planned";
  readonly what: string;
  readonly setup?: string;
}

export default function IntegrationsPage() {
  const slackConnected = isSlackConfigured();

  const integrations: Integration[] = [
    {
      name: "npm registry",
      status: "connected",
      what: "Asks who can publish every package you depend on. One live request per package, no credentials — the registry is public.",
    },
    {
      name: "GitHub",
      status: "connected",
      what: "Reads lockfiles and CI workflows straight from any public repository. Set GITHUB_TOKEN to raise the rate limit or reach private repos.",
    },
    {
      name: "HydraDB",
      status: "connected",
      what: "Stores the graph and answers every reachability question. Nothing is computed in application code.",
    },
    {
      name: "AWS IAM",
      status: "connected",
      what: "Reads an account export to map who can reach your data. Read-only: you run the export, Tavik never touches AWS.",
      setup: "aws iam get-account-authorization-details > iam.json",
    },
    {
      name: "Slack",
      status: slackConnected ? "connected" : "available",
      what: slackConnected
        ? "Posts a message when a rule stops being true, or becomes true again. Transitions only — never routine checks."
        : "Posts when a rule breaks or heals. Add an incoming webhook URL to switch it on.",
      setup: slackConnected ? undefined : "SLACK_WEBHOOK_URL=https://hooks.slack.com/services/…",
    },
    {
      name: "Scheduled repo sync",
      status: "connected",
      what: "Re-reads watched repositories every fifteen minutes, and only does the expensive work when a lockfile has actually moved. Rules are re-checked every minute against whatever it finds.",
    },
    {
      name: "Command line",
      status: "connected",
      what: "The same engine and the same graph, from your terminal. `tavik scan` reads the project you're standing in; `tavik check` answers every rule and exits non-zero when one breaks.",
      // Not npx. Tavik is not published to npm, so npx would fail — and a setup
      // line that does not run is the same class of dishonesty as a rule that
      // reports safe without checking.
      setup: "npm install && npm link    # once, in the Tavik folder",
    },
    {
      name: "GitHub Actions",
      status: "connected",
      what: "Runs the check on every pull request and fails the build when a change opens a route into production. Writes the routes it found to the run summary, so the failure explains itself. Needs a HydraDB your runner can reach.",
      // The repository you cloned Tavik from. There is no published marketplace
      // action to point at yet, and inventing a name for one would send someone
      // to a workflow that fails on its first run.
      setup: "uses: <your-org>/tavik@main    # the repo you cloned",
    },
    {
      name: "Named operators",
      status: "connected",
      what: "Every approval is filed under a named person, and roles are enforced on the server for every action. Attribution, not authentication — Tavik runs as one workspace with nothing to check a password against, and the Team screen says so.",
    },
  ];

  return (
    <>
      <header className="flex h-16 shrink-0 items-center px-6 lg:px-8">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">Integrations</h1>
      </header>

      <main className="w-full px-6 pb-12 lg:px-8">
        <div className="py-6">
          <h2 className="text-display-sm text-ink">
            <span className="block">What Tavik</span>
            <span className="block text-ink-subtle">is plugged into.</span>
          </h2>
          <p className="mt-6 max-w-lg text-[16px] leading-[1.6] text-ink-soft">
            Each row says what it does today. The ones that do nothing yet say
            so — a security tool listing an integration it hasn&apos;t built is
            telling you that you have coverage you don&apos;t.
          </p>
        </div>

        <ul className="space-y-3">
          {integrations.map((integration) => (
            <li key={integration.name}>
              <Card className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[16px] font-semibold tracking-tight text-ink">
                      {integration.name}
                    </h3>
                    <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
                      {integration.what}
                    </p>
                    {integration.setup ? (
                      <code className="mt-3 block overflow-x-auto rounded-sm bg-inset px-3 py-2.5 font-mono text-[12.5px] text-ink">
                        {integration.setup}
                      </code>
                    ) : null}
                  </div>
                  <Status status={integration.status} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}

function Status({ status }: { status: Integration["status"] }) {
  const style =
    status === "connected"
      ? "bg-safe-soft text-safe"
      : status === "available"
        ? "bg-accent-soft text-accent"
        : "bg-idle-soft text-idle";
  const label =
    status === "connected" ? "Connected" : status === "available" ? "Ready to switch on" : "Not built";

  return (
    <span className={`shrink-0 rounded-pill px-3 py-1 text-[12.5px] font-medium ${style}`}>
      {label}
    </span>
  );
}
