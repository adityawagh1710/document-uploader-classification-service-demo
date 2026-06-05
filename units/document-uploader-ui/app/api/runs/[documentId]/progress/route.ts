import { NextResponse } from "next/server";
import { routerGraphQL } from "@/lib/router-graphql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

// Live conversion progress. The router resolves the office-convert requestId off
// the classifications row and forwards to office-convert; the UI just relays the
// router's convertProgress shape (polled by ConvertCell every ~2s).
const PROGRESS_QUERY = `query($w: ID!, $r: String!){
  convertProgress(workspaceId: $w, runId: $r){ convertStatus requestId progress reason }
}`;

export async function GET(req: Request, _ctx: RouteContext) {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const runId = searchParams.get("runId");

  if (!workspaceId || !runId) {
    return NextResponse.json(
      { error: "workspaceId + runId query params required" },
      { status: 400 },
    );
  }

  const data = await routerGraphQL<{ convertProgress: unknown }>(PROGRESS_QUERY, {
    w: workspaceId,
    r: runId,
  });
  return NextResponse.json(data.convertProgress);
}
