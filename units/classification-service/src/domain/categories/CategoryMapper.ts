import type { DetectionTier } from "../../shared/types.js";
import type { CategoryMapper, CategoryDecision } from "./types.js";
import { FR6_TABLE, CONVERT_THEN_OCR_FORMATS } from "./fr6-table.js";

export function createCategoryMapper(): CategoryMapper {
  return Object.freeze({
    map(detectedFormat: string, detectionTier: DetectionTier): CategoryDecision | null {
      const format = detectedFormat.toLowerCase();

      // BR-C-2: TIFF precedence — always "tiff" sub-category regardless of detection tier
      if (format === "tif" || format === "tiff") {
        return { category: "convert", subCategory: "tiff" };
      }

      // BR-C-3: convert-then-ocr sub-category trigger
      if (CONVERT_THEN_OCR_FORMATS.has(format) && detectionTier === "ole2-clsid") {
        return { category: "convert", subCategory: "convert-then-ocr" };
      }

      // BR-C-4: unknown format -> null
      const decision = FR6_TABLE[format];
      return decision ?? null;
    },
  });
}
