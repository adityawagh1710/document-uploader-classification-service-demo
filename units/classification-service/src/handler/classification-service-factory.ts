// Shared composition of the ClassificationService — the single place the engine
// is wired from its adapters + domain detectors. Both entrypoints use it:
// the Step Functions Lambda (lambda.ts) and the synchronous HTTP server
// (http-server.ts). Lives in handler/ because it's a composition root (it wires
// AWS adapters + owns the now-provider), not domain code. The caller owns the
// AWS clients so it controls LocalStack endpoint overrides.

import type { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import type { Logger } from "../ports/Logger.js";
import {
  createClassificationService,
  type ClassificationService,
} from "../application/index.js";
import { createS3Adapter } from "../adapters/s3/index.js";
import { createNodeCryptoHasher } from "../adapters/crypto/index.js";
import { createDDBContentHashAdapter } from "../adapters/dynamo-content-hashes/index.js";
import { createDDBWorkspaceConfigAdapter } from "../adapters/dynamo-workspace-config/index.js";
import { createTier1FileTypeDetector } from "../domain/tier1-filetype/index.js";
import { createOLE2Parser, createTier2OLE2Detector } from "../domain/tier2-ole2/index.js";
import { createZIPMarkerParser, createTier2ZIPDetector } from "../domain/tier2-zip/index.js";
import { createTier3TextDetector } from "../domain/tier3-text/index.js";
import { createScorer } from "../domain/scoring/index.js";
import { createCategoryMapper } from "../domain/categories/index.js";
import { createSlipsheetDecider } from "../domain/slipsheet/index.js";

export interface ComposeClassificationDeps {
  readonly s3: S3Client;
  readonly ddb: DynamoDBDocumentClient;
  readonly logger: Logger;
  readonly contentHashTableName: string;
  readonly workspaceConfigTableName: string;
}

export function composeClassificationService(
  deps: ComposeClassificationDeps,
): ClassificationService {
  const s3Adapter = createS3Adapter({ s3: deps.s3, logger: deps.logger });
  return createClassificationService({
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
      ddb: deps.ddb,
      tableName: deps.contentHashTableName,
      logger: deps.logger,
    }),
    workspaceConfigStore: createDDBWorkspaceConfigAdapter({
      ddb: deps.ddb,
      tableName: deps.workspaceConfigTableName,
      logger: deps.logger,
    }),
    logger: deps.logger,
    nowProvider: () => new Date().toISOString(),
    policyVersionExtractor: (config) => config.policyVersion,
  });
}
