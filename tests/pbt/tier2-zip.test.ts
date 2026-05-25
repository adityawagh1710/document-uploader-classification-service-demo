import { describe, it } from "vitest";
import fc from "fast-check";
import { createZIPMarkerParser, createTier2ZIPDetector } from "../../src/domain/tier2-zip/index.js";
import { ooxmlZipGen, odfZipGen, plainZipGen } from "./generators/zip.gen.js";

describe("PBT — Tier2 ZIP", () => {
  const parser = createZIPMarkerParser();
  const detector = createTier2ZIPDetector({ parser });

  it("PBT-U1-007a — oracle: synthetic OOXML is detected as ooxml", () => {
    fc.assert(
      fc.property(ooxmlZipGen, (buffer) => {
        const result = detector.detect(buffer);
        return result.matched === true && result.family === "ooxml";
      }),
      { numRuns: 100 },
    );
  });

  it("PBT-U1-007b — oracle: synthetic ODF is detected as odf", () => {
    fc.assert(
      fc.property(odfZipGen, (buffer) => {
        const result = detector.detect(buffer);
        return result.matched === true && result.family === "odf";
      }),
      { numRuns: 100 },
    );
  });

  it("PBT-U1-007c — oracle: plain ZIP is detected as plain", () => {
    fc.assert(
      fc.property(plainZipGen, (buffer) => {
        const result = detector.detect(buffer);
        return result.matched === true && result.family === "plain";
      }),
      { numRuns: 100 },
    );
  });

  it("PBT-U1-008 — scanEntries returns at most maxEntries", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 4100 }),
        fc.integer({ min: 0, max: 20 }),
        (buf, maxEntries) => parser.scanEntries(buf, maxEntries).length <= maxEntries,
      ),
      { numRuns: 1000 },
    );
  });
});
