import {
  type DynamoDBDocumentClient,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Logger } from "./logger.js";

/**
 * Convert-status attribute writes onto the classifications-dev row keyed by
 * (workspaceId, runId).
 *
 * The classifications-dev row is created by the classify route (feat/05) with
 * convertStatus=queued when category=convert; the worker then transitions
 * it through `converting` → `done` | `failed`.
 *
 * All updates use a ConditionExpression that the row already exists, so a
 * lost-on-redrive scenario where the worker fires UpdateItem on a deleted
 * row surfaces as a clean ConditionalCheckFailedException rather than
 * accidentally creating a phantom row.
 *
 * UpdateItem semantics:
 *   - convertStatus: enum (queued|converting|done|failed)
 *   - convertStartedAt: ISO-ts set on the converting transition (never overwritten on retries)
 *   - convertCompletedAt: ISO-ts set on the terminal transition
 *   - convertS3Bucket/Key: set on done only
 *   - convertRequestId: set when office-convert returns X-Request-ID (we capture it
 *     on either success OR caller_error responses for diagnostics)
 *   - convertError: set on failed only
 *   - convertAttempts: incremented from the SQS ApproximateReceiveCount header
 */

export interface ConvertingArgs {
  workspaceId: string;
  runId: string;
  /** = SQS ApproximateReceiveCount header. */
  attempts: number;
  /** = correlationId from the claim — also written to the row for grep-ability. */
  correlationId: string;
}

export interface DoneArgs {
  workspaceId: string;
  runId: string;
  s3Bucket: string;
  s3Key: string;
  requestId: string;
}

export interface FailedArgs {
  workspaceId: string;
  runId: string;
  /** Single-line reason: `office_convert_5xx:render_failed`, `format_unsupported:dwg`, etc. */
  error: string;
  requestId?: string;
}

export interface DdbUpdater {
  markConverting(args: ConvertingArgs): Promise<void>;
  markDone(args: DoneArgs): Promise<void>;
  markFailed(args: FailedArgs): Promise<void>;
}

export interface DdbUpdaterDeps {
  readonly ddb: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly logger: Logger;
}

export function createDdbUpdater(deps: DdbUpdaterDeps): DdbUpdater {
  const { ddb, tableName, logger } = deps;

  return {
    async markConverting(args) {
      // if_not_exists() guards convertStartedAt — on a redrive after the first
      // attempt got partway through, we keep the FIRST started-at so the UI's
      // elapsed-timer doesn't reset on every redelivery.
      await ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { workspaceId: args.workspaceId, runId: args.runId },
          UpdateExpression:
            "SET convertStatus = :s, " +
            "convertStartedAt = if_not_exists(convertStartedAt, :now), " +
            "convertAttempts = :a, " +
            "convertCorrelationId = :c",
          ConditionExpression: "attribute_exists(workspaceId)",
          ExpressionAttributeValues: {
            ":s": "converting",
            ":now": new Date().toISOString(),
            ":a": args.attempts,
            ":c": args.correlationId,
          },
        }),
      );
      logger.debug("ddb.update.converting.ok", {
        workspaceId: args.workspaceId,
        runId: args.runId,
        attempts: args.attempts,
      });
    },

    async markDone(args) {
      await ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { workspaceId: args.workspaceId, runId: args.runId },
          UpdateExpression:
            "SET convertStatus = :s, " +
            "convertCompletedAt = :now, " +
            "convertS3Bucket = :b, " +
            "convertS3Key = :k, " +
            "convertRequestId = :r",
          ConditionExpression: "attribute_exists(workspaceId)",
          ExpressionAttributeValues: {
            ":s": "done",
            ":now": new Date().toISOString(),
            ":b": args.s3Bucket,
            ":k": args.s3Key,
            ":r": args.requestId,
          },
        }),
      );
      logger.info("ddb.update.done.ok", {
        workspaceId: args.workspaceId,
        runId: args.runId,
        s3Key: args.s3Key,
      });
    },

    async markFailed(args) {
      // Truncate convertError to keep DDB items small (and to keep the UI
      // tooltip readable). 500 chars is comfortably under the 400 KB item
      // limit and covers any office-convert failure_class:detail string.
      const truncatedError = args.error.slice(0, 500);
      await ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { workspaceId: args.workspaceId, runId: args.runId },
          UpdateExpression:
            "SET convertStatus = :s, " +
            "convertCompletedAt = :now, " +
            "convertError = :e" +
            (args.requestId ? ", convertRequestId = :r" : ""),
          ConditionExpression: "attribute_exists(workspaceId)",
          ExpressionAttributeValues: {
            ":s": "failed",
            ":now": new Date().toISOString(),
            ":e": truncatedError,
            ...(args.requestId ? { ":r": args.requestId } : {}),
          },
        }),
      );
      logger.warn("ddb.update.failed.ok", {
        workspaceId: args.workspaceId,
        runId: args.runId,
        error: truncatedError,
      });
    },
  };
}
