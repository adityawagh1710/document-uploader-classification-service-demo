import { describe, it, expect, vi } from "vitest";

import { detectInSequence } from "../../src/application/ClassificationService.js";
import type { ClassificationServiceDeps } from "../../src/application/types.js";

const OLE2_HEADER = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_HEADER = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

function makeDeps(overrides: Partial<ClassificationServiceDeps> = {}): ClassificationServiceDeps {
  const noop = vi.fn();
  return {
    tier1: { detect: vi.fn().mockResolvedValue({ matched: false }) },
    tier2OLE2: { detect: vi.fn().mockReturnValue({ matched: false }) },
    tier2ZIP: { detect: vi.fn().mockReturnValue({ matched: false }) },
    tier3Text: { detect: vi.fn().mockReturnValue({ matched: false }) },
    scorer: { score: vi.fn() },
    categoryMapper: { map: vi.fn() },
    slipsheetDecider: { decide: vi.fn() },
    s3Reader: { getRange: vi.fn() },
    s3Streamer: { getStream: vi.fn() },
    hasher: { sha256Hex: vi.fn() },
    contentHashStore: { get: vi.fn(), put: vi.fn() },
    workspaceConfigStore: { get: vi.fn() },
    logger: { debug: noop, info: noop, warn: noop, error: noop } as never,
    nowProvider: () => "2026-05-26T00:00:00.000Z",
    policyVersionExtractor: (c) => c.policyVersion,
    ...overrides,
  } as unknown as ClassificationServiceDeps;
}

describe("detectInSequence — cfb fall-through to Tier 2 OLE2", () => {
  it("does NOT short-circuit when Tier 1 returns generic `cfb`; falls through to Tier 2 OLE2 which refines to doc", async () => {
    // file-type returns `cfb` for any OLE2 magic-byte match.
    const tier1 = { detect: vi.fn().mockResolvedValue({ matched: true, ext: "cfb", mime: "application/x-cfb" }) };
    // Tier 2 OLE2 reads the CLSID and identifies the file as Word.
    const tier2OLE2 = {
      detect: vi.fn().mockReturnValue({
        matched: true,
        format: "doc",
        matchType: "ole2-with-clsid",
        clsid: "00020906-0000-0000-C000-000000000046",
      }),
    };
    const deps = makeDeps({ tier1, tier2OLE2 });

    const state = await detectInSequence(deps, OLE2_HEADER, { extension: "doc", contentType: null });

    expect(tier1.detect).toHaveBeenCalledOnce();
    expect(tier2OLE2.detect).toHaveBeenCalledOnce();
    expect(state).toMatchObject({
      tier: "ole2-clsid",
      detectedFormat: "doc",
      matchType: "ole2-with-clsid",
      clsid: "00020906-0000-0000-C000-000000000046",
    });
  });

  it("still short-circuits Tier 1 for specific (non-cfb) detections", async () => {
    const tier1 = { detect: vi.fn().mockResolvedValue({ matched: true, ext: "pdf", mime: "application/pdf" }) };
    const tier2OLE2 = { detect: vi.fn() };
    const deps = makeDeps({ tier1, tier2OLE2 });

    const state = await detectInSequence(deps, new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      extension: null,
      contentType: null,
    });

    expect(tier2OLE2.detect).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      tier: "file-type",
      detectedFormat: "pdf",
      matchType: "exact-unique-signature",
    });
  });

  it("does NOT short-circuit when Tier 1 returns generic `zip`; falls through to Tier 2 ZIP which refines to xlsx", async () => {
    // file-type returns plain `zip` when its 4 KiB window misses [Content_Types].xml
    // (common on big OOXML files where the central directory is at the end).
    const tier1 = { detect: vi.fn().mockResolvedValue({ matched: true, ext: "zip", mime: "application/zip" }) };
    // Tier 2 ZIP scans local-file-header entries and identifies xlsx via OOXML markers.
    const tier2ZIP = {
      detect: vi.fn().mockReturnValue({
        matched: true,
        format: "xlsx",
        family: "ooxml",
        matchType: "zip-with-ooxml-or-odf",
      }),
    };
    const deps = makeDeps({ tier1, tier2ZIP });

    const state = await detectInSequence(deps, ZIP_HEADER, { extension: "xlsx", contentType: null });

    expect(tier2ZIP.detect).toHaveBeenCalledOnce();
    expect(state).toMatchObject({
      tier: "zip-marker",
      detectedFormat: "xlsx",
      matchType: "zip-with-ooxml-or-odf",
    });
  });

  it("plain `zip` (Tier 2 ZIP finds no OOXML/ODF markers) still routes correctly as archive-bound zip", async () => {
    const tier1 = { detect: vi.fn().mockResolvedValue({ matched: true, ext: "zip", mime: "application/zip" }) };
    const tier2ZIP = {
      detect: vi.fn().mockReturnValue({
        matched: true,
        format: "zip",
        family: "plain",
        matchType: "exact-unique-signature",
      }),
    };
    const deps = makeDeps({ tier1, tier2ZIP });

    const state = await detectInSequence(deps, ZIP_HEADER, { extension: "zip", contentType: null });

    expect(state).toMatchObject({
      tier: "zip-marker",
      detectedFormat: "zip",
      matchType: "exact-unique-signature",
    });
  });

  it("cfb + Tier 2 OLE2 unknown CLSID + extension hint -> extension-fallback resolves to extension", async () => {
    const tier1 = { detect: vi.fn().mockResolvedValue({ matched: true, ext: "cfb", mime: "application/x-cfb" }) };
    // Tier 2 OLE2 returns matched with the extension-fallback matchType (its own internal fallback).
    const tier2OLE2 = {
      detect: vi.fn().mockReturnValue({
        matched: true,
        format: "xls",
        matchType: "ole2-or-zip-ext-fallback",
      }),
    };
    const deps = makeDeps({ tier1, tier2OLE2 });

    const state = await detectInSequence(deps, OLE2_HEADER, { extension: "xls", contentType: null });

    expect(state).toMatchObject({
      tier: "extension-fallback",
      detectedFormat: "xls",
      matchType: "ole2-or-zip-ext-fallback",
    });
  });
});
