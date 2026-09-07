import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Shiki loads its grammars and theme on first use, which can take several
    // seconds on a cold run. Whichever test happens to render first pays that
    // cost, so the default 5s timeout makes the suite order-dependent.
    testTimeout: 30_000,
    include: ["packages/**/test/**/*.test.ts", "test/**/*.test.ts"],
  },
});
