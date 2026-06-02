import { type SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from "@aws-sdk/client-sfn";
import { type Result, ok, err } from "../../shared/result.js";
import type { Logger } from "../../ports/Logger.js";
import type { TaskSignaler, SignalError } from "../../ports/TaskSignaler.js";
import { mapSignalError } from "./map-signal-error.js";

export interface StepFunctionAdapterDeps {
  readonly sfn: SFNClient;
  readonly logger: Logger;
}

const SFN_TIMEOUT_MS = 5_000;

export function createStepFunctionAdapter(deps: StepFunctionAdapterDeps): TaskSignaler {
  const { sfn, logger } = deps;

  return Object.freeze({
    async sendTaskSuccess(input: { taskToken: string; output: unknown }):
      Promise<Result<void, SignalError>> {
      const start = performance.now();
      logger.debug("sfn.sendTaskSuccess.start", {});

      try {
        await sfn.send(
          new SendTaskSuccessCommand({
            taskToken: input.taskToken,
            output: JSON.stringify(input.output),
          }),
          { abortSignal: AbortSignal.timeout(SFN_TIMEOUT_MS) },
        );
        logger.debug("sfn.sendTaskSuccess.ok", {
          durationMs: Math.round(performance.now() - start),
        });
        return ok(undefined);
      } catch (e) {
        const mapped = mapSignalError(e);
        logger.error("sfn.sendTaskSuccess.error", {
          durationMs: Math.round(performance.now() - start),
          errorCode: mapped,
          sdkErrorName: (e as Error)?.name,
        });
        return err(mapped);
      }
    },

    async sendTaskFailure(input: { taskToken: string; error: { code: string; message: string } }):
      Promise<Result<void, SignalError>> {
      const start = performance.now();
      logger.debug("sfn.sendTaskFailure.start", { errorCode: input.error.code });

      try {
        await sfn.send(
          new SendTaskFailureCommand({
            taskToken: input.taskToken,
            error: input.error.code,
            cause: input.error.message,
          }),
          { abortSignal: AbortSignal.timeout(SFN_TIMEOUT_MS) },
        );
        logger.debug("sfn.sendTaskFailure.ok", {
          durationMs: Math.round(performance.now() - start),
        });
        return ok(undefined);
      } catch (e) {
        const mapped = mapSignalError(e);
        logger.error("sfn.sendTaskFailure.error", {
          durationMs: Math.round(performance.now() - start),
          errorCode: mapped,
          sdkErrorName: (e as Error)?.name,
        });
        return err(mapped);
      }
    },
  });
}
