import type { ContentHashRecord } from "../shared/types.js";
import type { Result } from "../shared/result.js";

export type StoreError =
  | "conditional-check-failed"
  | "throttled"
  | "transient"
  | "not-found"
  | "unknown";

export type PutOutcome = "written" | "already-existed";

export interface ContentHashStore {
  get(input: { workspaceId: string; contentHash: string }):
    Promise<Result<ContentHashRecord | null, StoreError>>;

  putIfAbsent(record: ContentHashRecord):
    Promise<Result<PutOutcome, StoreError>>;

  updateOnDuplicateHit(input: { workspaceId: string; contentHash: string; now: string }):
    Promise<Result<void, StoreError>>;

  replaceOnPolicyMismatch(input: {
    record: ContentHashRecord;
    expectedStalePolicyVersion: string;
  }): Promise<Result<void, StoreError>>;
}
