import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["runtime/src/**/*.ts", "runtime/launcher/**/*.mjs"],
      // Executable entrypoints are exercised as child processes. V8 cannot
      // merge their counters into this process; their behaviour remains in
      // the integration gate instead of appearing here as false zeroes.
      exclude: ["runtime/src/index.ts", "runtime/src/capability-mcp.ts"],
      thresholds: {
        // This is a ratchet, not the definition of product completeness. The
        // behavioural matrix in docs/test-matrix.md is the release contract.
        statements: 71,
        branches: 61,
        functions: 76,
        lines: 77,
        "runtime/src/selection.ts": {
          statements: 96,
          branches: 92,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
