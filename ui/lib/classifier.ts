// Module-level singleton ClassificationService wired with LocalStack-pointed
// adapters. Mirrors tests/integration/handler/_orchestrator-setup.ts but
// reused across HTTP requests rather than per test. Tables + bucket are
// provisioned lazily on cold start.
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { SFNClient } from "@aws-sdk/client-sfn";
import type { WorkspaceConfig } from "@svc/shared/types";

import { silentLogger } from "@svc/ports/Logger";
import { createS3Adapter } from "@svc/adapters/s3/index";
import { createNodeCryptoHasher } from "@svc/adapters/crypto/index";
import { createDDBContentHashAdapter } from "@svc/adapters/dynamo-content-hashes/index";
import { createDDBWorkspaceConfigAdapter } from "@svc/adapters/dynamo-workspace-config/index";

import { createTier1FileTypeDetector } from "@svc/domain/tier1-filetype/index";
import { createOLE2Parser, createTier2OLE2Detector } from "@svc/domain/tier2-ole2/index";
import { createZIPMarkerParser, createTier2ZIPDetector } from "@svc/domain/tier2-zip/index";
import { createTier3TextDetector } from "@svc/domain/tier3-text/index";
import { createScorer } from "@svc/domain/scoring/index";
import { createCategoryMapper } from "@svc/domain/categories/index";
import { createSlipsheetDecider } from "@svc/domain/slipsheet/index";

import { createClassificationService, type ClassificationService } from "@svc/application/index";

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
const REGION = process.env.AWS_REGION ?? "us-east-1";
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID ?? "test";
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? "test";

export const BUCKET = process.env.UI_S3_BUCKET ?? "classification-ui-bucket";
export const CONTENT_HASH_TABLE = process.env.CONTENT_HASH_TABLE_NAME ?? "content-hashes-ui";
export const WORKSPACE_CONFIG_TABLE = process.env.WORKSPACE_CONFIG_TABLE_NAME ?? "workspace-config-ui";

// Auto-seeded on cold start so the dashboard's classify form works without a
// manual "Seed workspace" step. LocalStack runs with PERSISTENCE=0 so the row
// is wiped on every container restart — re-seeding it during lazy provisioning
// keeps the UI responsive across restarts.
export const DEFAULT_WORKSPACE_ID = "wks-ui-001";

const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  workspaceId: DEFAULT_WORKSPACE_ID,
  policyVersion: "v1",
  threshold: 0.5,
  maxZipDepth: 5,
  quarantineMacros: false,
  slipsheetRules: {},
  hashTtlDays: null,
};

const credentials = { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY };

export const s3Client = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  credentials,
  forcePathStyle: true,
  // LocalStack-compatibility: AWS SDK v3.730+ defaults to verifying CRC32
  // checksums on GetObject responses, but LocalStack's S3 implementation
  // returns checksums that don't match the body when the object was
  // written via multipart Upload (lib-storage). Setting these to
  // WHEN_REQUIRED disables the default validation; real AWS still works.
  responseChecksumValidation: "WHEN_REQUIRED",
  requestChecksumCalculation: "WHEN_REQUIRED",
});

const ddbLowLevel = new DynamoDBClient({
  region: REGION,
  endpoint: ENDPOINT,
  credentials,
  retryMode: "standard",
  maxAttempts: 3,
});

export const ddb = DynamoDBDocumentClient.from(ddbLowLevel);

const sfnClient = new SFNClient({
  region: REGION,
  endpoint: ENDPOINT,
  credentials,
});
void sfnClient; // adapter constructed but never called by this UI

const s3Adapter = createS3Adapter({ s3: s3Client, logger: silentLogger });

let cachedService: ClassificationService | undefined;
let provisioningPromise: Promise<void> | undefined;

export function getClassificationService(): ClassificationService {
  if (cachedService) return cachedService;
  cachedService = createClassificationService({
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
      tableName: CONTENT_HASH_TABLE,
      logger: silentLogger,
    }),
    workspaceConfigStore: createDDBWorkspaceConfigAdapter({
      ddb,
      tableName: WORKSPACE_CONFIG_TABLE,
      logger: silentLogger,
    }),
    logger: silentLogger,
    nowProvider: () => new Date().toISOString(),
    policyVersionExtractor: (c) => c.policyVersion,
  });
  return cachedService;
}

/**
 * Idempotently provision the S3 bucket + DDB tables. Safe to call on every
 * request; cached after first success.
 */
export async function ensureResourcesProvisioned(): Promise<void> {
  if (provisioningPromise) return provisioningPromise;
  provisioningPromise = (async () => {
    await Promise.all([
      ensureBucket(),
      ensureContentHashTable(),
      ensureWorkspaceConfigTable(),
    ]);
    // Seed AFTER the table is confirmed present — `PutCommand` would race
    // with `CreateTable` if run in parallel.
    await ensureDefaultWorkspaceSeeded();
  })();
  try {
    await provisioningPromise;
  } catch (e) {
    // Reset on failure so the next request retries.
    provisioningPromise = undefined;
    throw e;
  }
}

async function ensureBucket(): Promise<void> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch (e: unknown) {
      const name = (e as Error)?.name ?? "";
      if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
        throw e;
      }
    }
  }
}

async function ensureContentHashTable(): Promise<void> {
  if (await tableExists(CONTENT_HASH_TABLE)) return;
  try {
    await ddbLowLevel.send(
      new CreateTableCommand({
        TableName: CONTENT_HASH_TABLE,
        AttributeDefinitions: [
          { AttributeName: "workspaceId", AttributeType: "S" },
          { AttributeName: "contentHash", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "workspaceId", KeyType: "HASH" },
          { AttributeName: "contentHash", KeyType: "RANGE" },
        ],
        BillingMode: "PAY_PER_REQUEST",
      }),
    );
  } catch (e: unknown) {
    if ((e as Error)?.name !== "ResourceInUseException") throw e;
  }
}

async function ensureWorkspaceConfigTable(): Promise<void> {
  if (await tableExists(WORKSPACE_CONFIG_TABLE)) return;
  try {
    await ddbLowLevel.send(
      new CreateTableCommand({
        TableName: WORKSPACE_CONFIG_TABLE,
        AttributeDefinitions: [{ AttributeName: "workspaceId", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "workspaceId", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST",
      }),
    );
  } catch (e: unknown) {
    if ((e as Error)?.name !== "ResourceInUseException") throw e;
  }
}

async function ensureDefaultWorkspaceSeeded(): Promise<void> {
  // Unconditional Put — overwriting an existing row with identical defaults
  // is a no-op observationally. Cheaper than a conditional check + retry.
  await ddb.send(
    new PutCommand({
      TableName: WORKSPACE_CONFIG_TABLE,
      Item: { ...DEFAULT_WORKSPACE_CONFIG },
    }),
  );
}

async function tableExists(name: string): Promise<boolean> {
  try {
    await ddbLowLevel.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (e: unknown) {
    if ((e as Error)?.name === "ResourceNotFoundException") return false;
    throw e;
  }
}
