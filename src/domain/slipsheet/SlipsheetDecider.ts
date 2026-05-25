import type { SlipsheetDecider, SlipsheetInput, SlipsheetDecision } from "./types.js";

const MACRO_QUARANTINE_FORMATS: ReadonlySet<string> = new Set(["docm", "xlsm", "pptm"]);

// Precedence per BR-D-1:
//   1. workspace-policy  (most explicit)
//   2. max-zip-depth     (security boundary)
//   3. low-confidence    (fallback)
export function createSlipsheetDecider(): SlipsheetDecider {
  return Object.freeze({
    decide(input: SlipsheetInput): SlipsheetDecision {
      // Precedence 1: workspace policy
      if (input.detectedFormat !== null) {
        const fmt = input.detectedFormat.toLowerCase();
        if (input.slipsheetRules[fmt] === "always-slipsheet") {
          return { slipsheet: true, reason: "workspace-policy" };
        }
        if (input.quarantineMacros && MACRO_QUARANTINE_FORMATS.has(fmt)) {
          return { slipsheet: true, reason: "workspace-policy" };
        }
      }

      // Precedence 2: archive depth
      if (input.parentArchiveDepth >= input.maxZipDepth) {
        return { slipsheet: true, reason: "max-zip-depth" };
      }

      // Precedence 3: low confidence — strict > means equal-to-threshold also slipsheets
      if (input.score <= input.threshold) {
        return { slipsheet: true, reason: "low-confidence" };
      }

      return { slipsheet: false, reason: null };
    },
  });
}
