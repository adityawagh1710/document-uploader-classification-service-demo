import { NextResponse } from "next/server";
import { routerGraphQL } from "@/lib/router-graphql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stuck-job watchdog. The scan + reap now run in the router
 * (reapStuckConverts), which owns DynamoDB. This route keeps the shared-secret
 * gate (so only the intended K8s CronJob caller can fire it) and forwards.
 *
 * STUCK_AFTER_MS / WATCHDOG_MAX_ROWS are now read by the router; this route only
 * authenticates.
 */
const SHARED_SECRET = (process.env.WATCHDOG_SHARED_SECRET ?? "").trim();

const REAP_MUTATION = `mutation{ reapStuckConverts {
  ok scannedCount reapedCount cutoffIso stuckAfterMs durationMs
  reaped { workspaceId runId convertStartedAt }
} }`;

export async function POST(req: Request) {
  if (SHARED_SECRET) {
    const got = req.headers.get("x-watchdog-secret") ?? "";
    if (got !== SHARED_SECRET) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const data = await routerGraphQL<{ reapStuckConverts: unknown }>(REAP_MUTATION);
    return NextResponse.json(data.reapStuckConverts);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "reap_failed", detail: (e as Error)?.message },
      { status: 500 },
    );
  }
}
