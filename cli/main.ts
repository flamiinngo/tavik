/**
 * The CLI's outermost boundary.
 *
 * Separate from `index.ts` so that `main()` stays a plain function returning an
 * exit code, which is testable. This file is the only place that touches
 * `process.exit`.
 *
 * Every error is turned into a sentence and code 3 rather than a stack trace.
 * A stack trace in a CI log tells the person reading it that the tool broke; a
 * sentence tells them what to do. The distinction matters more here than usual,
 * because the failure someone sees most often will be a missing token or an
 * unreachable database, and neither is a bug.
 */

import { ConfigError } from "./config";
import { main } from "./index";
import { errorLine, grey, red } from "./output";
import { EXIT } from "./runtime";

// Promise chain rather than top-level await: this file is transpiled to
// CommonJS, where top-level await does not exist. It is the only thing standing
// between the CLI and needing its own module system.
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    errorLine();
    errorLine(`  ${red(error instanceof Error ? error.message : String(error))}`);

    // The stack is still available when it is actually wanted, without making it
    // the default thing a build log shows.
    //
    // Never offered for a config error. Those are someone's file being wrong,
    // not Tavik being broken, and pointing at a stack trace sends them looking
    // for a bug in a tool when the answer is in the message they just read.
    const worthDebugging = error instanceof Error && !(error instanceof ConfigError);
    if (process.env.TAVIK_DEBUG && error instanceof Error && error.stack) {
      errorLine();
      errorLine(grey(error.stack));
    } else if (worthDebugging && error.stack) {
      errorLine(`  ${grey("Set TAVIK_DEBUG=1 for the full stack.")}`);
    }

    errorLine();
    process.exitCode = EXIT.ERROR;
  });
