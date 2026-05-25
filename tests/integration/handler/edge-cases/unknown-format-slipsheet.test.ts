import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  setupOrchestratorTest,
  seedWorkspaceConfig,
  seedS3Object,
  defaultWorkspaceConfig,
} from "../_orchestrator-setup.js";
import type { OrchestratorTestSetup } from "../_orchestrator-setup.js";

let setup: OrchestratorTestSetup;
let workspaceId: string;

beforeEach(async () => {
  setup = await setupOrchestratorTest();
  workspaceId = `test-${randomUUID()}`;
  await seedWorkspaceConfig(defaultWorkspaceConfig(workspaceId));
});

describe("Edge case — unknown format falls into slipsheet low-confidence (BR-3-OUT-3)", () => {
  it("a format outside the FR-6 mapping table routes to slipsheet", async () => {
    // Create a buffer that lands on extension-fallback with an extension
    // not present in any sub-category list (e.g., "xyz").
    const content = new Uint8Array([0xff, 0xfe]);
    const key = `doc-${randomUUID()}.xyz`;
    await seedS3Object(setup.s3Client, setup.bucket, key, content);

    const result = await setup.service.classify({
      taskToken: "token",
      workspaceId,
      documentId: "doc-1",
      s3: { bucket: setup.bucket, key },
      hints: { extension: "xyz", contentType: null },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.classification.category).toBe("slipsheet");
      expect(result.value.classification.isForcedSlipsheet).toBe(true);
      expect(result.value.classification.slipsheetReason).toBeTruthy();
    }
  });
});
