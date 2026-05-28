import { type SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { type Result, ok, err } from "../../shared/result.js";
import type { Logger } from "../../ports/Logger.js";
import type {
  ConvertClaimCheck,
  ConvertDispatcher,
} from "../../ports/ConvertDispatcher.js";
import type { DispatchError } from "../../ports/ArchiveDispatcher.js";
import { mapDispatchError } from "../sqs-archive-dispatcher/map-dispatch-error.js";

export interface SqsConvertDispatcherDeps {
  readonly sqs: SQSClient;
  readonly queueUrl: string;
  readonly logger: Logger;
}

/**
 * Mirror of SqsArchiveDispatcherAdapter — different port + queue, same
 * SDK call shape, same timeout discipline. We deliberately reuse the
 * `mapDispatchError` helper from the archive adapter rather than fork a
 * second copy: the SDK error vocabulary is identical for any SQS
 * SendMessage call.
 */
const SQS_TIMEOUT_MS = 5_000;

export function createSqsConvertDispatcher(
  deps: SqsConvertDispatcherDeps,
): ConvertDispatcher {
  const { sqs, queueUrl, logger } = deps;

  return Object.freeze({
    async dispatch(
      claim: ConvertClaimCheck,
    ): Promise<Result<void, DispatchError>> {
      const start = performance.now();
      logger.debug("sqs.convert.dispatch.start", {
        documentId: claim.documentId,
        runId: claim.runId,
        pipelineExecutionId: claim.pipelineExecutionId,
      });

      try {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(claim),
          }),
          { abortSignal: AbortSignal.timeout(SQS_TIMEOUT_MS) },
        );
        logger.info("sqs.convert.dispatch.ok", {
          documentId: claim.documentId,
          runId: claim.runId,
          pipelineExecutionId: claim.pipelineExecutionId,
          durationMs: Math.round(performance.now() - start),
        });
        return ok(undefined);
      } catch (e) {
        const mapped = mapDispatchError(e);
        logger.error("sqs.convert.dispatch.error", {
          documentId: claim.documentId,
          runId: claim.runId,
          durationMs: Math.round(performance.now() - start),
          errorCode: mapped,
          sdkErrorName: (e as Error)?.name,
        });
        return err(mapped);
      }
    },
  });
}
