import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createOfficeConvertClient } from "./office-convert-client.js";
import { createDdbUpdater } from "./ddb-update.js";
import { createHandler } from "./handler.js";
import { runPoller } from "./poller.js";

/**
 * Worker entry point. Wires deps, installs signal handlers, runs the poller.
 *
 * The process is single-replica friendly:
 *   - one SQS long-poll at a time
 *   - one office-convert call at a time
 *   - exits cleanly on SIGTERM (k8s pod kill) — in-flight message stays on
 *     queue, SQS redelivers after visibility-timeout
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const baseLogger = createLogger({
    level: config.logLevel,
    base: { component: "convert-worker", version: config.workerVersion },
  });
  baseLogger.info("worker.boot", {
    convertQueueUrl: config.convertQueueUrl,
    officeConvertBaseUrl: config.officeConvertBaseUrl,
    classificationsTableName: config.classificationsTableName,
    awsRegion: config.awsRegion,
    awsEndpointUrl: config.awsEndpointUrl ?? null,
    excludeDwg: config.excludeDwg,
  });

  // --- AWS clients -------------------------------------------------------
  // Always pass `region`; endpoint is set only in LocalStack mode (matches
  // the UI's classifier.ts convention so the dev loop is uniform).
  const sqs = new SQSClient({
    region: config.awsRegion,
    ...(config.awsEndpointUrl ? { endpoint: config.awsEndpointUrl } : {}),
  });
  const ddbRaw = new DynamoDBClient({
    region: config.awsRegion,
    ...(config.awsEndpointUrl ? { endpoint: config.awsEndpointUrl } : {}),
  });
  const ddb = DynamoDBDocumentClient.from(ddbRaw, {
    marshallOptions: { removeUndefinedValues: true },
  });

  // --- Application clients ------------------------------------------------
  const officeConvert = createOfficeConvertClient({
    baseUrl: config.officeConvertBaseUrl,
    timeoutMs: config.officeConvertTimeoutMs,
    logger: baseLogger.with({ subsystem: "office-convert" }),
  });
  const ddbUpdater = createDdbUpdater({
    ddb,
    tableName: config.classificationsTableName,
    logger: baseLogger.with({ subsystem: "ddb" }),
  });
  const handle = createHandler({
    officeConvert,
    ddb: ddbUpdater,
    logger: baseLogger.with({ subsystem: "handler" }),
    excludeDwg: config.excludeDwg,
    outputBucket: (claim) => claim.sourceBucket,
    outputKey: (claim) => `converted/${claim.documentId}.pdf`,
  });

  // --- Graceful shutdown wiring ------------------------------------------
  const ac = new AbortController();
  const onSignal = (name: string) => {
    baseLogger.info("worker.signal", { name });
    ac.abort();
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));

  await runPoller({
    sqs,
    queueUrl: config.convertQueueUrl,
    waitTimeSeconds: config.sqsWaitTimeSeconds,
    maxMessages: config.sqsMaxMessages,
    handle,
    logger: baseLogger.with({ subsystem: "poller" }),
    signal: ac.signal,
  });

  // Clean shutdown — destroy the SDK clients so any keep-alive connections
  // close and the process exits without lingering handles.
  sqs.destroy();
  ddbRaw.destroy();
  baseLogger.info("worker.exit");
}

main().catch((e) => {
  // Top-level catch — config-validation failure, AWS SDK init failure, etc.
  // Emit a single structured line so the operator's `kubectl logs` shows
  // something useful before the pod restart.
  const err = e as Error;
  process.stdout.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      event: "worker.fatal",
      component: "convert-worker",
      errorName: err?.name,
      message: err?.message,
      stack: err?.stack,
    })}\n`,
  );
  process.exit(1);
});
