import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Category, SubCategory, DetectionTier } from "../../src/shared/types.js";

const here = (p: string) => resolve(fileURLToPath(import.meta.url), "..", p);

export interface FixtureSpec {
  readonly path: string;
  readonly expectedFormat: string;
  readonly expectedCategory: Category;
  readonly expectedSubCategory: SubCategory;
  readonly expectedDetectionTier: DetectionTier;
  readonly expectsExtensionContradictionModifier: boolean;
  readonly tracesAcceptanceCriterion?: string;
  readonly note?: string;
}

// Note: binary files for these fixtures are committed by U-3 when integration tests
// require them. For U-1's pure-logic tests only the manifest TYPES are needed; the
// path strings act as placeholders that will resolve when fixtures are committed.
export const fixtures = {
  "ac-1-docx-renamed-pdf": {
    path: here("ac-1-docx-renamed-pdf/document.pdf"),
    expectedFormat: "docx",
    expectedCategory: "convert",
    expectedSubCategory: "office",
    expectedDetectionTier: "zip-marker",
    expectsExtensionContradictionModifier: true,
    tracesAcceptanceCriterion: "AC-1",
  },
  "ac-7-msg": {
    path: here("ac-7-msg/sample.msg"),
    expectedFormat: "msg",
    expectedCategory: "email",
    expectedSubCategory: null,
    expectedDetectionTier: "ole2-clsid",
    expectsExtensionContradictionModifier: false,
    tracesAcceptanceCriterion: "AC-7",
  },
  "ac-8-eml": {
    path: here("ac-8-eml/sample.eml"),
    expectedFormat: "eml",
    expectedCategory: "email",
    expectedSubCategory: null,
    expectedDetectionTier: "text-heuristic",
    expectsExtensionContradictionModifier: false,
    tracesAcceptanceCriterion: "AC-8",
  },
} as const satisfies Record<string, FixtureSpec>;

export type FixtureId = keyof typeof fixtures;
