import { NextResponse } from "next/server";
import { BUCKET, CONTENT_HASH_TABLE, WORKSPACE_CONFIG_TABLE } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator-facing view of "what AWS surface is this UI currently pointed at?"
// — matches the LOCALSTACK TARGET info block in the zip-extraction reference UI.
export async function GET() {
  return NextResponse.json({
    endpoint: process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566",
    region: process.env.AWS_REGION ?? "us-east-1",
    bucket: BUCKET,
    contentHashTable: CONTENT_HASH_TABLE,
    workspaceConfigTable: WORKSPACE_CONFIG_TABLE,
    backend: process.env.AWS_ENDPOINT_URL ? "localstack" : "real-aws",
  });
}
