"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the browser has finished taking over the page.
 *
 * Server-rendered HTML arrives with every button drawn and none of them
 * working — the code behind them has not loaded yet. On a fast connection that
 * window is invisible. On a slow one, or on a page that waited on a cold
 * database before it could render at all, it is long enough to click a button,
 * get nothing, and reasonably conclude the thing is broken.
 *
 * So the controls that start real work say so: they stay disabled until this
 * turns true, which is an ordinary greyed-out button rather than a lie.
 *
 * `useSyncExternalStore` rather than an effect that sets state. It is the API
 * meant for values the server cannot know, it costs no extra render pass, and
 * React flags the effect version.
 */

const subscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
