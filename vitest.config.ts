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
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
