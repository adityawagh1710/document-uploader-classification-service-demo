import { BASE_SCORE_TABLE } from "../../shared/constants.js";
import { clamp } from "../../shared/byte-utils.js";
import type { Scorer, ScoringInput } from "./types.js";
import { extensionModifier } from "./extension-modifier.js";
import { contentTypeModifier } from "./content-type-modifier.js";

// Single-clamp arithmetic per BR-S-5 (Q6=A): raw sum then clamp once at the end.
export function createScorer(): Scorer {
  return Object.freeze({
    score(input: ScoringInput): number {
      const base = BASE_SCORE_TABLE[input.matchType];
      const extMod = extensionModifier(input);
      const ctMod = contentTypeModifier(input);
      return clamp(base + extMod + ctMod, 0, 1);
    },
  });
}
