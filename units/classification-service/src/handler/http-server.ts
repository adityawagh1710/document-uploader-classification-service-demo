// Synchronous classification HTTP endpoint (request/response) on fastify.
//
// This is the wire surface the wundergraph-router's `classify` resolver calls.
// It wraps the SAME engine the Step Functions Lambda runs (via the shared
// composition) but returns the ClassificationOutput directly instead of
// signalling Step Functions — so the UI gets an answer over the wire without
// embedding the engine in-process. fastify is the platform-mandated TS HTTP
// server (tech-environment.md).
//
//   POST /classify   { workspaceId, documentId, s3:{bucket,key}, hints?, context? }
//                    -> 200 ClassificationOutput | 422 {error} | 4xx/5xx {error}
//   GET  /healthz    -> 200 "ok"

import Fastify from "fastify";
import { S3Client } from "@aws-sdk/client-s3";

import { createDDBDocumentClient } from "../adapters/shared/dynamo-client.js";
import { createPinoLogger } from "../adapters/pino/index.js";
import { composeClassificationService } from "./classification-service-factory.js";
import type { TaskPayload } from "../shared/types.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

interface ClassifyRequest {
  workspaceId?: string;
  documentId?: string;
  s3?: { bucket?: string; key?: string };
  hints?: { extension?: string | null; contentType?: string | null };
  context?: { parentArchiveDepth?: number; overrideDuplicateCheck?: boolean };
  pipelineExecutionId?: string;
  correlationId?: string;
}

const logger = createPinoLogger("classification-http", "documentId");

// Mirror lambda.ts's LocalStack handling: when AWS_ENDPOINT_URL is set, relax
// checksum validation + force path-style so reads against LocalStack succeed.
const s3LocalstackOverrides =
  process.env.AWS_ENDPOINT_URL !== undefined
    ? {
        responseChecksumValidation: "WHEN_REQUIRED" as const,
        requestChecksumCalculation: "WHEN_REQUIRED" as const,
        forcePathStyle: true,
      }
    : {};

const s3 = new S3Client({ retryMode: "standard", maxAttempts: 3, ...s3LocalstackOverrides });
const ddb = createDDBDocumentClient();

const service = composeClassificationService({
  s3,
  ddb,
  logger,
  contentHashTableName: requireEnv("CONTENT_HASH_TABLE_NAME"),
  workspaceConfigTableName: requireEnv("WORKSPACE_CONFIG_TABLE_NAME"),
});

const PORT = Number(process.env.PORT ?? "8091");

// Our pino logger (the Logger port) carries the app logs; fastify's own request
// logging is off to keep a single logging surface.
const app = Fastify({ logger: false });

app.get("/healthz", async (_req, reply) => reply.type("text/plain").send("ok"));

app.post("/classify", async (req, reply) => {
  const body = (req.body ?? {}) as ClassifyRequest;
  if (!body.workspaceId || !body.documentId || !body.s3?.bucket || !body.s3?.key) {
    return reply.code(400).send({
      error: "missing required field(s): workspaceId, documentId, s3.bucket, s3.key",
    });
  }
  const payload: TaskPayload = {
    taskToken: "sync-http", // unused by classify(); the SFN path is the only consumer of a real token
    workspaceId: body.workspaceId,
    documentId: body.documentId,
    s3: { bucket: body.s3.bucket, key: body.s3.key },
    hints: {
      extension: body.hints?.extension ?? null,
      contentType: body.hints?.contentType ?? null,
    },
    context: {
      parentArchiveDepth: body.context?.parentArchiveDepth ?? 0,
      overrideDuplicateCheck: body.context?.overrideDuplicateCheck ?? false,
    },
    // exactOptionalPropertyTypes: include these keys only when present.
    ...(body.pipelineExecutionId !== undefined
      ? { pipelineExecutionId: body.pipelineExecutionId }
      : {}),
    ...(body.correlationId !== undefined ? { correlationId: body.correlationId } : {}),
  };
  try {
    const result = await service.classify(payload);
    if (result.ok) return reply.code(200).send(result.value);
    return reply.code(422).send({ error: result.error });
  } catch (e) {
    logger.error("classify.unexpected", { errorMessage: (e as Error)?.message ?? "unknown" });
    return reply.code(500).send({ error: (e as Error)?.message ?? "unknown error" });
  }
});

app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not found" }));

// host 0.0.0.0 is required: fastify binds 127.0.0.1 by default, which would be
// unreachable from the router container / the host. node:http bound all
// interfaces, so this preserves the previous behaviour.
app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    logger.error("classification-http.listen-failed", { errorMessage: err.message });
    process.exit(1);
  }
  logger.info("classification-http.listening", { port: PORT });
});
