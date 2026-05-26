import { ZIP_LOCAL_FILE_HEADER_SIGNATURE } from "../../shared/constants.js";
import type { Tier2ZIPDetector, Tier2ZIPResult, ZIPMarkerParser } from "./types.js";
import { ooxmlFormatFromEntries, odfFormatFromMimetype } from "./format-mappers.js";

function hasZIPSignature(buffer: Uint8Array): boolean {
  if (buffer.length < ZIP_LOCAL_FILE_HEADER_SIGNATURE.length) return false;
  for (let i = 0; i < ZIP_LOCAL_FILE_HEADER_SIGNATURE.length; i++) {
    if (buffer[i] !== ZIP_LOCAL_FILE_HEADER_SIGNATURE[i]) return false;
  }
  return true;
}

export function createTier2ZIPDetector(deps: { parser: ZIPMarkerParser }): Tier2ZIPDetector {
  const { parser } = deps;

  return Object.freeze({
    detect(buffer: Uint8Array, extensionHint?: string | null): Tier2ZIPResult {
      if (!hasZIPSignature(buffer)) return { matched: false };

      // Scan up to 16 entries — for typical OOXML the format-specific
      // `word/|xl/|ppt/` parts arrive AFTER `[Content_Types].xml` + `_rels/.rels`
      // + `docProps/*`, often as the 5th entry. The hard cap on bytes
      // scanned is the detection-window size (4 KiB) supplied to the parser.
      const entries = parser.scanEntries(buffer, 16);

      if (entries.length === 0) {
        return { matched: true, format: "zip", family: "plain", matchType: "exact-unique-signature" };
      }

      const first = entries[0];
      if (first && first.filename === "[Content_Types].xml") {
        return {
          matched: true,
          format: ooxmlFormatFromEntries(entries, extensionHint ?? null),
          family: "ooxml",
          matchType: "zip-with-ooxml-or-odf",
        };
      }

      const mimetypeEntry = entries.find((e) => e.filename === "mimetype" && e.uncompressed);
      if (mimetypeEntry) {
        const odfFormat = odfFormatFromMimetype(buffer, mimetypeEntry);
        if (odfFormat) {
          return {
            matched: true,
            format: odfFormat,
            family: "odf",
            matchType: "zip-with-ooxml-or-odf",
          };
        }
      }

      return { matched: true, format: "zip", family: "plain", matchType: "exact-unique-signature" };
    },
  });
}
