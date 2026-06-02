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

beforeEach(async () => {
  setup = await setupOrchestratorTest();
});

describe("AC-4 — cross-workspace isolation", () => {
  it("same byte-identical file in different workspaces both proceed normally", async () => {
    const wsA = `test-${randomUUID()}`;
    const wsB = `test-${randomUUID()}`;
    await seedWorkspaceConfig(defaultWorkspaceConfig(wsA));
    await seedWorkspaceConfig(defaultWorkspaceConfig(wsB));

    const pdfContent = new TextEncoder().encode("%PDF-1.7\nshared content");
    const keyA = `doc-${randomUUID()}.pdf`;
    const keyB = `doc-${randomUUID()}.pdf`;
    await seedS3Object(setup.s3Client, setup.bucket, keyA, pdfContent);
    await seedS3Object(setup.s3Client, setup.bucket, keyB, pdfContent);

    const resultA = await setup.service.classify({
      taskToken: "token-A",
      workspaceId: wsA,
      documentId: "doc-A",
      s3: { bucket: setup.bucket, key: keyA },
      hints: { extension: "pdf", contentType: null },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
    });
    const resultB = await setup.service.classify({
      taskToken: "token-B",
      workspaceId: wsB,
      documentId: "doc-B",
      s3: { bucket: setup.bucket, key: keyB },
      hints: { extension: "pdf", contentType: null },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
    });

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (resultA.ok && resultB.ok) {
      expect(resultA.value.dedup.isDuplicate).toBe(false);
      expect(resultB.value.dedup.isDuplicate).toBe(false);
      // Same content -> same hash
      expect(resultA.value.dedup.contentHash).toBe(resultB.value.dedup.contentHash);
    }
  });
});
