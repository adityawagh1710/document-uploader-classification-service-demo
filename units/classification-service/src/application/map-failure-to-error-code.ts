import type { ClassificationFailure } from "./types.js";

// Total switch on ClassificationFailure.kind -> SendTaskFailure {code, message}.
// PBT-U3-005 verifies totality.
export function mapFailureToErrorCode(failure: ClassificationFailure): { code: string; message: string } {
  switch (failure.kind) {
    case "input-validation":
      return { code: "INPUT_VALIDATION_FAILED", message: `${failure.field}: ${failure.message}` };

    case "s3":
      switch (failure.reason) {
        case "object-not-found": return { code: "S3_OBJECT_NOT_FOUND", message: "S3 object not found" };
        case "access-denied": return { code: "S3_ACCESS_DENIED", message: "S3 access denied" };
        case "transient": return { code: "S3_TRANSIENT", message: "S3 transient error" };
        case "throttled": return { code: "S3_THROTTLED", message: "S3 throttled" };
        case "unknown": return { code: "INTERNAL_ERROR", message: "S3 unknown error" };
      }
      break;

    case "store":
      switch (failure.reason) {
        case "not-found": return { code: "WORKSPACE_NOT_FOUND", message: "Workspace config not found" };
        case "conditional-check-failed": return { code: "DDB_CONDITION_FAILED", message: "DynamoDB conditional check failed" };
        case "throttled": return { code: "DDB_THROTTLED", message: "DynamoDB throttled" };
        case "transient": return { code: "DDB_TRANSIENT", message: "DynamoDB transient error" };
        case "unknown": return { code: "INTERNAL_ERROR", message: "DynamoDB unknown error" };
      }
      break;

    case "signal":
      return { code: "SIGNAL_ERROR", message: `Failed to signal Step Function task: ${failure.reason}` };

    case "unexpected":
      return { code: "UNEXPECTED_ERROR", message: failure.message };
  }

  // Unreachable when ClassificationFailure is exhaustive.
  const _exhaustive: never = failure;
  return { code: "UNEXPECTED_ERROR", message: `unreachable: ${JSON.stringify(_exhaustive)}` };
}

// Helper used by the Lambda handler to decide throw vs SendTaskFailure (Q4=A).
export function isTransientOrThrottled(failure: ClassificationFailure): boolean {
  if (failure.kind === "s3") {
    return failure.reason === "transient" || failure.reason === "throttled";
  }
  if (failure.kind === "store") {
    return failure.reason === "transient" || failure.reason === "throttled";
  }
  return false;
}
