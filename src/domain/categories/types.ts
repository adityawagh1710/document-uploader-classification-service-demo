import type { Category, DetectionTier, SubCategory } from "../../shared/types.js";

export interface CategoryDecision {
  readonly category: Category;
  readonly subCategory: SubCategory;
}

export interface CategoryMapper {
  map(detectedFormat: string, detectionTier: DetectionTier): CategoryDecision | null;
}
