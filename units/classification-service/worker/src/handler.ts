import type { ConvertClaim } from "./message.js";
import type { OfficeConvertClient } from "./office-convert-client.js";
import type { DdbUpdater } from "./ddb-update.js";
import type { Logger } from "./logger.js";
import type { TaskSignaler } from "./task-signaler.js";

/**
 * Disposition the poller uses to decide what to do with the SQS message after
 * the handler returns:
 *
 * - `delete`:     terminal — message is fully handled, remove from queue.
 * - `redrive`:    transient — leave the message on the queue so SQS's
 *                 visibility timeout takes care of redelivery. After
 *                 maxReceiveCount (3 in the CDK stack) redeliveries it
 *                 lands in the DLQ and the depth alarm fires.
 */
export type MessageDisposition = "delete" | "redrive";

export interface HandleArgs {
  readonly claim: ConvertClaim;
  readonly attempts: number;
}

export interface HandlerDeps {
  readonly officeConvert: OfficeConvertClient;
  readonly ddb: DdbUpdater;
  readonly logger: Logger;
  readonly excludeDwg: boolean;
  /** Where the converted PDF lands: s3://{outputBucket}/converted/{documentId}.pdf */
  readonly outputBucket: (claim: ConvertClaim) => string;
  /** Object key inside outputBucket. Default: `converted/{documentId}.pdf`. */
  readonly outputKey: (claim: ConvertClaim) => string;
  /** Signals the SFN convert state machine (no-op when the claim has no token). */
  readonly taskSignaler: TaskSignaler;
}

/**
 * Per-message handler. Owns the full lifecycle of one convert message:
 *
 *   queued (set by classify route) →
 *      converting (handler markConverting + UpdateItem) →
 *         done (office-convert 200 + markDone)
 *      OR failed (caller-error 4xx OR exhausted-retries) + markFailed.
 *
 * The handler is deliberately self-contained — no SQS calls, no AWS-SDK
 * directly. Makes it trivially unit-testable with mocked deps.
 */
export function createHandler(deps: HandlerDeps) {
  const { officeConvert, ddb, logger, excludeDwg, outputBucket, outputKey, taskSignaler } = deps;

  return async function handle(args: HandleArgs): Promise<MessageDisposition> {
    const { claim, attempts } = args;
    const log = logger.with({
      documentId: claim.documentId,
      workspaceId: claim.tenantId,
      runId: claim.runId,
      correlationId: claim.correlationId,
      attempts,
    });

    log.info("handler.start", { filename: claim.filename, subCategory: claim.subCategory });

    // --- 1. DWG short-circuit ----------------------------------------------
    // office-convert's 4-libs vendor path (Words/Cells/Slides/PDF/Email) has
    // NO Aspose.CAD — DWG inputs would 500 with "format_unsupported" anyway.
    // Mark failed locally to give the UI a clean failure_class without the
    // wasted round-trip.
    if (excludeDwg && isDwg(claim.filename)) {
      log.warn("handler.dwg_excluded");
      await ddb.markFailed({
        workspaceId: claim.tenantId,
        runId: claim.runId,
        error: "format_unsupported:dwg",
      });
      await taskSignaler.failure(claim.taskToken, "ConvertExcluded", "format_unsupported:dwg");
      return "delete";
    }

    // --- 2. Mark converting ------------------------------------------------
    // We mark BEFORE the office-convert call so the UI immediately reflects
    // "converting" (with elapsed timer). On retries this is overwritten;
    // convertStartedAt is preserved via if_not_exists() so the timer stays
    // honest across redeliveries.
    try {
      await ddb.markConverting({
        workspaceId: claim.tenantId,
        runId: claim.runId,
        attempts,
        correlationId: claim.correlationId,
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "ConditionalCheckFailedException") {
        // Row was deleted between enqueue and dequeue (TTL? manual cleanup?).
        // Nothing to mark, nothing to do — delete the message rather than
        // redrive forever.
        log.warn("handler.row_missing");
        await taskSignaler.success(claim.taskToken, { skipped: "row_missing" });
        return "delete";
      }
      // Any other DDB error is transient — let SQS redrive.
      log.error("handler.ddb_converting_failed", { errorName: name });
      return "redrive";
    }

    // --- 3. Call office-convert -------------------------------------------
    const s3Input = `s3://${claim.sourceBucket}/${claim.sourceKey}`;
    const outBucket = outputBucket(claim);
    const outKey = outputKey(claim);
    const s3Output = `s3://${outBucket}/${outKey}`;

    const outcome = await officeConvert.convert({
      s3Input,
      s3Output,
      correlationId: claim.correlationId,
    });

    // --- 4. Map outcome to terminal-or-retry --------------------------------
    switch (outcome.kind) {
      case "success":
        await ddb.markDone({
          workspaceId: claim.tenantId,
          runId: claim.runId,
          s3Bucket: outcome.outputBucket ?? outBucket,
          s3Key: outcome.outputKey ?? outKey,
          requestId: outcome.requestId,
        });
        await taskSignaler.success(claim.taskToken, {
          outputBucket: outcome.outputBucket ?? outBucket,
          outputKey: outcome.outputKey ?? outKey,
        });
        log.info("handler.done");
        return "delete";

      case "caller_error": {
        // 4xx — terminal. We can't recover by retrying.
        const errorLine = `office_convert_${outcome.status}:${outcome.failureClass}`;
        await ddb.markFailed({
          workspaceId: claim.tenantId,
          runId: claim.runId,
          error: errorLine,
          ...(outcome.requestId ? { requestId: outcome.requestId } : {}),
        });
        await taskSignaler.failure(claim.taskToken, "ConvertFailed", errorLine);
        log.warn("handler.caller_error", {
          status: outcome.status,
          failureClass: outcome.failureClass,
        });
        return "delete";
      }

      case "server_error":
      case "network_error":
      case "timeout":
        // 5xx / connection failure / our local timeout — redrive. SQS will
        // redeliver after visibility-timeout; after maxReceiveCount it lands
        // in DLQ + the depth alarm fires. We DO NOT mark failed here — the
        // DLQ-fed watchdog (feat/07) is what flips the row to failed once
        // retries are exhausted. This keeps the UI showing "converting"
        // (with attempts counter) during the retry window.
        log.error("handler.transient_failure", { kind: outcome.kind });
        return "redrive";
    }
  };
}

function isDwg(filename: string): boolean {
  return /\.dwg$/i.test(filename);
}
