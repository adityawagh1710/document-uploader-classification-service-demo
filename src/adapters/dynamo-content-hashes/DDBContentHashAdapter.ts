import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ContentHashRecord } from "../../shared/types.js";
import { type Result, ok, err } from "../../shared/result.js";
import type { Logger } from "../../ports/Logger.js";
import type {
  ContentHashStore,
  StoreError,
  PutOutcome,
} from "../../ports/ContentHashStore.js";
import { ddbCallTimeout } from "../shared/with-timeout.js";
import { mapDDBError } from "../shared/map-ddb-error.js";
import { isConditionalCheckFailed } from "../shared/is-conditional-check-failed.js";
import { serialiseRecord, deserialiseRecord } from "./helpers/serialise-record.js";

export interface DDBContentHashAdapterDeps {
  readonly ddb: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly logger: Logger;
}

export function createDDBContentHashAdapter(deps: DDBContentHashAdapterDeps): ContentHashStore {
  const { ddb, tableName, logger } = deps;

  return Object.freeze({
    async get(input: { workspaceId: string; contentHash: string }):
      Promise<Result<ContentHashRecord | null, StoreError>> {
      const start = performance.now();
      logger.debug("contentHashStore.get.start", {
        workspaceId: input.workspaceId,
        contentHash: input.contentHash,
      });

      try {
        const response = await ddb.send(
          new GetCommand({
            TableName: tableName,
            Key: { workspaceId: input.workspaceId, contentHash: input.contentHash },
            ConsistentRead: false,
          }),
          { abortSignal: ddbCallTimeout() },
        );

        if (response.Item === undefined) {
          logger.debug("contentHashStore.get.miss", {
            workspaceId: input.workspaceId,
            durationMs: Math.round(performance.now() - start),
          });
          return ok(null);
        }

        const record = deserialiseRecord(response.Item);
        if (record === null) {
          logger.error("contentHashStore.get.malformed", {
            workspaceId: input.workspaceId,
            durationMs: Math.round(performance.now() - start),
            errorCode: "unknown",
          });
          return err("unknown");
        }

        logger.debug("contentHashStore.get.hit", {
          workspaceId: input.workspaceId,
          durationMs: Math.round(performance.now() - start),
        });
        return ok(record);
      } catch (e) {
        const mapped = mapDDBError(e);
        logger.error("contentHashStore.get.error", {
          workspaceId: input.workspaceId,
          durationMs: Math.round(performance.now() - start),
          errorCode: mapped,
          sdkErrorName: (e as Error)?.name,
        });
        return err(mapped);
      }
    },

    async putIfAbsent(record: ContentHashRecord): Promise<Result<PutOutcome, StoreError>> {
      const start = performance.now();
      logger.debug("contentHashStore.putIfAbsent.start", {
        workspaceId: record.workspaceId,
        contentHash: record.contentHash,
      });

      try {
        await ddb.send(
          new PutCommand({
            TableName: tableName,
            Item: serialiseRecord(record),
            ConditionExpression: "attribute_not_exists(contentHash)",
          }),
          { abortSignal: ddbCallTimeout() },
        );
        logger.debug("contentHashStore.putIfAbsent.ok", {
          workspaceId: record.workspaceId,
          durationMs: Math.round(performance.now() - start),
          outcome: "written",
        });
        return ok("written");
      } catch (e) {
        if (isConditionalCheckFailed(e)) {
          logger.debug("contentHashStore.putIfAbsent.race", {
            workspaceId: record.workspaceId,
            durationMs: Math.round(performance.now() - start),
          });
          return ok("already-existed");
        }
        const mapped = mapDDBError(e);
        logger.error("contentHashStore.putIfAbsent.error", {
          workspaceId: record.workspaceId,
          durationMs: Math.round(performance.now() - start),
          errorCode: mapped,
          sdkErrorName: (e as Error)?.name,
        });
        return err(mapped);
      }
    },

    async updateOnDuplicateHit(input: { workspaceId: string; contentHash: string; now: string }):
      Promise<Result<void, StoreError>> {
      const start = performance.now();
      logger.debug("contentHashStore.updateOnDuplicateHit.start", {
        workspaceId: input.workspaceId,
        contentHash: input.contentHash,
      });

      try {
        await ddb.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { workspaceId: input.workspaceId, contentHash: input.contentHash },
            UpdateExpression: "SET lastSeenAt = :now ADD hitCount :one",
            ConditionExpression: "attribute_exists(contentHash)",
            ExpressionAttributeValues: {
              ":now": input.now,
              ":one": 1,
            },
          }),
          { abortSignal: ddbCallTimeout() },
        );
        logger.debug("contentHashStore.updateOnDuplicateHit.ok", {
          workspaceId: input.workspaceId,
          durationMs: Math.round(performance.now() - start),
        });
        return ok(undefined);
      } catch (e) {
        const mapped = mapDDBError(e);
        logger.error("contentHashStore.updateOnDuplicateHit.error", {
          workspaceId: input.workspaceId,
          durationMs: Math.round(performance.now() - start),
          errorCode: mapped,
          sdkErrorName: (e as Error)?.name,
        });
        return err(mapped);
      }
    },

    async replaceOnPolicyMismatch(input: {
      record: ContentHashRecord;
      expectedStalePolicyVersion: string;
    }): Promise<Result<void, StoreError>> {
      const start = performance.now();
      logger.debug("contentHashStore.replaceOnPolicyMismatch.start", {
        workspaceId: input.record.workspaceId,
        contentHash: input.record.contentHash,
      });

      try {
        await ddb.send(
          new PutCommand({
            TableName: tableName,
            Item: serialiseRecord(input.record),
            ConditionExpression: "policyVersion = :stalePolicyVersion",
            ExpressionAttributeValues: {
              ":stalePolicyVersion": input.expectedStalePolicyVersion,
            },
          }),
          { abortSignal: ddbCallTimeout() },
        );
        logger.debug("contentHashStore.replaceOnPolicyMismatch.ok", {
          workspaceId: input.record.workspaceId,
          durationMs: Math.round(performance.now() - start),
        });
        return ok(undefined);
      } catch (e) {
        const mapped = mapDDBError(e);
        logger.error("contentHashStore.replaceOnPolicyMismatch.error", {
          workspaceId: input.record.workspaceId,
          durationMs: Math.round(performance.now() - start),
          errorCode: mapped,
          sdkErrorName: (e as Error)?.name,
        });
        return err(mapped);
      }
    },
  });
}
