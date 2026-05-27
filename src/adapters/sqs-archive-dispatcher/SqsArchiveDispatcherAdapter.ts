import { type SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { type Result, ok, err } from "../../shared/result.js";
import type { Logger } from "../../ports/Logger.js";
import type { ArchiveClaimCheck, ArchiveDispatcher, DispatchError } from "../../ports/ArchiveDispatcher.js";
import { mapDispatchError } from "./map-dispatch-error.js";

export interface SqsArchiveDispatcherDeps {
  readonly sqs: SQSClient;
  readonly queueUrl: string;
  readonly logger: Logger;
}

const SQS_TIMEOUT_MS = 5_000;

export function createSqsArchiveDispatcher(deps: SqsArchiveDispatcherDeps): ArchiveDispatcher {
  const { sqs, queueUrl, logger } = deps;

  return Object.freeze({
    async dispatch(claim: ArchiveClaimCheck): Promise<Result<void, DispatchError>> {
      const start = performance.now();
      logger.debug("sqs.archive.dispatch.start", {
        documentId: claim.documentId,
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
        logger.info("sqs.archive.dispatch.ok", {
          documentId: claim.documentId,
          pipelineExecutionId: claim.pipelineExecutionId,
          durationMs: Math.round(performance.now() - start),
        });
        return ok(undefined);
      } catch (e) {
        const mapped = mapDispatchError(e);
        logger.error("sqs.archive.dispatch.error", {
          documentId: claim.documentId,
          durationMs: Math.round(performance.now() - start),
          errorCode: mapped,
          sdkErrorName: (e as Error)?.name,
        });
        return err(mapped);
      }
    },
  });
}
