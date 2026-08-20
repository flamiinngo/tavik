import { IdentifyForm } from "@/components/team/IdentifyForm";
import { StartFresh } from "@/components/team/StartFresh";
import { Card } from "@/components/ui/Card";
import { EmptyState, Timestamp } from "@/components/ui/primitives";
import {
  can,
  PERMISSION_LABELS,
  PERMISSIONS,
  ROLES,
  type Permission,
} from "@/lib/domain/team";
import { isPublicDemo } from "@/lib/env";
import { currentOperator } from "@/lib/server/operator";
import { tavik } from "@/lib/server/tavik";

export const metadata = { title: "Team" };
export const dynamic = "force-dynamic";

/**
 * Who is using Tavik, and what they are allowed to do.
 *
 * The product's whole safety claim is that a human approves every irreversible
 * change. That claim is empty if the record cannot say *which* human, so this
 * screen exists to make the work log name people.
 *
 * It is honest about what it is not. There is no password here because there is
 * nothing to authenticate against — Tavik runs as a single local workspace — and
 * a login form that checks nothing is worse than no login form, because it tells
 * a team they have a control they do not have.
 */

/** The labels read as verb phrases in a refusal message; here they start a row. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default async function TeamPage() {
  const operator = await currentOperator();

  // Decisions a person made, as distinct from what Tavik did on its own. That
  // split is the point of the change log's actor field.
  const { changeLog } = tavik();
  let decisions: Awaited<ReturnType<typeof changeLog.list>> = [];
  try {
    const all = await changeLog.list({ limit: 200 });
    decisions = all.filter((entry) => entry.actor.kind === "user").slice(0, 12);
  } catch {
    // A database that cannot be read must not take the screen down. The
    // identity form below still works — it writes a cookie, not a row.
  }

  const permissions = Object.keys(PERMISSIONS) as Permission[];

  return (
    <>
      <header className="flex h-16 shrink-0 items-center px-6 lg:px-8">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">Team</h1>
      </header>

      <main className="w-full px-6 pb-12 lg:px-8">
        <div className="py-6">
          <h2 className="text-display-sm text-ink">
            <span className="block">Every approval</span>
            <span className="block text-ink-subtle">gets a name on it.</span>
          </h2>
          <p className="mt-6 max-w-lg text-[16px] leading-[1.6] text-ink-soft">
            Tavik proposes; a person decides. That only means something if the
            record says who decided — so tell it who you are, and every fix you
            apply and every publisher you approve is filed under your name.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <div className="space-y-5">
            <IdentifyForm operator={operator} />

            {/* Said plainly rather than buried, because the alternative is a
                team believing a control exists that does not. */}
            <Card className="p-5">
              <h3 className="text-[14px] font-semibold tracking-tight text-ink">
                This is attribution, not a login
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
                Tavik runs as one workspace on your own machine or your own
                server, so there is no account system to check a password
                against. Anyone who can reach this page can change who they say
                they are. What the name buys you is a work log you could take
                into a review — not a wall.
              </p>
              <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
                Roles are enforced on the server for every action, so a viewer
                genuinely cannot apply a fix. That check is real; the identity it
                checks against is on trust.
              </p>
            </Card>

            <StartFresh canReset={can(operator.role, "manageWorkspace")} hosted={isPublicDemo()} />
          </div>

          <Card className="p-5">
            <h3 className="text-[14px] font-semibold tracking-tight text-ink">
              What each role can do
            </h3>
            <div className="mt-4 -mx-1 overflow-x-auto px-1">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr>
                    <th className="pb-2 text-[12px] font-medium text-ink-faint">Action</th>
                    {ROLES.map((role) => (
                      <th
                        key={role}
                        className="pb-2 pl-2 text-[12px] font-medium text-ink-faint capitalize"
                      >
                        {role.slice(0, 3)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((permission) => (
                    <tr key={permission} className="border-t border-line">
                      <td className="py-2.5 pr-2 text-[12.5px] leading-snug text-ink-soft">
                        {sentenceCase(PERMISSION_LABELS[permission])}
                      </td>
                      {ROLES.map((role) => (
                        <td key={role} className="py-2.5 pl-2 align-middle">
                          <span
                            className={
                              can(role, permission)
                                ? "text-[13px] font-medium text-safe"
                                : "text-[13px] text-ink-faint"
                            }
                            aria-label={can(role, permission) ? "allowed" : "not allowed"}
                          >
                            {can(role, permission) ? "yes" : "—"}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <section className="mt-10">
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">
            Decisions people made
          </h3>
          <p className="mt-1.5 max-w-lg text-[13.5px] leading-relaxed text-ink-soft">
            Only the entries a person caused. Everything Tavik did on its own is
            on the work log, kept separate on purpose.
          </p>

          {decisions.length > 0 ? (
            <ul className="mt-4 overflow-hidden rounded-lg bg-card shadow-card">
              {decisions.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line px-5 py-4 last:border-b-0"
                >
                  <span className="text-[13.5px] leading-relaxed text-ink">
                    {entry.summary}
                  </span>
                  <Timestamp at={entry.at} className="ml-auto shrink-0" />
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-4">
              <EmptyState
                title="Nobody has approved anything yet"
                description="Apply a fix or approve a publisher and it will appear here, with the name of whoever did it."
              />
            </div>
          )}
        </section>
      </main>
    </>
  );
}
