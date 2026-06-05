import { NextResponse } from "next/server";
import { routerGraphQL } from "@/lib/router-graphql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_WORKSPACE_ID = "wks-ui-001";

// KPI tiles + the Recent feed now come from the router's classificationStats
// query (aggregated from the durable classifications table) instead of the UI's
// old in-process counters + direct DynamoDB read.
const STATS_QUERY = `query($w: ID!){ classificationStats(workspaceId: $w){
  total byTier byCategory byFormat errors
  recent {
    id ts inputName workspaceId elapsedMs status result
    failureReason failureKind objectKey archiveDispatch
    convertStatus convertQueuedAt convertDispatch
  }
} }`;

export async function GET(req: Request) {
  const workspaceId =
    new URL(req.url).searchParams.get("workspaceId") || DEFAULT_WORKSPACE_ID;
  const data = await routerGraphQL<{ classificationStats: unknown }>(STATS_QUERY, {
    w: workspaceId,
  });
  return NextResponse.json(data.classificationStats);
}
