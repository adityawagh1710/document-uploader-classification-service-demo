import { describe, it, expect } from "vitest";
import { createZIPMarkerParser, createTier2ZIPDetector } from "../../src/domain/tier2-zip/index.js";

// Helpers to build minimal local file headers
function writeLFH(buf: Uint8Array, off: number, filename: string, compressed: boolean, payload: Uint8Array = new Uint8Array(0)): number {
  buf[off + 0] = 0x50; buf[off + 1] = 0x4b; buf[off + 2] = 0x03; buf[off + 3] = 0x04;
  buf[off + 4] = 20; buf[off + 5] = 0;
  buf[off + 6] = 0; buf[off + 7] = 0;
  const cm = compressed ? 8 : 0;
  buf[off + 8] = cm & 0xff;
  buf[off + 9] = (cm >> 8) & 0xff;
  for (let i = 10; i < 14; i++) buf[off + i] = 0;
  for (let i = 14; i < 18; i++) buf[off + i] = 0;
  const sz = payload.length;
  buf[off + 18] = sz & 0xff;
  buf[off + 19] = (sz >> 8) & 0xff;
  buf[off + 20] = 0; buf[off + 21] = 0;
  buf[off + 22] = sz & 0xff;
  buf[off + 23] = (sz >> 8) & 0xff;
  buf[off + 24] = 0; buf[off + 25] = 0;
  const name = new TextEncoder().encode(filename);
  buf[off + 26] = name.length & 0xff;
  buf[off + 27] = (name.length >> 8) & 0xff;
  buf[off + 28] = 0; buf[off + 29] = 0;
  for (let i = 0; i < name.length; i++) buf[off + 30 + i] = name[i]!;
  for (let i = 0; i < payload.length; i++) buf[off + 30 + name.length + i] = payload[i]!;
  return off + 30 + name.length + payload.length;
}

describe("Tier2ZIPDetector", () => {
  const detector = createTier2ZIPDetector({ parser: createZIPMarkerParser() });

  it("returns matched=false on non-ZIP buffer", () => {
    const result = detector.detect(new Uint8Array(100));
    expect(result.matched).toBe(false);
  });

  it("identifies OOXML when [Content_Types].xml is the first entry", () => {
    const buf = new Uint8Array(2048);
    const off = writeLFH(buf, 0, "[Content_Types].xml", true);
    writeLFH(buf, off, "word/document.xml", true);
    const result = detector.detect(buf);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.family).toBe("ooxml");
      expect(result.format).toBe("docx");
    }
  });

  it("identifies ODF when uncompressed mimetype entry is present", () => {
    const buf = new Uint8Array(2048);
    const payload = new TextEncoder().encode("application/vnd.oasis.opendocument.text");
    writeLFH(buf, 0, "mimetype", false, payload);
    const result = detector.detect(buf);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.family).toBe("odf");
      expect(result.format).toBe("odt");
    }
  });

  it("identifies pptx when ppt/ entry sits after doc-props prefix (regression — fix bumps scan from 4→16 entries)", () => {
    // Reproduces the stress_test_100mb.pptx miscategorisation: typical OOXML
    // layout puts [Content_Types].xml + _rels + 2× docProps BEFORE the first
    // format-specific part (ppt/presentation.xml), so a 4-entry scan misses it.
    // Each entry needs a non-empty payload so the parser's anti-loop guard
    // (`if (offset <= filenameEnd) break`) doesn't stop after the first one.
    const buf = new Uint8Array(4096);
    const stub = new Uint8Array([0x00]);
    let off = writeLFH(buf, 0, "[Content_Types].xml", true, stub);
    off = writeLFH(buf, off, "_rels/.rels", true, stub);
    off = writeLFH(buf, off, "docProps/app.xml", true, stub);
    off = writeLFH(buf, off, "docProps/core.xml", true, stub);
    writeLFH(buf, off, "ppt/presentation.xml", true, stub);

    const result = detector.detect(buf);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.family).toBe("ooxml");
      expect(result.format).toBe("pptx");
    }
  });

  it("identifies xlsx when [Content_Types].xml is NOT the first entry (Excel reorders entries on xlsx with embedded charts)", () => {
    // Reproduces student_marks_with_charts.xlsx miscategorisation: Excel can
    // shuffle the ZIP central directory so [Content_Types].xml isn't first.
    // Detector must scan ahead and recognize OOXML by any signal, not just position 0.
    const buf = new Uint8Array(4096);
    const stub = new Uint8Array([0x00]);
    let off = writeLFH(buf, 0, "_rels/.rels", true, stub);
    off = writeLFH(buf, off, "[Content_Types].xml", true, stub);
    off = writeLFH(buf, off, "xl/workbook.xml", true, stub);
    writeLFH(buf, off, "xl/sharedStrings.xml", true, stub);

    const result = detector.detect(buf);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.family).toBe("ooxml");
      expect(result.format).toBe("xlsx");
    }
  });

  it("identifies docx purely from `word/` prefix even when [Content_Types].xml is missing from scan window", () => {
    // Defensive case: huge OOXML where Content_Types could be past the 4 KiB
    // window but word/document.xml is in scope. The prefix alone is enough.
    const buf = new Uint8Array(4096);
    const stub = new Uint8Array([0x00]);
    let off = writeLFH(buf, 0, "word/document.xml", true, stub);
    writeLFH(buf, off, "word/_rels/document.xml.rels", true, stub);

    const result = detector.detect(buf);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.family).toBe("ooxml");
      expect(result.format).toBe("docx");
    }
  });

  it("uses extension hint when scanned entries don't disambiguate (deep OOXML files)", () => {
    // Pathological case: only doc-props entries scanned — no word/xl/ppt
    // prefix surfaces. Falls back to extension hint instead of silently picking docx.
    const buf = new Uint8Array(4096);
    const stub = new Uint8Array([0x00]);
    let off = writeLFH(buf, 0, "[Content_Types].xml", true, stub);
    off = writeLFH(buf, off, "_rels/.rels", true, stub);
    off = writeLFH(buf, off, "docProps/app.xml", true, stub);
    off = writeLFH(buf, off, "docProps/core.xml", true, stub);

    const result = detector.detect(buf, "xlsx");
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.family).toBe("ooxml");
      expect(result.format).toBe("xlsx");
    }
  });

  it("identifies plain ZIP when no marker entries present", () => {
    const buf = new Uint8Array(512);
    writeLFH(buf, 0, "readme.txt", false);
    const result = detector.detect(buf);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.family).toBe("plain");
      expect(result.format).toBe("zip");
    }
  });
});
