import type { Result } from "../shared/result.js";
import type { DispatchError } from "./ArchiveDispatcher.js";

/**
 * Reuses the dispatch error vocabulary from ArchiveDispatcher (same SDK,
 * same failure modes). Imported by the SQS adapter; not re-exported from
 * here to avoid two sources of truth for `DispatchError`.
 */
export type { DispatchError } from "./ArchiveDispatcher.js";

/**
 * Convert claim-check — the message body the classify route enqueues to
 * the convert queue when `category === "convert"`. Shape mirrors
 * `ArchiveClaimCheck` (`./ArchiveDispatcher.ts`) and the worker-side schema
 * in `worker/src/message.ts`. Any field rename here is a coordinated change
 * across all three.
 */
export interface ConvertClaimCheck {
  /**
   * Pipeline execution id — placeholder today (= documentId), populated by
   * the Step Functions execution id in production. Carried end-to-end for
   * correlation; never used to key DDB.
   */
  readonly pipelineExecutionId: string;
  /** = workspaceId. DDB partition key. */
  readonly tenantId: string;
  readonly documentId: string;
  /**
   * = classifications-dev sort key (`<ISO-ts>#<documentId>`). Lets the
   * worker UpdateItem directly instead of Querying. Stable for the life
   * of the row.
   */
  readonly runId: string;
  /** s3://{sourceBucket}/{sourceKey} is the office-convert `s3_input`. */
  readonly sourceBucket: string;
  readonly sourceKey: string;
  /** Original upload name. Drives office-convert's format detection. */
  readonly filename: string;
  /** "office" | "tiff" | "convert-then-ocr" | null — for future routing. */
  readonly subCategory: string | null;
  /** End-to-end correlation id stamped into every log line for this run. */
  readonly correlationId: string;
}

export interface ConvertDispatcher {
  dispatch(claim: ConvertClaimCheck): Promise<Result<void, DispatchError>>;
}
