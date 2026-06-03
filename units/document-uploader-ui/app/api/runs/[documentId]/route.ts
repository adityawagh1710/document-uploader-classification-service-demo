import { NextResponse } from "next/server";
import { routerGraphQL } from "@/lib/router-graphql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

// Look up what got persisted for a single classification — the content-hash DDB
// row + S3 object metadata + presigned downloads. Now fully router-fronted (the
// UI holds no DynamoDB/S3 client); shape preserved for the Result panel.
const DOCUMENT_RUN_QUERY = `query($w: ID!, $d: ID!, $ch: String, $ok: String, $r: String){
  documentRun(workspaceId: $w, documentId: $d, contentHash: $ch, objectKey: $ok, runId: $r){
    documentId workspaceId ddbRow bucket table downloadUrl convert convertedDownloadUrl
    s3Object { key size contentType etag lastModified }
  }
}`;

export async function GET(req: Request, { params }: RouteContext) {
  const { documentId } = await params;
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId query param required" }, { status: 400 });
  }

  const data = await routerGraphQL<{ documentRun: Record<string, unknown> | null }>(
    DOCUMENT_RUN_QUERY,
    {
      w: workspaceId,
      d: documentId,
      ch: searchParams.get("contentHash"),
      ok: searchParams.get("objectKey"),
      r: searchParams.get("runId"),
    },
  );

  const run = data.documentRun;
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(run);
}
