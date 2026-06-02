import type { Handler } from "aws-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { SFNClient } from "@aws-sdk/client-sfn";
import { SQSClient } from "@aws-sdk/client-sqs";

import { createDDBDocumentClient } from "../adapters/shared/dynamo-client.js";
import { createDDBContentHashAdapter } from "../adapters/dynamo-content-hashes/index.js";
import { createDDBWorkspaceConfigAdapter } from "../adapters/dynamo-workspace-config/index.js";
import { createS3Adapter } from "../adapters/s3/index.js";
import { createNodeCryptoHasher } from "../adapters/crypto/index.js";
import { createStepFunctionAdapter } from "../adapters/step-functions/index.js";
import { createSqsArchiveDispatcher } from "../adapters/sqs-archive-dispatcher/index.js";
import { createPowertoolsLogger } from "../adapters/powertools/index.js";
import type { ArchiveDispatcher } from "../ports/ArchiveDispatcher.js";

import {
  createTier1FileTypeDetector,
} from "../domain/tier1-filetype/index.js";
import {
  createOLE2Parser,
  createTier2OLE2Detector,
} from "../domain/tier2-ole2/index.js";
import {
  createZIPMarkerParser,
  createTier2ZIPDetector,
} from "../domain/tier2-zip/index.js";
import { createTier3TextDetector } from "../domain/tier3-text/index.js";
import { createScorer } from "../domain/scoring/index.js";
import { createCategoryMapper } from "../domain/categories/index.js";
import { createSlipsheetDecider } from "../domain/slipsheet/index.js";

import {
  createClassificationService,
  createInputValidator,
  mapFailureToErrorCode,
  isTransientOrThrottled,
} from "../application/index.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// --- Module-load singletons (Pattern P-3-1) ----------------------------

const ddb = createDDBDocumentClient();
// When AWS_ENDPOINT_URL is set we're talking to LocalStack (SAM Local /
// integration / smoke). Two LocalStack-specific quirks handled here:
//  1. LocalStack returns CRC32 checksums that don't match the body for
//     objects written via multipart Upload, which the SDK v3.730+ default
//     `WHEN_SUPPORTED` validation then rejects.
//  2. Default virtual-hosted addressing resolves to `<bucket>.localstack`,
//     which has no DNS record inside the compose network. Force path-style.
// Match the workaround in ui/lib/classifier.ts. Real AWS S3 is unaffected,
// so production keeps the SDK defaults.
const s3LocalstackOverrides =
  process.env.AWS_ENDPOINT_URL !== undefined
    ? {
        responseChecksumValidation: "WHEN_REQUIRED" as const,
        requestChecksumCalculation: "WHEN_REQUIRED" as const,
        forcePathStyle: true,
      }
    : {};
const s3 = new S3Client({
  retryMode: "standard",
  maxAttempts: 3,
  ...s3LocalstackOverrides,
});
const sfn = new SFNClient({ retryMode: "standard", maxAttempts: 3 });

const logger = createPowertoolsLogger("classification-service", "documentId");

const inputValidator = createInputValidator();
const s3Adapter = createS3Adapter({ s3, logger });
const taskSignaler = createStepFunctionAdapter({ sfn, logger });

// Archive dispatch is optional: only wired when ZIP_EXTRACTION_QUEUE_URL is set.
// Absence => classifier still runs and signals SFN; just no archive fan-out.
const zipExtractionQueueUrl = process.env.ZIP_EXTRACTION_QUEUE_URL;
const archiveDispatcher: ArchiveDispatcher | undefined =
  zipExtractionQueueUrl !== undefined && zipExtractionQueueUrl !== ""
    ? createSqsArchiveDispatcher({
        sqs: new SQSClient({ retryMode: "standard", maxAttempts: 3 }),
        queueUrl: zipExtractionQueueUrl,
        logger,
      })
    : undefined;

const classificationService = createClassificationService({
  tier1: createTier1FileTypeDetector(),
  tier2OLE2: createTier2OLE2Detector({ parser: createOLE2Parser() }),
  tier2ZIP: createTier2ZIPDetector({ parser: createZIPMarkerParser() }),
  tier3Text: createTier3TextDetector(),
  scorer: createScorer(),
  categoryMapper: createCategoryMapper(),
  slipsheetDecider: createSlipsheetDecider(),
  s3Reader: s3Adapter,
  s3Streamer: s3Adapter,
  hasher: createNodeCryptoHasher(),
  contentHashStore: createDDBContentHashAdapter({
    ddb,
    tableName: requireEnv("CONTENT_HASH_TABLE_NAME"),
    logger,
  }),
  workspaceConfigStore: createDDBWorkspaceConfigAdapter({
    ddb,
    tableName: requireEnv("WORKSPACE_CONFIG_TABLE_NAME"),
    logger,
  }),
  logger,
  nowProvider: () => new Date().toISOString(),
  policyVersionExtractor: (config) => config.policyVersion,
});

// --- Lambda handler (Pattern P-3-7) ------------------------------------

export const handler: Handler<unknown, void> = async (event) => {
  let taskToken: string | undefined;

  try {
    const validation = inputValidator.validate(event);
    if (!validation.ok) {
      const rawToken = (event as { taskToken?: unknown })?.taskToken;
      if (typeof rawToken === "string") {
        await taskSignaler.sendTaskFailure({
          taskToken: rawToken,
          error: {
            code: "INPUT_VALIDATION_FAILED",
            message: `${validation.error.field}: ${validation.error.message}`,
          },
        });
        return;
      }
      throw new Error("input validation failed without taskToken");
    }

    const payload = validation.value;
    taskToken = payload.taskToken;

    const result = await classificationService.classify(payload);

    if (result.ok) {
      // Fan out archives to the zip-extraction queue when wired. Dispatch
      // failures are logged inside the adapter and never block the SFN
      // callback — the classifier's primary contract is the SendTaskSuccess.
      if (
        archiveDispatcher !== undefined &&
        result.value.classification.category === "archive"
      ) {
        await archiveDispatcher.dispatch({
          pipelineExecutionId: payload.pipelineExecutionId ?? payload.documentId,
          tenantId: payload.workspaceId,
          documentId: payload.documentId,
          sourceBucket: payload.s3.bucket,
          sourceKey: payload.s3.key,
          correlationId: payload.correlationId ?? payload.documentId,
        });
      }

      const signal = await taskSignaler.sendTaskSuccess({
        taskToken,
        output: result.value,
      });
      if (!signal.ok) {
        throw new Error(`sendTaskSuccess failed: ${signal.error}`);
      }
      return;
    }

    if (isTransientOrThrottled(result.error)) {
      throw new Error(`Transient/throttled failure: ${JSON.stringify(result.error)}`);
    }

    const { code, message } = mapFailureToErrorCode(result.error);
    const signal = await taskSignaler.sendTaskFailure({
      taskToken,
      error: { code, message },
    });
    if (!signal.ok) {
      throw new Error(`sendTaskFailure failed: ${signal.error}`);
    }
  } catch (e) {
    logger.error("handler.unexpected", {
      errorMessage: (e as Error)?.message ?? "unknown",
    });

    if (taskToken !== undefined) {
      try {
        await taskSignaler.sendTaskFailure({
          taskToken,
          error: {
            code: "UNEXPECTED_ERROR",
            message: (e as Error)?.message ?? "Unknown error",
          },
        });
      } catch {
        // Best-effort; fall through to re-throw
      }
    }

    throw e;
  }
};
