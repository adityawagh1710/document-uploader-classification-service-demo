import { type DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { WorkspaceConfig } from "../../shared/types.js";
import { type Result, ok, err } from "../../shared/result.js";
import type { Logger } from "../../ports/Logger.js";
import type { WorkspaceConfigStore } from "../../ports/WorkspaceConfigStore.js";
import type { StoreError } from "../../ports/ContentHashStore.js";
import { ddbCallTimeout } from "../shared/with-timeout.js";
import { mapDDBError } from "../shared/map-ddb-error.js";

export interface DDBWorkspaceConfigAdapterDeps {
  readonly ddb: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly logger: Logger;
}

export function createDDBWorkspaceConfigAdapter(deps: DDBWorkspaceConfigAdapterDeps): WorkspaceConfigStore {
  const { ddb, tableName, logger } = deps;

  return Object.freeze({
    async get(workspaceId: string): Promise<Result<WorkspaceConfig, StoreError>> {
      const start = performance.now();
      logger.debug("workspaceConfigStore.get.start", { workspaceId });

      try {
        const response = await ddb.send(
          new GetCommand({
            TableName: tableName,
            Key: { workspaceId },
            ConsistentRead: true,
          }),
          { abortSignal: ddbCallTimeout() },
        );

        if (response.Item === undefined) {
          logger.error("workspaceConfigStore.get.not-found", {
            workspaceId,
            durationMs: Math.round(performance.now() - start),
            errorCode: "not-found",
          });
          return err("not-found");
        }

        const config = deserialiseConfig(response.Item, workspaceId);
        if (config === null) {
          logger.error("workspaceConfigStore.get.malformed", {
            workspaceId,
            durationMs: Math.round(performance.now() - start),
            errorCode: "unknown",
          });
          return err("unknown");
        }

        logger.debug("workspaceConfigStore.get.ok", {
          workspaceId,
          durationMs: Math.round(performance.now() - start),
        });
        return ok(config);
      } catch (e) {
        const mapped = mapDDBError(e);
        logger.error("workspaceConfigStore.get.error", {
          workspaceId,
          durationMs: Math.round(performance.now() - start),
          errorCode: mapped,
          sdkErrorName: (e as Error)?.name,
        });
        return err(mapped);
      }
    },
  });
}

function deserialiseConfig(item: Record<string, unknown>, workspaceId: string): WorkspaceConfig | null {
  const policyVersion = typeof item.policyVersion === "string" ? item.policyVersion : null;
  const threshold = typeof item.threshold === "number" ? item.threshold : null;
  const maxZipDepth = typeof item.maxZipDepth === "number" ? item.maxZipDepth : null;
  const quarantineMacros = typeof item.quarantineMacros === "boolean" ? item.quarantineMacros : null;
  const slipsheetRules = isStringRecord(item.slipsheetRules) ? item.slipsheetRules : null;
  const hashTtlDays = item.hashTtlDays === null || item.hashTtlDays === undefined
    ? null
    : typeof item.hashTtlDays === "number"
      ? item.hashTtlDays
      : undefined;

  if (
    policyVersion === null || threshold === null || maxZipDepth === null ||
    quarantineMacros === null || slipsheetRules === null || hashTtlDays === undefined
  ) {
    return null;
  }

  return {
    workspaceId,
    policyVersion,
    threshold,
    maxZipDepth,
    quarantineMacros,
    slipsheetRules: slipsheetRules as Readonly<Record<string, "always-slipsheet">>,
    hashTtlDays,
  };
}

function isStringRecord(v: unknown): v is Record<string, "always-slipsheet"> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  for (const value of Object.values(v as Record<string, unknown>)) {
    if (value !== "always-slipsheet") return false;
  }
  return true;
}
