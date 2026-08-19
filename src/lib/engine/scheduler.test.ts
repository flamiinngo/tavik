import { describe, expect, it } from "vitest";
import type { SecurityBoundary } from "@/lib/domain/boundary";
import type { ChangeEvent } from "@/lib/domain/change";
import { buildMessage } from "@/lib/notify/slack";

/**
 * What people are told, and when.
 *
 * The sweep itself is exercised end to end elsewhere — the stored timestamp was
 * watched advancing with nobody touching the app. What is worth pinning here is
 * the notification, because a message is the only part of Tavik most people will
 * ever read. If the first line does not carry the finding, the integration is
 * decoration.
 */

const boundary: SecurityBoundary = {
  id: "outside-publishers",
  name: "Outside publishers",
  statement: "Nobody outside our approved list should reach production.",
  source: { kind: "Maintainer", property: "trust", value: "untrusted", description: "outsiders" },
  target: { kind: "Service", property: "environment", value: "production", description: "production" },
  relations: ["MAINTAINS", "HAS_RELEASE", "SUPPLIES"],
  maxHops: 8,
  createdAt: 0,
  environmentId: "env-local",
};

function statusChange(
  from: "verified" | "violated" | "unknown",
  to: "verified" | "violated" | "unknown",
  appeared = 0,
): ChangeEvent {
  return {
    id: "e1",
    type: "boundary.status_changed",
    at: 1_755_000_000_000,
    actor: { kind: "tavik" },
    summary: `${boundary.name} changed from ${from} to ${to}.`,
    boundaryId: boundary.id,
    detail: {
      kind: "status_change",
      from,
      to,
      appearedPaths: Array.from({ length: appeared }, (_, index) => ({
        signature: `sig-${index}`,
        length: 3,
        hops: [
          { from: "tavik:maintainer:alex", relation: "MAINTAINS", to: "tavik:package:chalk" },
          { from: "tavik:package:chalk", relation: "HAS_RELEASE", to: "tavik:release:chalk:4.1.2" },
          { from: "tavik:release:chalk:4.1.2", relation: "SUPPLIES", to: "tavik:service:checkout" },
        ],
      })),
      resolvedPaths: [],
    },
  };
}

const APP = "https://tavik.example.com";

describe("buildMessage", () => {
  it("puts the finding in the preview text", () => {
    // Slack shows `text` in the notification. If the finding is only in the
    // blocks, the person sees "Tavik" and nothing else.
    const message = buildMessage(boundary, statusChange("verified", "violated", 3), APP);
    expect(String(message.text)).toContain("Outside publishers");
    expect(String(message.text)).toContain("3 new ways in");
  });

  it("says restored when a rule heals", () => {
    const message = buildMessage(boundary, statusChange("violated", "verified"), APP);
    expect(String(message.text)).toContain("restored");
  });

  it("agrees in number", () => {
    const one = buildMessage(boundary, statusChange("verified", "violated", 1), APP);
    expect(String(one.text)).toContain("1 new way in");
    expect(String(one.text)).not.toContain("ways");
  });

  it("carries the route, not just the verdict", () => {
    // "A rule broke" prompts a question. "This account reaches production
    // through these packages" answers it.
    const message = buildMessage(boundary, statusChange("verified", "violated", 1), APP);
    const rendered = JSON.stringify(message);
    expect(rendered).toContain("alex");
    expect(rendered).toContain("chalk");
    expect(rendered).toContain("checkout");
  });

  it("says how many more routes there are", () => {
    const message = buildMessage(boundary, statusChange("verified", "violated", 4), APP);
    expect(JSON.stringify(message)).toContain("and 3 more routes");
  });

  it("links straight to the rule", () => {
    const message = buildMessage(boundary, statusChange("verified", "violated", 1), APP);
    expect(JSON.stringify(message)).toContain(`${APP}/app/boundaries/outside-publishers`);
  });

  it("colours by outcome", () => {
    const broke = buildMessage(boundary, statusChange("verified", "violated", 1), APP);
    const healed = buildMessage(boundary, statusChange("violated", "verified"), APP);

    const colour = (m: Record<string, unknown>) =>
      (m.attachments as { color: string }[])[0].color;

    expect(colour(broke)).not.toBe(colour(healed));
  });

  it("does not shout", () => {
    // The colour bar and the word already carry the severity. A channel that
    // shouts gets muted, and a muted channel looks like coverage while
    // providing none.
    const rendered = JSON.stringify(
      buildMessage(boundary, statusChange("verified", "violated", 9), APP),
    );
    expect(rendered).not.toMatch(/URGENT|CRITICAL|ALERT!|🚨/);
  });

  it("survives a transition with no recorded routes", () => {
    // A rule can go unknown without any path being involved.
    expect(() =>
      buildMessage(boundary, statusChange("verified", "unknown", 0), APP),
    ).not.toThrow();
  });
});
