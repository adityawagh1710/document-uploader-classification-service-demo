import type { SignalError } from "../../ports/TaskSignaler.js";

export function mapSignalError(error: unknown): SignalError {
  if (!(error instanceof Error)) return "unknown";
  if (error.name === "TaskDoesNotExist" || error.name === "TaskTimedOut") return "task-not-found";
  if (error.name === "TimeoutError" || error.name === "AbortError") return "transient";

  const code = (error as Error & { code?: string }).code;
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "EHOSTUNREACH") {
    return "transient";
  }
  return "unknown";
}
