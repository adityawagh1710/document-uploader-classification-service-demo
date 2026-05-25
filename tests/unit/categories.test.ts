import { describe, it, expect } from "vitest";
import { createCategoryMapper } from "../../src/domain/categories/index.js";

describe("CategoryMapper", () => {
  const mapper = createCategoryMapper();

  it.each([
    ["pdf", "file-type", "ocr-direct", null],
    ["png", "file-type", "ocr-direct", null],
    ["jpg", "file-type", "ocr-direct", null],
    ["mp3", "file-type", "media", null],
    ["docx", "zip-marker", "convert", "office"],
    ["ppsx", "zip-marker", "convert", "office"],
    ["html", "text-heuristic", "convert", "html"],
    ["zip", "zip-marker", "archive", null],
    ["msg", "ole2-clsid", "email", null],
    ["eml", "text-heuristic", "email", null],
  ] as const)("maps %s (tier=%s) -> %s/%s", (fmt, tier, expectedCategory, expectedSub) => {
    const decision = mapper.map(fmt, tier);
    expect(decision).not.toBeNull();
    expect(decision!.category).toBe(expectedCategory);
    expect(decision!.subCategory).toBe(expectedSub);
  });

  it("TIFF always wins as `tiff` sub-category (BR-C-2)", () => {
    expect(mapper.map("tiff", "file-type")?.subCategory).toBe("tiff");
    expect(mapper.map("tif", "file-type")?.subCategory).toBe("tiff");
  });

  it("convert-then-ocr only on OLE2 detection (BR-C-3)", () => {
    expect(mapper.map("doc", "ole2-clsid")?.subCategory).toBe("convert-then-ocr");
    expect(mapper.map("doc", "extension-fallback")?.subCategory).toBe("office");
  });

  it("returns null for unknown formats (BR-C-4)", () => {
    expect(mapper.map("xyz-unknown", "file-type")).toBeNull();
  });

  it("PPS and PPSX map to office (BR-C-5)", () => {
    expect(mapper.map("pps", "ole2-clsid")?.subCategory).toBe("convert-then-ocr");
    expect(mapper.map("ppsx", "zip-marker")?.subCategory).toBe("office");
  });
});
