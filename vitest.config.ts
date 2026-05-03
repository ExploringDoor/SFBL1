import { defineConfig } from "vitest/config";

export default defineConfig({
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
