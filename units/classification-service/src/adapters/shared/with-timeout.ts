export const DEFAULT_DDB_TIMEOUT_MS = 2_000;

// Pattern P-2-5: hard upper bound per DDB call.
// Returns an AbortSignal that fires after `ms`.
export function ddbCallTimeout(ms: number = DEFAULT_DDB_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}
