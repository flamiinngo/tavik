import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Domain and engine logic is pure and runs in Node. Component tests, when
    // they arrive, get their own environment via a `// @vitest-environment`
    // pragma rather than slowing this suite down with jsdom everywhere.
    environment: "node",
    // `cli/` is included because it decides what gets checked in CI. A rules
    // file that parses when it should not is coverage a team believes it has
    // and does not, which is exactly the failure the whole product exists to
    // prevent — it deserves the same suite as the engine, not less.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "cli/**/*.test.ts"],
  },
});
