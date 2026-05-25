import type { S3Error } from "../../ports/S3Reader.js";

// Exhaustive switch on AWS SDK v3 S3 error.name.
export function mapS3Error(error: unknown): S3Error {
  if (!(error instanceof Error)) return "unknown";

  switch (error.name) {
    case "NoSuchKey":
    case "NotFound":
      return "object-not-found";

    case "AccessDenied":
    case "Forbidden":
      return "access-denied";

    case "TimeoutError":
    case "AbortError":
    case "InternalError":
    case "ServiceUnavailable":
      return "transient";

    case "SlowDown":
    case "ThrottlingException":
      return "throttled";

    default: {
      const code = (error as Error & { code?: string }).code;
      if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "EHOSTUNREACH") {
        return "transient";
      }
      return "unknown";
    }
  }
}
