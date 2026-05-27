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

// --- Backend mode -----------------------------------------------------------
// Real-AWS mode is an EXPLICIT opt-in via CLASSIFIER_AWS_MODE=true, set only by
// the dev05 Helm "aws" profile (deploy/helm/classification-ui/values-aws.yaml).
// The default is LocalStack so BOTH local paths stay completely unchanged:
//   • `npm run dev`  → AWS_ENDPOINT_URL unset, falls back to localhost:4566
//   • docker compose → AWS_ENDPOINT_URL=http://localstack:4566
// We deliberately do NOT key this off "AWS_ENDPOINT_URL is unset", because
// `npm run dev` leaves it unset yet still wants LocalStack.
//
// In AWS mode the SDK clients are built with:
//   • NO static credentials → the default provider chain uses the IRSA
//     web-identity token. (The pod must therefore NOT carry AWS_ACCESS_KEY_ID/
//     SECRET, or the chain would pick those up first — the Helm aws profile
//     omits them by gating localstackConfig on localstack.enabled.)
//   • NO endpoint override  → the SDK resolves the regional endpoint.
//   • virtual-hosted S3     → forcePathStyle dropped.
//   • SDK-default checksums  → real S3 is unaffected by the LocalStack quirk.
// Auto-provisioning is also disabled (see ensureResourcesProvisioned).
const AWS_MODE =
  (process.env.CLASSIFIER_AWS_MODE ?? "").trim().toLowerCase() === "true";
const USE_LOCALSTACK = !AWS_MODE;

/** Resolved backend, exported so /api/target + /api/health label accurately. */
export const BACKEND_MODE: "localstack" | "aws" = AWS_MODE ? "aws" : "localstack";

/** Human-readable surface label for the operator-facing info panels. */
export const DISPLAY_ENDPOINT = USE_LOCALSTACK ? ENDPOINT : `aws:${REGION}`;

export const BUCKET = process.env.UI_S3_BUCKET ?? "classification-ui-bucket";
export const CONTENT_HASH_TABLE = process.env.CONTENT_HASH_TABLE_NAME ?? "content-hashes-ui";
export const WORKSPACE_CONFIG_TABLE = process.env.WORKSPACE_CONFIG_TABLE_NAME ?? "workspace-config-ui";
export const CLASSIFICATIONS_TABLE = process.env.CLASSIFICATIONS_TABLE_NAME ?? "classifications-ui";

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

// Low-level client config shared with /api/health so its probe targets the
// exact same surface this module talks to. LocalStack pins endpoint + static
// creds; AWS mode passes only the region and lets the default chain (IRSA)
// resolve credentials and the regional endpoint.
export const awsClientConfig = USE_LOCALSTACK
  ? { region: REGION, endpoint: ENDPOINT, credentials }
  : { region: REGION };

export const s3Client = USE_LOCALSTACK
  ? new S3Client({
      region: REGION,
      endpoint: ENDPOINT,
      credentials,
      forcePathStyle: true,
      // LocalStack-compatibility: AWS SDK v3.730+ verifies CRC32 checksums on
      // GetObject responses, but LocalStack returns checksums that don't match
      // the body for objects written via multipart Upload (lib-storage).
      // WHEN_REQUIRED disables that default validation. Real AWS is unaffected,
      // so the AWS branch keeps the SDK defaults.
      responseChecksumValidation: "WHEN_REQUIRED",
      requestChecksumCalculation: "WHEN_REQUIRED",
    })
  : new S3Client({
      region: REGION,
      retryMode: "standard",
      maxAttempts: 3,
    });

// Client used ONLY to mint presigned GET URLs for the "download original"
// action. The presigned URL's host is part of the SigV4 signature, so it must
// be a host the *browser* can reach:
//   • AWS mode → reuse s3Client; the regional endpoint (bucket.s3.<region>
//     .amazonaws.com) is public, and the IRSA temp creds sign it.
//   • LocalStack → the server talks to `localstack:4566` (in-cluster/compose
//     DNS) which the host browser can't resolve, so sign against a
//     browser-reachable endpoint instead (S3_PUBLIC_ENDPOINT, default the
//     published localhost:4566).
const S3_PUBLIC_ENDPOINT = process.env.S3_PUBLIC_ENDPOINT ?? "http://localhost:4566";
export const presignS3Client = USE_LOCALSTACK
  ? new S3Client({
      region: REGION,
      endpoint: S3_PUBLIC_ENDPOINT,
      credentials,
      forcePathStyle: true,
      responseChecksumValidation: "WHEN_REQUIRED",
      requestChecksumCalculation: "WHEN_REQUIRED",
    })
  : s3Client;

const ddbLowLevel = USE_LOCALSTACK
  ? new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT,
      credentials,
      retryMode: "standard",
      maxAttempts: 3,
    })
  : new DynamoDBClient({
      region: REGION,
      retryMode: "standard",
      maxAttempts: 3,
    });

// removeUndefinedValues: the run-log writer (lib/runs.ts) persists the full
// nested ClassificationOutput; the DDB marshaller throws on any `undefined`
// (unlike JSON), so strip them rather than risk a swallowed write that would
// leave the row — and thus the Recent feed — missing.
export const ddb = DynamoDBDocumentClient.from(ddbLowLevel, {
  marshallOptions: { removeUndefinedValues: true },
});

const sfnClient = USE_LOCALSTACK
  ? new SFNClient({ region: REGION, endpoint: ENDPOINT, credentials })
  : new SFNClient({ region: REGION });
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
  // Auto-provisioning (CreateBucket/CreateTable + default-workspace seed) is a
  // LocalStack-only convenience. Against real AWS the bucket + tables are owned
  // by CDK / created out-of-band, and the pod's IRSA role intentionally lacks
  // s3:CreateBucket / dynamodb:CreateTable — so this is a no-op in AWS mode.
  // (The default workspace row is seeded once at deploy time per the runbook,
  // not on every cold start.)
  if (AWS_MODE) return;
  if (provisioningPromise) return provisioningPromise;
  provisioningPromise = (async () => {
    await Promise.all([
      ensureBucket(),
      ensureContentHashTable(),
      ensureWorkspaceConfigTable(),
      ensureClassificationsTable(),
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

async function ensureClassificationsTable(): Promise<void> {
  if (await tableExists(CLASSIFICATIONS_TABLE)) return;
  try {
    await ddbLowLevel.send(
      new CreateTableCommand({
        TableName: CLASSIFICATIONS_TABLE,
        AttributeDefinitions: [
          { AttributeName: "workspaceId", AttributeType: "S" },
          { AttributeName: "runId", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "workspaceId", KeyType: "HASH" },
          { AttributeName: "runId", KeyType: "RANGE" },
        ],
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
