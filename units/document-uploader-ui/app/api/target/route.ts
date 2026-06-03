import { NextResponse } from "next/server";
import { routerGraphQL } from "@/lib/router-graphql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator-facing "what AWS surface is this pointed at?" — now sourced from the
// router (which owns the AWS access) rather than the UI's old direct-config.
const TARGET_QUERY = `{ backendTarget {
  endpoint region bucket contentHashTable workspaceConfigTable backend
} }`;

export async function GET() {
  const data = await routerGraphQL<{
    backendTarget: {
      endpoint: string;
      region: string;
      bucket: string;
      contentHashTable: string;
      workspaceConfigTable: string;
      backend: string;
    };
  }>(TARGET_QUERY);

  const t = data.backendTarget;
  return NextResponse.json({
    endpoint: t.endpoint,
    region: t.region,
    bucket: t.bucket,
    contentHashTable: t.contentHashTable,
    workspaceConfigTable: t.workspaceConfigTable,
    // Preserve the UI's existing label vocabulary ("real-aws" | "localstack").
    backend: t.backend,
  });
}
