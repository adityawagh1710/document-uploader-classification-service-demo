import { describe, it, expect } from "vitest";
import { createTier1FileTypeDetector } from "../../src/domain/tier1-filetype/index.js";

describe("Tier1FileTypeDetector", () => {
  const detector = createTier1FileTypeDetector();

  it("detects PDF from %PDF- header", async () => {
    const buf = new TextEncoder().encode("%PDF-1.7\n");
    const result = await detector.detect(buf);
    expect(result).toEqual({ matched: true, ext: "pdf", mime: "application/pdf" });
  });

  it("returns matched=false on a garbage buffer", async () => {
    const buf = new TextEncoder().encode("this is just plain text not a known binary");
    const result = await detector.detect(buf);
    expect(result.matched).toBe(false);
  });

  it("detects PNG from magic bytes", async () => {
    // file-type v21.3.4 requires more than just the 8-byte PNG signature —
    // include a minimal IHDR chunk so the detector confidently identifies it.
    const buf = new Uint8Array([
      // PNG signature
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      // IHDR chunk: length=13, type="IHDR"
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      // 1x1, 8-bit RGBA, no interlace
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00,
      // CRC placeholder
      0x1f, 0x15, 0xc4, 0x89,
    ]);
    const result = await detector.detect(buf);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.ext).toBe("png");
      expect(result.mime).toBe("image/png");
    }
  });
});
