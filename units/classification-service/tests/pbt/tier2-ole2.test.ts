import { describe, it } from "vitest";
import fc from "fast-check";
import { createOLE2Parser, createTier2OLE2Detector } from "../../src/domain/tier2-ole2/index.js";
import { validCLSIDGen } from "./generators/clsid.gen.js";
import { ole2BufferWithCLSIDGen, nonStandardSectorSizeOLE2Gen, directoryBeyondWindowOLE2Gen } from "./generators/ole2.gen.js";

describe("PBT — Tier2 OLE2", () => {
  const parser = createOLE2Parser();
  const detector = createTier2OLE2Detector({ parser });

  it("PBT-U1-001 — round-trip: parseCLSID(encode(clsid)) === clsid", () => {
    fc.assert(
      fc.property(ole2BufferWithCLSIDGen(validCLSIDGen), ({ buffer, clsid }) => {
        const result = parser.parseCLSID(buffer);
        return result.ok && result.value === clsid;
      }),
      { numRuns: 1000 },
    );
  });

  it("PBT-U1-002 — directory-beyond-window invariant", () => {
    fc.assert(
      fc.property(directoryBeyondWindowOLE2Gen, (buffer) => {
        const result = parser.parseCLSID(buffer);
        return !result.ok && result.error === "directory-beyond-window";
      }),
      { numRuns: 1000 },
    );
  });

  it("PBT-U1-003 — non-standard sector size invariant", () => {
    fc.assert(
      fc.property(nonStandardSectorSizeOLE2Gen, (buffer) => {
        const result = parser.parseCLSID(buffer);
        return !result.ok && result.error === "non-standard-sector-size";
      }),
      { numRuns: 1000 },
    );
  });

  it("PBT-U1-006 — Tier2OLE2Detector idempotence", () => {
    fc.assert(
      fc.property(ole2BufferWithCLSIDGen(validCLSIDGen), ({ buffer }) => {
        const a = detector.detect(buffer, null);
        const b = detector.detect(buffer, null);
        return JSON.stringify(a) === JSON.stringify(b);
      }),
      { numRuns: 100 },
    );
  });
});
