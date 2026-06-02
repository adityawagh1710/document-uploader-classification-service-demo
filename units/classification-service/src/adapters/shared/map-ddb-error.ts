import type { StoreError } from "../../ports/ContentHashStore.js";

// Pattern P-2-7: exhaustive switch on AWS SDK v3 error.name.
// Every documented SDK error name maps to exactly one non-"unknown" StoreError;
// PBT-U2-004 verifies the totality.
export function mapDDBError(error: unknown): StoreError {
  if (!(error instanceof Error)) return "unknown";

  switch (error.name) {
    case "ConditionalCheckFailedException":
      return "conditional-check-failed";

    case "ProvisionedThroughputExceededException":
    case "ThrottlingException":
    case "RequestLimitExceeded":
      return "throttled";

    case "ResourceNotFoundException":
      return "unknown";

    case "InternalServerError":
    case "ServiceUnavailable":
      return "transient";

    case "TimeoutError":
    case "AbortError":
      return "transient";

    default:
      if (isRetryableNetworkError(error)) return "transient";
      return "unknown";
  }
}

function isRetryableNetworkError(error: Error): boolean {
  const code = (error as Error & { code?: string }).code;
  return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EHOSTUNREACH" || code === "ENOTFOUND";
}
