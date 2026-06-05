import { describe, it, expect } from "vitest";
import { createSlipsheetDecider } from "../../src/domain/slipsheet/index.js";
import type { SlipsheetInput } from "../../src/domain/slipsheet/index.js";

const baseInput: SlipsheetInput = {
  score: 0.9,
  threshold: 0.5,
  detectedFormat: "docx",
  parentArchiveDepth: 0,
  maxZipDepth: 5,
  quarantineMacros: false,
  slipsheetRules: {},
};

describe("SlipsheetDecider", () => {
  const decider = createSlipsheetDecider();

  it("does not slipsheet when score exceeds threshold and no policy triggers", () => {
    expect(decider.decide(baseInput)).toEqual({ slipsheet: false, reason: null });
  });

  it("slipsheets at threshold boundary (score === threshold) with reason=low-confidence", () => {
    expect(decider.decide({ ...baseInput, score: 0.5, threshold: 0.5 })).toEqual({
      slipsheet: true,
      reason: "low-confidence",
    });
  });

  it("slipsheets with reason=max-zip-depth when depth >= maxZipDepth", () => {
    expect(decider.decide({ ...baseInput, parentArchiveDepth: 5, maxZipDepth: 5 })).toEqual({
      slipsheet: true,
      reason: "max-zip-depth",
    });
  });

  it("slipsheets with reason=workspace-policy when quarantineMacros + .docm", () => {
    expect(decider.decide({ ...baseInput, detectedFormat: "docm", quarantineMacros: true })).toEqual({
      slipsheet: true,
      reason: "workspace-policy",
    });
  });

  it("workspace-policy wins over max-zip-depth (precedence)", () => {
    expect(decider.decide({
      ...baseInput,
      detectedFormat: "docm",
      quarantineMacros: true,
      parentArchiveDepth: 10,
      maxZipDepth: 5,
    })).toEqual({ slipsheet: true, reason: "workspace-policy" });
  });

  it("max-zip-depth wins over low-confidence (precedence)", () => {
    expect(decider.decide({
      ...baseInput,
      score: 0.3,
      threshold: 0.5,
      parentArchiveDepth: 5,
      maxZipDepth: 5,
    })).toEqual({ slipsheet: true, reason: "max-zip-depth" });
  });

  it("slipsheetRules['format']='always-slipsheet' triggers workspace-policy", () => {
    expect(decider.decide({
      ...baseInput,
      detectedFormat: "pdf",
      slipsheetRules: { pdf: "always-slipsheet" },
    })).toEqual({ slipsheet: true, reason: "workspace-policy" });
  });
});
