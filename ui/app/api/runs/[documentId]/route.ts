import { NextResponse } from "next/server";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { ddb, s3Client, CONTENT_HASH_TABLE, BUCKET } from "@/lib/classifier";

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

  return NextResponse.json({
    documentId: params.documentId,
    workspaceId,
    ddbRow,
    s3Object,
    bucket: BUCKET,
    table: CONTENT_HASH_TABLE,
  });
}
