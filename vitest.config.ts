import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same "@/" alias tsconfig and Next resolve, so a unit test can import
  // application code without vitest needing a second copy of the path map.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // Shiki loads its grammars and theme on first use, which can take several
    // seconds on a cold run. Whichever test happens to render first pays that
    // cost, so the default 5s timeout makes the suite order-dependent.
    testTimeout: 30_000,
    include: ["packages/**/test/**/*.test.ts", "test/**/*.test.ts"],
  },
});
