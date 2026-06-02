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

describe("AC-10 — .docm with quarantineMacros=true routes to slipsheet (workspace-policy)", () => {
  it("DOCM detection + quarantine flag -> slipsheet with workspace-policy reason", async () => {
    await seedWorkspaceConfig({
      ...defaultWorkspaceConfig(workspaceId),
      quarantineMacros: true,
    });

    // Bytes chosen to defeat all three detection tiers so extension fallback
    // sets detectedFormat="docm" — which is what exercises the macro-quarantine
    // branch in SlipsheetDecider. Requirements:
    //   - Tier 1 (file-type): no signature match → low control bytes are safe
    //   - Tier 2 OLE2/ZIP: must not match the D0CF11E0… or 504B0304 signatures
    //   - Tier 3 text: hasBinaryBytes must return true so the text heuristic
    //     short-circuits. That gate fires only on bytes in [0x00..0x08] ∪
    //     [0x0e..0x1f] (per heuristics.ts BR-T-1). Two earlier candidates
    //     failed because they slipped past this gate:
    //       0xff 0xfe 0x00 0x01 → file-type claimed it as MP1 audio
    //       0xaa 0xbb 0xcc 0xdd 0xee 0xff → high-bit bytes aren't "binary"
    //         per BR-T-1, so Tier 3 routed it to the TXT fallback.
    const content = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    const key = `doc-${randomUUID()}.docm`;
    await seedS3Object(setup.s3Client, setup.bucket, key, content);

    const result = await setup.service.classify({
      taskToken: "token",
      workspaceId,
      documentId: "doc-1",
      s3: { bucket: setup.bucket, key },
      hints: { extension: "docm", contentType: null },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.classification.category).toBe("slipsheet");
      expect(result.value.classification.isForcedSlipsheet).toBe(true);
      expect(result.value.classification.slipsheetReason).toBe("workspace-policy");
    }
  });
});
