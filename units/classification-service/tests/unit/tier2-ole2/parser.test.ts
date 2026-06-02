import { describe, it, expect } from "vitest";
import { createOLE2Parser } from "../../../src/domain/tier2-ole2/index.js";
import { buildOLE2Buffer } from "../../pbt/generators/ole2.gen.js";
import type { CLSID } from "../../../src/shared/types.js";

describe("OLE2Parser.parseCLSID", () => {
  const parser = createOLE2Parser();

  it("decodes the Word .doc CLSID (worked example)", () => {
    const wordCLSID: CLSID = "00020906-0000-0000-C000-000000000046";
    const buf = buildOLE2Buffer({ clsid: wordCLSID });
    const result = parser.parseCLSID(buf);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(wordCLSID);
  });

  it("returns missing-ole2-signature on garbage", () => {
    const result = parser.parseCLSID(new Uint8Array(4100));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("missing-ole2-signature");
  });

  it("returns non-standard-sector-size when sectorSize != 0x0009", () => {
    const clsid: CLSID = "00020906-0000-0000-C000-000000000046";
    const buf = buildOLE2Buffer({ clsid, sectorSize: 0x000a });
    const result = parser.parseCLSID(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("non-standard-sector-size");
  });

  it("returns directory-beyond-window when sectorId pushes past 4100", () => {
    const clsid: CLSID = "00020906-0000-0000-C000-000000000046";
    const buf = buildOLE2Buffer({ clsid, sectorId: 8, bufferLength: 4100 });
    const result = parser.parseCLSID(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("directory-beyond-window");
  });

  it("returns directory-beyond-window when sectorId is negative", () => {
    const buf = new Uint8Array(4100);
    // OLE2 signature
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((b, i) => { buf[i] = b; });
    // valid sector size
    buf[30] = 0x09;
    buf[31] = 0x00;
    // negative sectorId at offset 48 (0xFFFFFFFF = -1 in i32 LE)
    buf[48] = 0xff;
    buf[49] = 0xff;
    buf[50] = 0xff;
    buf[51] = 0xff;
    const result = parser.parseCLSID(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("directory-beyond-window");
  });
});
