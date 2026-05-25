import { describe, it } from "vitest";
import fc from "fast-check";
import { createCategoryMapper, FR6_TABLE } from "../../src/domain/categories/index.js";
import type { DetectionTier } from "../../src/shared/types.js";

const TIERS: ReadonlyArray<DetectionTier> = [
  "file-type", "ole2-clsid", "zip-marker", "text-heuristic", "extension-fallback",
];

describe("PBT — Categories", () => {
  const mapper = createCategoryMapper();
  const knownFormats = Object.keys(FR6_TABLE);

  it("PBT-U1-015 — totality: every FR-6 format maps to a non-null decision", () => {
    fc.assert(
      fc.property(fc.constantFrom(...knownFormats), fc.constantFrom(...TIERS), (format, tier) => {
        const d = mapper.map(format, tier);
        return d !== null;
      }),
      { numRuns: 100 },
    );
  });

  it("PBT-U1-016 — TIFF precedence: tif/tiff always -> subCategory='tiff'", () => {
    fc.assert(
      fc.property(fc.constantFrom("tif", "tiff", "TIF", "TIFF"), fc.constantFrom(...TIERS), (format, tier) => {
        const d = mapper.map(format, tier);
        return d !== null && d.category === "convert" && d.subCategory === "tiff";
      }),
      { numRuns: 100 },
    );
  });

  it("PBT-U1-017 — PPSX/PPS in office", () => {
    fc.assert(
      fc.property(fc.constantFrom("ppsx", "pps", "PPSX", "PPS"), (format) => {
        // For pps via OLE2-CLSID the convert-then-ocr trigger applies; check non-OLE2 tier
        const tier: DetectionTier = format.toLowerCase() === "ppsx" ? "zip-marker" : "extension-fallback";
        const d = mapper.map(format, tier);
        return d !== null && d.subCategory === "office";
      }),
      { numRuns: 100 },
    );
  });
});
