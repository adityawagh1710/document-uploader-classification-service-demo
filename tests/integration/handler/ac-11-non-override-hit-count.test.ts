import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  setupOrchestratorTest,
  seedWorkspaceConfig,
  seedS3Object,
  defaultWorkspaceConfig,
} from "./_orchestrator-setup.js";
import type { OrchestratorTestSetup } from "./_orchestrator-setup.js";
import { getLocalstack } from "../_helpers.js";

let setup: OrchestratorTestSetup;
let workspaceId: string;

beforeEach(async () => {
  setup = await setupOrchestratorTest();
  workspaceId = `test-${randomUUID()}`;
  await seedWorkspaceConfig(defaultWorkspaceConfig(workspaceId));
});

describe("AC-11 — non-override duplicate-hit increments hitCount and updates lastSeenAt", () => {
  it("second classification of same hash increments hitCount; immutable fields unchanged", async () => {
    const pdfContent = new TextEncoder().encode("%PDF-1.7\nsame content");
    const key = `doc-${randomUUID()}.pdf`;
    await seedS3Object(setup.s3Client, setup.bucket, key, pdfContent);

    const firstNow = "2026-05-22T10:00:00.000Z";
    const setup1 = setup;
    // Use fixedNow for first
    const r1 = await setup1.service.classify({
      taskToken: "token-1",
      workspaceId,
      documentId: "doc-1",
      s3: { bucket: setup.bucket, key },
      hints: { extension: "pdf", contentType: null },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
    });
    expect(r1.ok).toBe(true);

    // Second classification — make a new setup with later "now" to verify lastSeenAt advances
    const laterNow = "2026-05-22T11:30:00.000Z";
    const setup2 = await setupOrchestratorTest({ fixedNow: laterNow });
    const r2 = await setup2.service.classify({
      taskToken: "token-2",
      workspaceId,
      documentId: "doc-2",
      s3: { bucket: setup.bucket, key },
      hints: { extension: "pdf", contentType: null },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
    });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.dedup.isDuplicate).toBe(true);

    // Verify DDB record state directly
    const contentHash = r1.ok ? r1.value.dedup.contentHash : "";
    const { ddb } = getLocalstack();
    const ddbResult = await ddb.send(new GetCommand({
      TableName: setup.contentHashTable,
      Key: { workspaceId, contentHash },
    }));
    expect(ddbResult.Item).toBeDefined();
    if (ddbResult.Item) {
      expect(ddbResult.Item.hitCount).toBe(1);
      expect(ddbResult.Item.lastSeenAt).toBe(laterNow);
      expect(ddbResult.Item.firstSeenAt).toBe(firstNow);   // immutable
      expect(ddbResult.Item.firstDocumentId).toBe("doc-1");   // immutable
    }
  });
});

// Use the same setup with a different fixedNow
async function setupOrchestratorTest(opts: { fixedNow?: string } = {}) {
  const m = await import("./_orchestrator-setup.js");
  return m.setupOrchestratorTest(opts);
}
