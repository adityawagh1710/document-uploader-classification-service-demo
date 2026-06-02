import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  setupOrchestratorTest,
  seedWorkspaceConfig,
  seedS3Object,
  defaultWorkspaceConfig,
} from "../_orchestrator-setup.js";
import type { OrchestratorTestSetup } from "../_orchestrator-setup.js";
import { getLocalstack } from "../../_helpers.js";

let setup: OrchestratorTestSetup;
let workspaceId: string;

beforeEach(async () => {
  setup = await setupOrchestratorTest();
  workspaceId = `test-${randomUUID()}`;
  await seedWorkspaceConfig(defaultWorkspaceConfig(workspaceId));
});

describe("Edge case — override flag leaves existing record fully immutable (BR-3-O-5 Case B)", () => {
  it("overrideDuplicateCheck=true on duplicate hit does NOT update lastSeenAt or hitCount", async () => {
    const pdfContent = new TextEncoder().encode("%PDF-1.7\noverride test");
    const key = `doc-${randomUUID()}.pdf`;
    await seedS3Object(setup.s3Client, setup.bucket, key, pdfContent);

    // First classify — writes record
    const r1 = await setup.service.classify({
      taskToken: "token-1",
      workspaceId,
      documentId: "doc-1",
      s3: { bucket: setup.bucket, key },
      hints: { extension: "pdf", contentType: null },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const contentHash = r1.value.dedup.contentHash;

    // Capture record state
    const { ddb } = getLocalstack();
    const before = await ddb.send(new GetCommand({
      TableName: setup.contentHashTable,
      Key: { workspaceId, contentHash },
    }));
    const beforeHitCount = before.Item?.hitCount;
    const beforeLastSeenAt = before.Item?.lastSeenAt;

    // Second classify with OVERRIDE flag — should NOT mutate record
    const setup2 = await setupOrchestratorTest({ fixedNow: "2026-05-22T12:00:00.000Z" });
    const r2 = await setup2.service.classify({
      taskToken: "token-2",
      workspaceId,
      documentId: "doc-2",
      s3: { bucket: setup.bucket, key },
      hints: { extension: "pdf", contentType: null },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: true },   // OVERRIDE
    });
    expect(r2.ok).toBe(true);

    // Verify record unchanged
    const after = await ddb.send(new GetCommand({
      TableName: setup.contentHashTable,
      Key: { workspaceId, contentHash },
    }));
    expect(after.Item?.hitCount).toBe(beforeHitCount);
    expect(after.Item?.lastSeenAt).toBe(beforeLastSeenAt);
  });
});
