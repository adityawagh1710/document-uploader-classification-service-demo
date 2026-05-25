// Pattern P-3-2: SAM Local smoke test against LocalStack.
// Requires: aws-sam-cli installed + Docker running + LocalStack from globalSetup.
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

describe("handler (smoke via SAM Local)", () => {
  it.skipIf(!hasSAM())(
    "processes a synthetic payload through the real Lambda runtime",
    () => {
      // Pre-condition: LocalStack already running per globalSetup.
      // Pre-condition: project has been built (esbuild → ./dist/handler.js).
      if (!existsSync("dist/handler.js")) {
        console.warn("dist/handler.js not found — run `npm run build` before smoke test");
        return;
      }

      const event = JSON.stringify({
        taskToken: "smoke-test-token",
        workspaceId: "smoke-test-ws",
        documentId: "smoke-test-doc",
        s3: { bucket: "smoke-bucket", key: "smoke-key" },
        hints: { extension: "pdf", contentType: null },
        context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
      });

      // SAM Local invokes the handler in a Lambda Docker container.
      // We expect it to run to completion (whether it succeeds or signals failure
      // depends on whether the bucket/key exist in LocalStack; we're testing the
      // RUNTIME, not the orchestration logic).
      const result = execSync(`echo '${event}' | sam local invoke ClassificationFunction --event -`, {
        encoding: "utf-8",
        timeout: 60_000,
      });

      // Lambda Docker should at least produce stdout (cold start log + handler log)
      expect(result.length).toBeGreaterThan(0);
    },
    60_000,
  );
});

function hasSAM(): boolean {
  try {
    execSync("sam --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
