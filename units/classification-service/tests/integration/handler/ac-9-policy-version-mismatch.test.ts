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

describe("AC-9 — policy-version mismatch triggers self-healing replaceOnPolicyMismatch", () => {
  it("subsequent classification with stale policyVersion re-classifies and overwrites", async () => {
    // Step 1: seed workspace with policyVersion v1
    await seedWorkspaceConfig({ ...defaultWorkspaceConfig(workspaceId), policyVersion: "v1" });

    const pdfContent = new TextEncoder().encode("%PDF-1.7\ncontent");
    const key = `doc-${randomUUID()}.pdf`;
    await seedS3Object(setup.s3Client, setup.bucket, key, pdfContent);

    // First classify — writes record with policyVersion=v1
    const first = await setup.service.classify({
      taskToken: "token-1",
      workspaceId,
      documentId: "doc-1",
      s3: { bucket: setup.bucket, key },
      hints: { extension: "pdf", contentType: null },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.policyVersion).toBe("v1");

    // Step 2: update workspace policyVersion to v2
    await seedWorkspaceConfig({ ...defaultWorkspaceConfig(workspaceId), policyVersion: "v2" });

    // Step 3: classify again — cached record has v1, current is v2 → re-classify
    const second = await setup.service.classify({
      taskToken: "token-2",
      workspaceId,
      documentId: "doc-2",
      s3: { bucket: setup.bucket, key },
      hints: { extension: "pdf", contentType: null },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
    });

    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.policyVersion).toBe("v2");
      expect(second.value.dedup.isDuplicate).toBe(false);  // self-healing re-classify
    }
  });
});
