import type { Result } from "../shared/result.js";

export type DispatchError =
  | "queue-not-found"
  | "transient"
  | "unknown";

export interface ArchiveClaimCheck {
  readonly pipelineExecutionId: string;
  readonly tenantId: string;
  readonly documentId: string;
  readonly sourceBucket: string;
  readonly sourceKey: string;
  readonly correlationId: string;
}

export interface ArchiveDispatcher {
  dispatch(claim: ArchiveClaimCheck): Promise<Result<void, DispatchError>>;
}
