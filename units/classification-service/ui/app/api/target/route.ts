import { NextResponse } from "next/server";
import {
  BUCKET,
  CONTENT_HASH_TABLE,
  WORKSPACE_CONFIG_TABLE,
  BACKEND_MODE,
  DISPLAY_ENDPOINT,
} from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator-facing view of "what AWS surface is this UI currently pointed at?"
// — matches the LOCALSTACK TARGET info block in the zip-extraction reference UI.
// Label is driven by the authoritative backend mode (CLASSIFIER_AWS_MODE), so
// it is accurate in npm-dev / compose / dev05-AWS alike.
export async function GET() {
  return NextResponse.json({
    endpoint: DISPLAY_ENDPOINT,
    region: process.env.AWS_REGION ?? "us-east-1",
    bucket: BUCKET,
    contentHashTable: CONTENT_HASH_TABLE,
    workspaceConfigTable: WORKSPACE_CONFIG_TABLE,
    backend: BACKEND_MODE === "aws" ? "real-aws" : "localstack",
  });
}
