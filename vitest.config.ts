import * as path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Component render tests use JSX without importing React by hand, matching
  // the Next app's own transform.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    // .tsx too — component render tests (RulesRichView) need JSX.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // Rules tests share the Firestore emulator instance — keep them serial
    // so per-test data isolation (clearFirestore) actually works.
    fileParallelism: false,
  },
});
