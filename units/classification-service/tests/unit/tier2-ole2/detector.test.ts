import { describe, it, expect } from "vitest";
import {
  createOLE2Parser,
  createTier2OLE2Detector,
  CLSID_LOOKUP_TABLE,
} from "../../../src/domain/tier2-ole2/index.js";
import { buildOLE2Buffer } from "../../pbt/generators/ole2.gen.js";
import type { CLSID } from "../../../src/shared/types.js";

describe("Tier2OLE2Detector", () => {
  const detector = createTier2OLE2Detector({ parser: createOLE2Parser() });

  it("returns matched=false on non-OLE2 buffers", () => {
    const result = detector.detect(new Uint8Array(100), null);
    expect(result.matched).toBe(false);
  });

  it.each(Object.entries(CLSID_LOOKUP_TABLE))(
    "detects format=%s from CLSID %s",
    (clsid, expectedFormat) => {
      const buf = buildOLE2Buffer({ clsid: clsid as CLSID });
      const result = detector.detect(buf, null);
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.format).toBe(expectedFormat);
        expect(result.matchType).toBe("ole2-with-clsid");
      }
    },
  );

  it("falls back to extension when CLSID parse fails (non-standard sector size + .doc)", () => {
    const buf = buildOLE2Buffer({
      clsid: "00020906-0000-0000-C000-000000000046",
      sectorSize: 0x000a,
    });
    const result = detector.detect(buf, "doc");
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.format).toBe("doc");
      expect(result.matchType).toBe("ole2-or-zip-ext-fallback");
    }
  });

  it("returns matched=false when CLSID parse fails and extension is unknown", () => {
    const buf = buildOLE2Buffer({
      clsid: "00020906-0000-0000-C000-000000000046",
      sectorSize: 0x000a,
    });
    const result = detector.detect(buf, "unknown");
    expect(result.matched).toBe(false);
  });

  it("falls back to extension when CLSID is parsed but unknown", () => {
    const unknownCLSID: CLSID = "DEADBEEF-CAFE-BABE-FEED-FACE12345678";
    const buf = buildOLE2Buffer({ clsid: unknownCLSID });
    const result = detector.detect(buf, "mpp");
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.format).toBe("mpp");
      expect(result.matchType).toBe("ole2-or-zip-ext-fallback");
    }
  });
});
