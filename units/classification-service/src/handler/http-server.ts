// Synchronous classification HTTP endpoint (request/response).
//
// This is the wire surface the wundergraph-router's `classify` resolver calls.
// It wraps the SAME engine the Step Functions Lambda runs (via the shared
// composition) but returns the ClassificationOutput directly instead of
// signalling Step Functions — so the UI gets an answer over the wire without
// embedding the engine in-process. Zero new deps: node:http only.
//
//   POST /classify   { workspaceId, documentId, s3:{bucket,key}, hints?, context? }
//                    -> 200 ClassificationOutput | 422 {error} | 4xx/5xx {error}
//   GET  /healthz    -> 200 "ok"

import http from "node:http";
import { S3Client } from "@aws-sdk/client-s3";

import { createDDBDocumentClient } from "../adapters/shared/dynamo-client.js";
import { createPowertoolsLogger } from "../adapters/powertools/index.js";
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

const logger = createPowertoolsLogger("classification-http", "documentId");

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

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json" });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  void (async () => {
    if (req.method === "GET" && req.url === "/healthz") {
      send(res, 200, "ok");
      return;
    }
    if (req.method === "POST" && req.url === "/classify") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}") as ClassifyRequest;
        if (!body.workspaceId || !body.documentId || !body.s3?.bucket || !body.s3?.key) {
          send(res, 400, { error: "missing required field(s): workspaceId, documentId, s3.bucket, s3.key" });
          return;
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
        const result = await service.classify(payload);
        if (result.ok) {
          send(res, 200, result.value);
        } else {
          send(res, 422, { error: result.error });
        }
      } catch (e) {
        logger.error("classify.unexpected", { errorMessage: (e as Error)?.message ?? "unknown" });
        send(res, 500, { error: (e as Error)?.message ?? "unknown error" });
      }
      return;
    }
    send(res, 404, { error: "not found" });
  })();
});

server.listen(PORT, () => {
  logger.info("classification-http.listening", { port: PORT });
});
