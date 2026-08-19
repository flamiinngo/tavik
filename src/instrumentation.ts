/**
 * Server startup hook.
 *
 * Next.js calls `register()` once when the server boots, which is where Tavik's
 * continuous verification begins. Starting it here rather than in a separate
 * process matters: "continuous" should not depend on someone remembering to run
 * a second command, and a claim that quietly relies on operator discipline is
 * not a claim worth making.
 */
export async function register() {
  // Only in the Node runtime — the scheduler holds a database connection and an
  // interval, neither of which belong in an edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Opt out for one-off commands and CI, where a background sweep would compete
  // with whatever is actually being run.
  if (process.env.TAVIK_DISABLE_SCHEDULER === "true") return;

  const { startScheduler } = await import("@/lib/engine/scheduler");
  startScheduler();
}
