import { describe, it } from "vitest";
import fc from "fast-check";
import { createSlipsheetDecider } from "../../src/domain/slipsheet/index.js";

describe("PBT — Slipsheet", () => {
  const decider = createSlipsheetDecider();

  it("PBT-U1-018 — score === threshold always slipsheets with reason=low-confidence (when no other policy)", () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1, noNaN: true }), (t) => {
        const result = decider.decide({
          score: t,
          threshold: t,
          detectedFormat: "pdf",
          parentArchiveDepth: 0,
          maxZipDepth: 5,
          quarantineMacros: false,
          slipsheetRules: {},
        });
        return result.slipsheet && result.reason === "low-confidence";
      }),
      { numRuns: 100 },
    );
  });

  it("PBT-U1-019 — parentArchiveDepth >= maxZipDepth -> max-zip-depth reason (no workspace policy)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        (depth, maxDepth) => {
          fc.pre(depth >= maxDepth);
          const result = decider.decide({
            score: 0.99,
            threshold: 0.5,
            detectedFormat: "pdf",
            parentArchiveDepth: depth,
            maxZipDepth: maxDepth,
            quarantineMacros: false,
            slipsheetRules: {},
          });
          return result.slipsheet && result.reason === "max-zip-depth";
        },
      ),
      { numRuns: 100 },
    );
  });

  it("PBT-U1-020 — macro quarantine: quarantineMacros + docm/xlsm/pptm -> workspace-policy", () => {
    fc.assert(
      fc.property(fc.constantFrom("docm", "xlsm", "pptm"), (format) => {
        const result = decider.decide({
          score: 0.99,
          threshold: 0.5,
          detectedFormat: format,
          parentArchiveDepth: 0,
          maxZipDepth: 5,
          quarantineMacros: true,
          slipsheetRules: {},
        });
        return result.slipsheet && result.reason === "workspace-policy";
      }),
      { numRuns: 100 },
    );
  });
});
