import type { Tier3Result, Tier3TextDetector } from "./types.js";
import {
  hasBinaryBytes,
  decodeText,
  isXML,
  isHTML,
  countEmailHeaders,
  isDXF,
  isCSV,
  hasAnyPrintableContent,
} from "./heuristics.js";

export function createTier3TextDetector(): Tier3TextDetector {
  return Object.freeze({
    detect(buffer: Uint8Array): Tier3Result {
      if (hasBinaryBytes(buffer)) return { matched: false, reason: "binary-bytes" };

      const text = decodeText(buffer);

      // Priority 1: XML
      if (isXML(text)) return { matched: true, format: "xml", matchType: "text-heuristic" };

      // Priority 2: HTML
      if (isHTML(text)) return { matched: true, format: "html", matchType: "text-heuristic" };

      // Priority 3: EML (≥ 2 distinct headers from accepted set)
      if (countEmailHeaders(text) >= 2) return { matched: true, format: "eml", matchType: "text-heuristic" };

      // Priority 4: DXF
      if (isDXF(text)) return { matched: true, format: "dxf", matchType: "text-heuristic" };

      // Priority 5: CSV
      if (isCSV(buffer)) return { matched: true, format: "csv", matchType: "text-heuristic" };

      // Priority 6: TXT fallback
      if (hasAnyPrintableContent(buffer)) return { matched: true, format: "txt", matchType: "text-heuristic" };

      return { matched: false, reason: "no-pattern-matched" };
    },
  });
}
