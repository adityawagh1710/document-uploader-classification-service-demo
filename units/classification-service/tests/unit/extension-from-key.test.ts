import { describe, it, expect } from "vitest";

import { extensionFromKey } from "../../src/application/ClassificationService.js";

describe("extensionFromKey — derive extension hint from S3 key / path", () => {
  it("extracts the suffix after the last dot from a UI upload key", () => {
    expect(
      extensionFromKey("ui/doc-abc-123/Wonders_of_Our_Solar_System.pptx"),
    ).toBe("pptx");
  });

  it("lowercases the result", () => {
    expect(extensionFromKey("foo/bar/Slides.PPTX")).toBe("pptx");
    expect(extensionFromKey("Report.DOCX")).toBe("docx");
  });

  it("returns null for a basename without a dot", () => {
    expect(extensionFromKey("ui/doc-abc/just-a-file")).toBeNull();
    expect(extensionFromKey("plainfile")).toBeNull();
  });

  it("returns null for a trailing-dot basename (no actual extension)", () => {
    expect(extensionFromKey("ui/file.")).toBeNull();
  });

  it("returns null when the suffix is implausibly long (likely not an extension)", () => {
    expect(
      extensionFromKey("ui/foo.thisIsNotAnExtensionItIsAName"),
    ).toBeNull();
  });

  it("works with a plain key (no directory)", () => {
    expect(extensionFromKey("invoice.pdf")).toBe("pdf");
  });

  it("ignores dots inside directory portions", () => {
    expect(extensionFromKey("a.b/c.d/finalpiece")).toBeNull();
    expect(extensionFromKey("a.b/c.d/realfile.eml")).toBe("eml");
  });

  it("handles multi-dot basenames (uses only the final segment)", () => {
    expect(extensionFromKey("backup.tar.gz")).toBe("gz");
    expect(extensionFromKey("a.b.c.d.pptx")).toBe("pptx");
  });
});
