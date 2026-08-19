import type { SecurityBoundary } from "@/lib/domain/boundary";
import type { ChangeEvent, StatusChangeDetail } from "@/lib/domain/change";

/**
 * Telling people when an answer changes.
 *
 * The product's premise is that nobody should have to sit watching a dashboard,
 * which only holds if Tavik can reach them where they already are. Without this
 * the scheduler notices a rule break at 2am and nobody finds out until somebody
 * happens to open a browser.
 *
 * Sends only *transitions*, never checks. A message every minute saying nothing
 * changed is how a channel gets muted, and a muted channel is worse than no
 * integration at all — it looks like coverage while providing none.
 *
 * Uses an incoming webhook rather than a Slack app: no OAuth, no bot user, no
 * scopes to review. A team pastes one URL and it works, which is the difference
 * between an integration someone sets up and one they mean to get around to.
 */

export interface SlackConfig {
  /** An incoming webhook URL. */
  readonly webhookUrl: string;
}

export class SlackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlackError";
  }
}

/** Read config from the environment; null when Slack is not set up. */
export function slackConfig(): SlackConfig | null {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl || !webhookUrl.startsWith("https://hooks.slack.com/")) return null;
  return { webhookUrl };
}

export function isSlackConfigured(): boolean {
  return slackConfig() !== null;
}

/**
 * Build the message for a status change.
 *
 * Written to be readable in a notification preview, because that is where most
 * of these are actually read — the first line has to carry the whole finding.
 * The route is included because "a rule broke" prompts a question and "this
 * account reaches production through these three packages" answers it.
 *
 * Tone is flat on purpose. No sirens, no bold ALERT: the colour bar and the word
 * already carry the severity, and a channel that shouts gets muted.
 */
export function buildMessage(
  boundary: SecurityBoundary,
  event: ChangeEvent,
  appUrl: string,
): Record<string, unknown> {
  const detail =
    event.detail?.kind === "status_change" ? (event.detail as StatusChangeDetail) : null;
  const to = detail?.to ?? "unknown";
  const broke = to === "violated";
  const healed = to === "verified";

  const colour = broke ? "#c2410c" : healed ? "#3f6212" : "#78716c";
  const headline = broke
    ? `${boundary.name} — ${detail?.appearedPaths.length ?? 0} new way${
        detail?.appearedPaths.length === 1 ? "" : "s"
      } in`
    : healed
      ? `${boundary.name} — restored`
      : `${boundary.name} — ${to}`;

  const blocks: Record<string, unknown>[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${headline}*\n${boundary.statement}` },
    },
  ];

  // The route itself, so the message answers its own question.
  const path = detail?.appearedPaths[0];
  if (path) {
    const chain = [
      path.hops[0]?.from.split(":").slice(2).join(":"),
      ...path.hops.map((hop) => hop.to.split(":").slice(2).join(":")),
    ]
      .filter(Boolean)
      .join(" → ");

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `\`\`\`${chain}\`\`\`` },
    });

    if ((detail?.appearedPaths.length ?? 0) > 1) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `and ${detail!.appearedPaths.length - 1} more route${
              detail!.appearedPaths.length === 2 ? "" : "s"
            }`,
          },
        ],
      });
    }
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: broke ? "See how, and fix it" : "See the proof" },
        url: `${appUrl}/app/boundaries/${boundary.id}`,
        style: broke ? "danger" : undefined,
      },
    ],
  });

  return {
    text: headline, // the notification preview, and the accessible fallback
    attachments: [{ color: colour, blocks }],
  };
}

/**
 * Post a message.
 *
 * Never throws. A notification failing must not take down the sweep that
 * produced it — the finding is already recorded, and losing the record because
 * Slack was unreachable would be a far worse outcome than a missed message.
 */
export async function postToSlack(
  payload: Record<string, unknown>,
  config: SlackConfig,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { ok: false, error: `Slack returned ${response.status}: ${await response.text()}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Couldn't reach Slack.",
    };
  }
}

/** Notify about one status change, if Slack is configured. */
export async function notifyStatusChange(
  boundary: SecurityBoundary,
  event: ChangeEvent,
): Promise<{ sent: boolean; error?: string }> {
  const config = slackConfig();
  if (!config) return { sent: false };

  const appUrl = process.env.TAVIK_APP_URL ?? "http://localhost:3000";
  const result = await postToSlack(buildMessage(boundary, event, appUrl), config);
  return { sent: result.ok, error: result.error };
}
