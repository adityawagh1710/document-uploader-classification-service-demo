import { NextResponse } from "next/server";
import { snapshot } from "@/lib/stats";
import { queryRecentRuns } from "@/lib/runs";
import { DEFAULT_WORKSPACE_ID } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KPI tiles come from the in-memory session counters; the Recent feed is now
// durable + DynamoDB-backed (queryRecentRuns), scoped to a workspace (default
// the seeded wks-ui-001; override with ?workspaceId=...).
export async function GET(req: Request) {
  const workspaceId =
    new URL(req.url).searchParams.get("workspaceId") || DEFAULT_WORKSPACE_ID;
  const tiles = snapshot();
  const recent = await queryRecentRuns(workspaceId);
  return NextResponse.json({ ...tiles, recent });
}
