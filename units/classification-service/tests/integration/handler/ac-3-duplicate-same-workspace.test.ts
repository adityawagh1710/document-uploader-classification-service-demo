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
  await seedWorkspaceConfig(defaultWorkspaceConfig(workspaceId));
});

describe("AC-3 — duplicate detection within same workspace", () => {
  it("second upload of byte-identical content returns isDuplicate=true", async () => {
    const pdfContent = new TextEncoder().encode("%PDF-1.7\nfake pdf body content");
    const key = `doc-${randomUUID()}.pdf`;
    await seedS3Object(setup.s3Client, setup.bucket, key, pdfContent);

    // First upload — should write
    const first = await setup.service.classify({
      taskToken: "token-1",
      workspaceId,
      documentId: "doc-1",
      s3: { bucket: setup.bucket, key },
      hints: { extension: "pdf", contentType: "application/pdf" },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.dedup.isDuplicate).toBe(false);

    // Second upload — should short-circuit as duplicate
    const second = await setup.service.classify({
      taskToken: "token-2",
      workspaceId,
      documentId: "doc-2",
      s3: { bucket: setup.bucket, key },
      hints: { extension: "pdf", contentType: "application/pdf" },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.dedup.isDuplicate).toBe(true);
      expect(second.value.dedup.contentHash).toBe(first.ok ? first.value.dedup.contentHash : "");
    }
  });
});
