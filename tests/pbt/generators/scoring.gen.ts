import fc from "fast-check";
import type { ScoringInput } from "../../../src/domain/scoring/index.js";
import type { MatchType } from "../../../src/shared/types.js";

const MATCH_TYPES: ReadonlyArray<MatchType> = [
  "exact-unique-signature",
  "ole2-with-clsid",
  "zip-with-ooxml-or-odf",
  "ole2-or-zip-ext-fallback",
  "text-heuristic",
  "extension-only",
  "no-match",
];

const KNOWN_FORMATS = ["pdf", "docx", "doc", "msg", "eml", "tiff", "png", "html"] as const;
const KNOWN_EXTENSIONS = ["pdf", "docx", "doc", "msg", "eml", "tiff", "png", "html", "txt"] as const;
const KNOWN_MIMES = ["application/pdf", "application/msword", "text/html", "image/png", "image/tiff"] as const;

export const scoringInputGen: fc.Arbitrary<ScoringInput> = fc.record({
  matchType: fc.constantFrom(...MATCH_TYPES),
  detectedFormat: fc.oneof(fc.constantFrom(...KNOWN_FORMATS), fc.constant(null)),
  extension: fc.oneof(fc.constantFrom(...KNOWN_EXTENSIONS), fc.constant(null)),
  contentType: fc.oneof(fc.constantFrom(...KNOWN_MIMES), fc.constant(null)),
});
