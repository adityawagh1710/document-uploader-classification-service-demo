import {
  SFNClient,
  SendTaskSuccessCommand,
  SendTaskFailureCommand,
} from "@aws-sdk/client-sfn";
import type { Logger } from "./logger.js";

// Signals the Step Functions convert state machine when a message carries a
// task token (sqs:sendMessage.waitForTaskToken). A no-op when the token is
// absent — so plain (non-SFN) dispatch is unaffected.
export interface TaskSignaler {
  success(taskToken: string | undefined, output: unknown): Promise<void>;
  failure(taskToken: string | undefined, error: string, cause: string): Promise<void>;
}

export function createTaskSignaler(sfn: SFNClient, logger: Logger): TaskSignaler {
  return {
    async success(taskToken, output) {
      if (!taskToken) return;
      try {
        await sfn.send(
          new SendTaskSuccessCommand({ taskToken, output: JSON.stringify(output ?? {}) }),
        );
        logger.debug("sfn.send_task_success.ok", {});
      } catch (e) {
        // Best-effort: a failed signal lets the SFN state time out (the backstop
        // that replaces the convert-watchdog). Don't fail the message over it.
        logger.error("sfn.send_task_success.error", { errorName: (e as Error)?.name });
      }
    },
    async failure(taskToken, error, cause) {
      if (!taskToken) return;
      try {
        await sfn.send(new SendTaskFailureCommand({ taskToken, error, cause }));
        logger.debug("sfn.send_task_failure.ok", { error });
      } catch (e) {
        logger.error("sfn.send_task_failure.error", { errorName: (e as Error)?.name });
      }
    },
  };
}

// Used when no SFN endpoint is configured — every call is a no-op.
export const noopTaskSignaler: TaskSignaler = {
  async success() {},
  async failure() {},
};
