import { S3Client, CreateBucketCommand, PutObjectCommand as S3PutObjectCommand } from "@aws-sdk/client-s3";
import { PutCommand as DDBPutCommand } from "@aws-sdk/lib-dynamodb";

import { getLocalstack } from "../_helpers.js";
import { silentLogger } from "../../../src/ports/Logger.js";
import { createS3Adapter } from "../../../src/adapters/s3/index.js";
import { createNodeCryptoHasher } from "../../../src/adapters/crypto/index.js";
import { createDDBContentHashAdapter } from "../../../src/adapters/dynamo-content-hashes/index.js";
import { createDDBWorkspaceConfigAdapter } from "../../../src/adapters/dynamo-workspace-config/index.js";

import { createTier1FileTypeDetector } from "../../../src/domain/tier1-filetype/index.js";
import {
  createOLE2Parser,
  createTier2OLE2Detector,
} from "../../../src/domain/tier2-ole2/index.js";
import {
  createZIPMarkerParser,
  createTier2ZIPDetector,
} from "../../../src/domain/tier2-zip/index.js";
import { createTier3TextDetector } from "../../../src/domain/tier3-text/index.js";
import { createScorer } from "../../../src/domain/scoring/index.js";
import { createCategoryMapper } from "../../../src/domain/categories/index.js";
import { createSlipsheetDecider } from "../../../src/domain/slipsheet/index.js";

import {
  createClassificationService,
  type ClassificationService,
} from "../../../src/application/index.js";
import type { WorkspaceConfig } from "../../../src/shared/types.js";

const TEST_BUCKET = "classification-test-bucket";

export interface OrchestratorTestSetup {
  service: ClassificationService;
  s3Client: S3Client;
  bucket: string;
  contentHashTable: string;
  workspaceConfigTable: string;
  fixedNow: string;
}

export async function setupOrchestratorTest(opts: { fixedNow?: string } = {}): Promise<OrchestratorTestSetup> {
  const localstack = getLocalstack();
  const { ddb, endpoint } = localstack;
  const fixedNow = opts.fixedNow ?? "2026-05-22T10:00:00.000Z";

  const s3Client = new S3Client({
    region: "us-east-1",
    endpoint,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    forcePathStyle: true,
  });
  // Provision the test bucket (idempotent — ignore "already exists")
  try {
    await s3Client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
  } catch (e) {
    // ignore — bucket may already exist from a prior test
  }

  const s3Adapter = createS3Adapter({ s3: s3Client, logger: silentLogger });

  const service = createClassificationService({
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
      tableName: localstack.contentHashTable,
      logger: silentLogger,
    }),
    workspaceConfigStore: createDDBWorkspaceConfigAdapter({
      ddb,
      tableName: localstack.workspaceConfigTable,
      logger: silentLogger,
    }),
    logger: silentLogger,
    nowProvider: () => fixedNow,
    policyVersionExtractor: (c) => c.policyVersion,
  });

  return {
    service,
    s3Client,
    bucket: TEST_BUCKET,
    contentHashTable: localstack.contentHashTable,
    workspaceConfigTable: localstack.workspaceConfigTable,
    fixedNow,
  };
}

export async function seedWorkspaceConfig(
  config: WorkspaceConfig,
): Promise<void> {
  const { ddb, workspaceConfigTable } = getLocalstack();
  await ddb.send(
    new DDBPutCommand({
      TableName: workspaceConfigTable,
      Item: { ...config },
    }),
  );
}

export async function seedS3Object(
  s3Client: S3Client,
  bucket: string,
  key: string,
  body: Uint8Array,
): Promise<void> {
  await s3Client.send(
    new S3PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
    }),
  );
}

export function defaultWorkspaceConfig(workspaceId: string): WorkspaceConfig {
  return {
    workspaceId,
    policyVersion: "v1",
    threshold: 0.5,
    maxZipDepth: 5,
    quarantineMacros: false,
    slipsheetRules: {},
    hashTtlDays: null,
  };
}
