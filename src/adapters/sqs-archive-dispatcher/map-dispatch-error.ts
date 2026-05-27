import type { DispatchError } from "../../ports/ArchiveDispatcher.js";

export function mapDispatchError(error: unknown): DispatchError {
  if (!(error instanceof Error)) return "unknown";
  if (
    error.name === "QueueDoesNotExist" ||
    error.name === "AWS.SimpleQueueService.NonExistentQueue"
  ) {
    return "queue-not-found";
  }
  if (error.name === "TimeoutError" || error.name === "AbortError") return "transient";

  const code = (error as Error & { code?: string }).code;
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "EHOSTUNREACH") {
    return "transient";
  }
  return "unknown";
}
