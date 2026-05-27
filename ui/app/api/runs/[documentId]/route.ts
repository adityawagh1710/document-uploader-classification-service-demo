import { NextResponse } from "next/server";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ddb, s3Client, presignS3Client, CONTENT_HASH_TABLE, BUCKET } from "@/lib/classifier";

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

  return NextResponse.json({
    documentId: params.documentId,
    workspaceId,
    ddbRow,
    s3Object,
    bucket: BUCKET,
    table: CONTENT_HASH_TABLE,
    downloadUrl,
  });
}
