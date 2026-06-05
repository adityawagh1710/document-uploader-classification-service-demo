import { bench, describe, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  setupOrchestratorTest,
  seedWorkspaceConfig,
  seedS3Object,
  defaultWorkspaceConfig,
} from "../integration/handler/_orchestrator-setup.js";
import type { OrchestratorTestSetup } from "../integration/handler/_orchestrator-setup.js";
import type { TaskPayload } from "../../src/shared/types.js";

let setup: OrchestratorTestSetup;
let smallPayload: TaskPayload;
let workspaceId: string;

beforeAll(async () => {
  setup = await setupOrchestratorTest();
  workspaceId = `bench-${randomUUID()}`;
  await seedWorkspaceConfig(defaultWorkspaceConfig(workspaceId));

  // Small (1 KB) PDF-like body
  const smallBody = new TextEncoder().encode("%PDF-1.7\n" + "x".repeat(1024));
  const smallKey = `small-${randomUUID()}.pdf`;
  await seedS3Object(setup.s3Client, setup.bucket, smallKey, smallBody);

  smallPayload = {
    taskToken: "bench-token",
    workspaceId,
    documentId: "bench-doc",
    s3: { bucket: setup.bucket, key: smallKey },
    hints: { extension: "pdf", contentType: "application/pdf" },
    context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
  };
});

describe("U-3 handler perf — end-to-end classify()", () => {
  bench("classify() — 1 KB PDF (LocalStack)", async () => {
    // We expect this to hit dedup path on repeated runs (CASE D); that's fine
    // for a perf bench — measures the real production path.
    await setup.service.classify(smallPayload);
  }, { iterations: 10, warmupIterations: 3 });
});
