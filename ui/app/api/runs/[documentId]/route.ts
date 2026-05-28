import { NextResponse } from "next/server";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ddb,
  s3Client,
  presignS3Client,
  CONTENT_HASH_TABLE,
  CLASSIFICATIONS_TABLE,
  BUCKET,
} from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { documentId: string };
}

// Look up what got persisted for a single classification — the DDB
// content-hash record + the S3 object metadata. Powers the Result panel
// when an operator clicks a row in the recent classifications table.
export async function GET(req: Request, { params }: RouteContext) {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const contentHash = searchParams.get("contentHash");
  const objectKey = searchParams.get("objectKey");
  // Optional. When supplied, also returns the convert progress columns
  // (worker-mutated state on the classifications-dev row). The UI calls this
  // every few seconds while convertStatus is non-terminal — see feat/06.
  const runId = searchParams.get("runId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId query param required" }, { status: 400 });
  }

  const ddbRow = contentHash
    ? await ddb
        .send(
          new GetCommand({
            TableName: CONTENT_HASH_TABLE,
            Key: { workspaceId, contentHash },
            ConsistentRead: true,
          }),
        )
        .then((r) => r.Item ?? null)
        .catch(() => null)
    : null;

  // Convert progress lives on the classifications-dev row (worker writes
  // there via UpdateItem). ConsistentRead so polling reflects the latest
  // worker state (~3s after it lands in DDB). Strip the bulky `result`
  // blob — the caller already has it from the Recent table.
  const convertRow = runId
    ? await ddb
        .send(
          new GetCommand({
            TableName: CLASSIFICATIONS_TABLE,
            Key: { workspaceId, runId },
            ConsistentRead: true,
            ProjectionExpression:
              "convertStatus, convertStartedAt, convertCompletedAt, " +
              "convertS3Bucket, convertS3Key, convertRequestId, " +
              "convertError, convertAttempts, convertQueuedAt, convertDispatch",
          }),
        )
        .then((r) => r.Item ?? null)
        .catch(() => null)
    : null;

  const s3Object = objectKey
    ? await s3Client
        .send(new HeadObjectCommand({ Bucket: BUCKET, Key: objectKey }))
        .then((r) => ({
          key: objectKey,
          size: r.ContentLength ?? null,
          contentType: r.ContentType ?? null,
          etag: r.ETag ?? null,
          lastModified: r.LastModified?.toISOString() ?? null,
        }))
        .catch(() => null)
    : null;

  // Short-lived presigned GET so the operator can download the original
  // upload straight from S3. Defence-in-depth: only sign keys under the UI's
  // own `ui/` prefix — never an arbitrary caller-supplied key. The presigned
  // host is browser-reachable (regional in AWS mode, S3_PUBLIC_ENDPOINT in
  // LocalStack — see presignS3Client).
  let downloadUrl: string | null = null;
  if (objectKey && objectKey.startsWith("ui/")) {
    const filename = objectKey.split("/").pop() || "download";
    downloadUrl = await getSignedUrl(
      presignS3Client,
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
        // Force a browser download with the original filename (the <a download>
        // attribute is ignored cross-origin, so do it server-side via the
        // signed response-content-disposition).
        ResponseContentDisposition: `attachment; filename="${filename}"`,
      }),
      { expiresIn: 300 },
    ).catch(() => null);
  }

  // Presigned GET for the CONVERTED PDF when the worker has finished.
  // Same defence-in-depth: only sign keys under our own `converted/` prefix.
  // Different filename hint — operator gets `<documentId>.pdf`, not the
  // original source name. Lives at the SAME bucket because office-convert
  // writes there (s3_output set by the worker — see feat/03).
  let convertedDownloadUrl: string | null = null;
  const convertedKey =
    (convertRow?.convertS3Key as string | undefined) ?? null;
  const convertedBucket =
    (convertRow?.convertS3Bucket as string | undefined) ?? null;
  if (
    convertRow?.convertStatus === "done" &&
    convertedKey &&
    convertedKey.startsWith("converted/") &&
    convertedBucket === BUCKET
  ) {
    const pdfFilename = convertedKey.split("/").pop() || "document.pdf";
    convertedDownloadUrl = await getSignedUrl(
      presignS3Client,
      new GetObjectCommand({
        Bucket: convertedBucket,
        Key: convertedKey,
        ResponseContentDisposition: `attachment; filename="${pdfFilename}"`,
        ResponseContentType: "application/pdf",
      }),
      { expiresIn: 300 },
    ).catch(() => null);
  }

  return NextResponse.json({
    documentId: params.documentId,
    workspaceId,
    ddbRow,
    s3Object,
    bucket: BUCKET,
    table: CONTENT_HASH_TABLE,
    downloadUrl,
    // Convert-specific block — null if no runId was supplied.
    convert: convertRow,
    convertedDownloadUrl,
  });
}
