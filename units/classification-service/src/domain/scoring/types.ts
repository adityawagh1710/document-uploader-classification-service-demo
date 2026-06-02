import type { MatchType } from "../../shared/types.js";

export interface ScoringInput {
  readonly matchType: MatchType;
  readonly detectedFormat: string | null;
  readonly extension: string | null;
  readonly contentType: string | null;
}

export interface Scorer {
  score(input: ScoringInput): number;
}
