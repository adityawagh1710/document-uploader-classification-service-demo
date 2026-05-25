import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@domain": resolve(__dirname, "src/domain"),
      "@ports": resolve(__dirname, "src/ports"),
      "@shared": resolve(__dirname, "src/shared"),
      "@adapters": resolve(__dirname, "src/adapters"),
      "@application": resolve(__dirname, "src/application"),
    },
  },
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/pbt/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/regression/**/*.test.ts",
      "infra/lib/**/*.test.ts",
      "infra/config/**/*.test.ts",
    ],
    setupFiles: ["tests/pbt/_setup.ts"],
    globalSetup: ["./tests/integration/_setup.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/domain/**", "src/adapters/**", "src/application/**", "src/handler/**"],
      reporter: ["text", "json", "html"],
      thresholds: {
        "src/domain/**": {
          branches: 90,
          functions: 90,
          lines: 90,
          statements: 90,
        },
        "src/domain/tier2-ole2/**": {
          branches: 95,
          functions: 95,
          lines: 95,
          statements: 95,
        },
        "src/adapters/dynamo-content-hashes/**": {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
        "src/adapters/dynamo-workspace-config/**": {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
        "src/application/**": {
          branches: 75,
          functions: 75,
          lines: 75,
          statements: 75,
        },
        "src/handler/**": {
          branches: 75,
          functions: 75,
          lines: 75,
          statements: 75,
        },
        "src/adapters/s3/**": {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
        "src/adapters/crypto/**": {
          branches: 95,
          functions: 95,
          lines: 95,
          statements: 95,
        },
        "src/adapters/step-functions/**": {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
        "src/adapters/powertools/**": {
          branches: 75,
          functions: 75,
          lines: 75,
          statements: 75,
        },
      },
    },
    benchmark: {
      include: ["tests/perf/**/*.bench.ts"],
      reporters: ["verbose"],
    },
  },
});
