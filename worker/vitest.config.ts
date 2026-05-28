import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Each handler test is fast; this is just a safety floor against a hung
    // promise (an unresolved mock would otherwise hang vitest forever).
    testTimeout: 10_000,
  },
});
