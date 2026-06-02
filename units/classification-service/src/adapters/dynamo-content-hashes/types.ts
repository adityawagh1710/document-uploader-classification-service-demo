export type { ContentHashRecordInit } from "./helpers/build-record.js";

export interface UpdateOnDuplicateHitInput {
  readonly workspaceId: string;
  readonly contentHash: string;
  readonly now: string;
}

import type { ContentHashRecord } from "../../shared/types.js";

export interface ReplaceOnPolicyMismatchInput {
  readonly record: ContentHashRecord;
  readonly expectedStalePolicyVersion: string;
}
