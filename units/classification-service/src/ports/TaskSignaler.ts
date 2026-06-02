import type { Result } from "../shared/result.js";

export type SignalError =
  | "task-not-found"
  | "transient"
  | "unknown";

export interface TaskSignaler {
  sendTaskSuccess(input: { taskToken: string; output: unknown }):
    Promise<Result<void, SignalError>>;
  sendTaskFailure(input: { taskToken: string; error: { code: string; message: string } }):
    Promise<Result<void, SignalError>>;
}
