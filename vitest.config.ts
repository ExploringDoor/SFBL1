import * as path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // Rules tests share the Firestore emulator instance — keep them serial
    // so per-test data isolation (clearFirestore) actually works.
    fileParallelism: false,
  },
});
