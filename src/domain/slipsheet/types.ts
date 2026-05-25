import type { SlipsheetReason, WorkspaceConfig } from "../../shared/types.js";

export interface SlipsheetInput {
  readonly score: number;
  readonly threshold: number;
  readonly detectedFormat: string | null;
  readonly parentArchiveDepth: number;
  readonly maxZipDepth: number;
  readonly quarantineMacros: boolean;
  readonly slipsheetRules: WorkspaceConfig["slipsheetRules"];
}

export interface SlipsheetDecision {
  readonly slipsheet: boolean;
  readonly reason: SlipsheetReason;
}

export interface SlipsheetDecider {
  decide(input: SlipsheetInput): SlipsheetDecision;
}
