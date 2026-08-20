"use client";

import { useState, useSyncExternalStore } from "react";

/**
 * One line telling a stranger what they have walked into.
 *
 * Only on the public demo. Someone who installed Tavik knows what it is and does
 * not need a caption on their own dashboard; someone opening a link from a
 * submission form has never seen it before and lands on numbers about a project
 * they have never heard of, with nothing saying whose numbers they are or
 * whether any of it is real.
 *
 * It says the data is real and names the repository it came from, because the
 * first suspicion anyone sensible has about a demo is that the numbers were
 * typed in. And it points at the one thing worth doing — scanning something of
 * their own — since that is what turns a screenshot into a product.
 *
 * Dismissible, and stays dismissed. Nobody should have to read it twice.
 */

const KEY = "tavik.demo-banner.dismissed";

/**
 * Read once; nothing else writes this key, so there is nothing to subscribe to.
 *
 * `useSyncExternalStore` rather than reading localStorage inside an effect and
 * calling setState: that pattern triggers a second render pass on every visit
 * and React now flags it. This is the API meant for reading browser state that
 * the server cannot see, and it handles the hydration difference itself.
 *
 * The server snapshot says "dismissed", so a returning visitor never gets a
 * flash of a banner they already closed.
 */
const subscribe = () => () => {};
const dismissedOnClient = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Private browsing blocks storage. Showing the banner is the safe failure.
    return false;
  }
};
const dismissedOnServer = () => true;

export function DemoBanner({ scannedProject }: { scannedProject: string | null }) {
  const alreadyDismissed = useSyncExternalStore(
    subscribe,
    dismissedOnClient,
    dismissedOnServer,
  );
  const [dismissedNow, setDismissedNow] = useState(false);

  if (alreadyDismissed || dismissedNow) return null;

  return (
    // The close button is positioned rather than placed in the flow, and the
    // text is given a full row of its own until there is space for one line.
    //
    // The first version was a single flex row of four items with the sentence
    // set to flex-1 and the link and button set not to shrink. On a laptop that
    // reads as one tidy line. On a phone the two fixed items held their width
    // and the sentence got what was left, which was about forty pixels — one
    // word per line, twenty lines tall. A banner explaining that the numbers are
    // real cannot itself look broken.
    <div className="relative rounded-sm bg-ink py-3 pr-11 pl-4 text-canvas">
      <button
        type="button"
        onClick={() => {
          setDismissedNow(true);
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            // Nothing to do. It reappears next visit, which is a small cost.
          }
        }}
        aria-label="Dismiss"
        className="absolute top-1.5 right-1.5 grid size-9 place-items-center rounded-sm text-[18px] leading-none text-canvas/60 hover:text-canvas"
      >
        ×
      </button>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="shrink-0 rounded-pill bg-canvas/15 px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase">
          Live demo
        </span>

        {/* `basis-full` until small screens: the sentence takes a row to itself
            on a phone and shares one with the label and link on a laptop. */}
        <span className="min-w-0 basis-full text-[13.5px] leading-relaxed sm:flex-1 sm:basis-auto">
          {scannedProject ? (
            <>
              Everything here is real. Tavik scanned{" "}
              <strong className="font-semibold">{scannedProject}</strong> from
              GitHub and asked the npm registry who can publish each of its
              packages.
            </>
          ) : (
            <>
              Nothing has been scanned yet. Give Tavik a public repository and it
              maps who can reach it.
            </>
          )}
        </span>

        <a
          href="/app/onboarding"
          className="shrink-0 text-[13px] font-medium underline underline-offset-4 hover:no-underline"
        >
          Scan your own repo →
        </a>
      </div>
    </div>
  );
}
