import { OLE2_SIGNATURE } from "../../shared/constants.js";
import type { OLE2Parser, Tier2OLE2Detector, Tier2OLE2Result } from "./types.js";
import { lookupFormatForCLSID } from "./clsid-lookup.js";
import { ole2ExtensionToFormat } from "./extension-fallback.js";

function hasOLE2Signature(buffer: Uint8Array): boolean {
  if (buffer.length < OLE2_SIGNATURE.length) return false;
  for (let i = 0; i < OLE2_SIGNATURE.length; i++) {
    if (buffer[i] !== OLE2_SIGNATURE[i]) return false;
  }
  return true;
}

export function createTier2OLE2Detector(deps: { parser: OLE2Parser }): Tier2OLE2Detector {
  const { parser } = deps;

  return Object.freeze({
    detect(buffer: Uint8Array, extension: string | null): Tier2OLE2Result {
      if (!hasOLE2Signature(buffer)) return { matched: false };

      const parseResult = parser.parseCLSID(buffer);

      // CLSID parse failure -> extension fallback
      if (!parseResult.ok) {
        const fallback = ole2ExtensionToFormat(extension);
        if (fallback === null) return { matched: false };
        return { matched: true, format: fallback, matchType: "ole2-or-zip-ext-fallback" };
      }

      const clsid = parseResult.value;
      const format = lookupFormatForCLSID(clsid);

      // CLSID parsed but not in lookup table -> extension fallback
      if (format === undefined) {
        const fallback = ole2ExtensionToFormat(extension);
        if (fallback === null) return { matched: false };
        return { matched: true, format: fallback, matchType: "ole2-or-zip-ext-fallback" };
      }

      return { matched: true, format, clsid, matchType: "ole2-with-clsid" };
    },
  });
}
