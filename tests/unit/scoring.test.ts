import { describe, it, expect } from "vitest";
import { createScorer } from "../../src/domain/scoring/index.js";

describe("Scorer", () => {
  const scorer = createScorer();

  it("returns 0.95 for exact-unique-signature with no modifiers", () => {
    expect(scorer.score({ matchType: "exact-unique-signature", detectedFormat: "pdf", extension: null, contentType: null })).toBe(0.95);
  });

  it("returns 0.9 for ole2-with-clsid", () => {
    expect(scorer.score({ matchType: "ole2-with-clsid", detectedFormat: "doc", extension: null, contentType: null })).toBe(0.9);
  });

  it("returns 0.0 for no-match", () => {
    expect(scorer.score({ matchType: "no-match", detectedFormat: null, extension: null, contentType: null })).toBe(0);
  });

  it("applies +0.05 extension corroboration", () => {
    expect(scorer.score({ matchType: "ole2-with-clsid", detectedFormat: "doc", extension: "doc", contentType: null })).toBeCloseTo(0.95);
  });

  it("applies -0.15 extension contradiction", () => {
    expect(scorer.score({ matchType: "zip-with-ooxml-or-odf", detectedFormat: "docx", extension: "pdf", contentType: null })).toBeCloseTo(0.75);
  });

  it("applies +0.05 content-type corroboration", () => {
    expect(scorer.score({ matchType: "exact-unique-signature", detectedFormat: "pdf", extension: null, contentType: "application/pdf" })).toBeCloseTo(1.0);
  });

  it("applies -0.10 content-type contradiction", () => {
    expect(scorer.score({ matchType: "exact-unique-signature", detectedFormat: "pdf", extension: null, contentType: "image/png" })).toBeCloseTo(0.85);
  });

  it("clamps at 1.0 (corroboration overflow)", () => {
    // base 0.95 + ext +0.05 + ct +0.05 = 1.05 -> clamped to 1.0
    const score = scorer.score({ matchType: "exact-unique-signature", detectedFormat: "pdf", extension: "pdf", contentType: "application/pdf" });
    expect(score).toBe(1.0);
  });

  it("clamps at 0.0 (no-match cannot go negative)", () => {
    const score = scorer.score({ matchType: "no-match", detectedFormat: null, extension: null, contentType: null });
    expect(score).toBe(0);
  });

  it("treats unknown extension as absent (modifier = 0)", () => {
    expect(scorer.score({ matchType: "ole2-with-clsid", detectedFormat: "doc", extension: "xyz", contentType: null })).toBe(0.9);
  });
});
