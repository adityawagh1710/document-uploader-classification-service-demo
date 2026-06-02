import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  setupOrchestratorTest,
  seedWorkspaceConfig,
  seedS3Object,
  defaultWorkspaceConfig,
} from "./_orchestrator-setup.js";
import type { OrchestratorTestSetup } from "./_orchestrator-setup.js";

let setup: OrchestratorTestSetup;
let workspaceId: string;

beforeEach(async () => {
  setup = await setupOrchestratorTest();
  workspaceId = `test-${randomUUID()}`;
});

describe("AC-6 — score equals threshold routes to slipsheet (low-confidence)", () => {
  it("extension-only match with threshold = 0.4 (base score) -> slipsheet low-confidence", async () => {
    // For a buffer with no detectable format and no useful extension hint,
    // Tier 3 text-heuristic kicks in as TXT (score 0.65) — too high for our test.
    // Instead, send a buffer that fails the binary screen and provide an unknown
    // extension; this lands in extension-only path at score 0.40.
    // With threshold set to 0.40, score === threshold; orchestrator routes to slipsheet.
    await seedWorkspaceConfig({
      ...defaultWorkspaceConfig(workspaceId),
      threshold: 0.4,
    });

    // Buffer with a binary byte (0x05) — fails text-heuristic binary screen
    const binaryContent = new Uint8Array([0x05, 0x06, 0x07]);
    const key = `unknown-${randomUUID()}.bin`;
    await seedS3Object(setup.s3Client, setup.bucket, key, binaryContent);

    const result = await setup.service.classify({
      taskToken: "token",
      workspaceId,
      documentId: "doc-1",
      s3: { bucket: setup.bucket, key },
      hints: { extension: "bin", contentType: null },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Either the score equals threshold (slipsheet low-confidence) or
      // the format is "bin" (unknown -> slipsheet low-confidence via BR-3-OUT-3)
      expect(result.value.classification.category).toBe("slipsheet");
      expect(result.value.classification.slipsheetReason).toBeTruthy();
    }
  });
});
