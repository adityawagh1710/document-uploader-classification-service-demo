import { describe, it, expect } from "vitest";
import { createOutputBuilder } from "../../../src/application/index.js";
import type { BuildOutputInput, DetectionState } from "../../../src/application/index.js";

const baseDetectionState: DetectionState = {
  tier: "file-type",
  detectedFormat: "pdf",
  matchType: "exact-unique-signature",
};

const baseInput: BuildOutputInput = {
  documentId: "doc-1",
  workspaceId: "ws-1",
  policyVersion: "v1",
  contentHash: "abc",
  isDuplicate: false,
  detectionState: baseDetectionState,
  slipsheetDecision: { slipsheet: false, reason: null },
  confidenceScore: 0.95,
  categoryDecision: { category: "ocr-direct", subCategory: null },
};

describe("OutputBuilder", () => {
  const builder = createOutputBuilder();

  it("builds non-slipsheet output with correct invariants (PBT-U3-003/004)", () => {
    const out = builder.build(baseInput);
    expect(out.classification.isForcedSlipsheet).toBe(false);
    expect(out.classification.slipsheetReason).toBeNull();
    expect(out.classification.subCategory).toBeNull();
    expect(out.classification.category).toBe("ocr-direct");
    expect(out.dedup.contentHash).toBe("abc");
  });

  it("slipsheet output sets isForcedSlipsheet=true and reason=non-null", () => {
    const out = builder.build({
      ...baseInput,
      slipsheetDecision: { slipsheet: true, reason: "max-zip-depth" },
    });
    expect(out.classification.isForcedSlipsheet).toBe(true);
    expect(out.classification.slipsheetReason).toBe("max-zip-depth");
    expect(out.classification.category).toBe("slipsheet");
    expect(out.classification.subCategory).toBeNull();
  });

  it("unknown format falls back to slipsheet low-confidence (BR-3-OUT-3)", () => {
    const out = builder.build({ ...baseInput, categoryDecision: null });
    expect(out.classification.isForcedSlipsheet).toBe(true);
    expect(out.classification.slipsheetReason).toBe("low-confidence");
    expect(out.classification.category).toBe("slipsheet");
  });

  it("subCategory only when category=convert", () => {
    const out = builder.build({
      ...baseInput,
      categoryDecision: { category: "convert", subCategory: "office" },
    });
    expect(out.classification.subCategory).toBe("office");
  });

  it("format defaults to 'unknown' when detectedFormat is null", () => {
    const out = builder.build({
      ...baseInput,
      detectionState: { tier: "extension-fallback", detectedFormat: null, matchType: "no-match" },
      categoryDecision: null,
    });
    expect(out.classification.format).toBe("unknown");
  });
});
