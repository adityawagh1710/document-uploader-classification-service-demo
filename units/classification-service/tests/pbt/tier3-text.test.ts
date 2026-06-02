import { describe, it } from "vitest";
import fc from "fast-check";
import { createTier3TextDetector } from "../../src/domain/tier3-text/index.js";
import { binaryByteBufferGen } from "./generators/text.gen.js";

describe("PBT — Tier3 Text", () => {
  const detector = createTier3TextDetector();

  it("PBT-U1-009 — binary-byte screen invariant: buffer with disallowed binary byte never matches", () => {
    fc.assert(
      fc.property(binaryByteBufferGen, (buffer) => {
        const result = detector.detect(buffer);
        return result.matched === false && result.reason === "binary-bytes";
      }),
      { numRuns: 1000 },
    );
  });

  it("PBT-U1-010 — XML wins priority over EML when both signatures match", () => {
    fc.assert(
      fc.property(fc.constant("<?xml version=\"1.0\"?>\nFrom: a@b.com\nDate: today"), (s) => {
        const result = detector.detect(new TextEncoder().encode(s));
        return result.matched === true && result.format === "xml";
      }),
      { numRuns: 1000 },
    );
  });
});
