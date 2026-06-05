import { describe, it, expect } from "vitest";
import { createTier3TextDetector } from "../../src/domain/tier3-text/index.js";

const enc = (s: string) => new TextEncoder().encode(s);

describe("Tier3TextDetector", () => {
  const detector = createTier3TextDetector();

  it("rejects buffer with binary byte 0x05", () => {
    const buf = new Uint8Array([0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    const result = detector.detect(buf);
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe("binary-bytes");
  });

  it("allows ESC byte (0x1B) — text-eligible per edge case #5", () => {
    const buf = new Uint8Array([0x1b, 0x68, 0x69]);
    const result = detector.detect(buf);
    expect(result.matched).toBe(true);
  });

  it("detects XML when starts with <?xml", () => {
    const result = detector.detect(enc('<?xml version="1.0"?><root/>'));
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.format).toBe("xml");
  });

  it("detects HTML with attributes (case-insensitive)", () => {
    const result = detector.detect(enc('<html lang="en"><body>hi</body></html>'));
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.format).toBe("html");
  });

  it("detects EML with ≥ 2 distinct accepted headers", () => {
    const result = detector.detect(enc("From: a@b.com\nDate: today\n\nbody"));
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.format).toBe("eml");
  });

  it("XML wins priority over EML when both signatures match (BR-T-8)", () => {
    const buf = enc('<?xml version="1.0"?>\nFrom: a@b.com\nDate: today');
    const result = detector.detect(buf);
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.format).toBe("xml");
  });

  it("detects CSV with consistent comma delimiters", () => {
    const result = detector.detect(enc("a,b,c\nd,e,f\ng,h,i"));
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.format).toBe("csv");
  });

  it("falls back to TXT for plain text", () => {
    const result = detector.detect(enc("hello world this is plain text"));
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.format).toBe("txt");
  });
});
