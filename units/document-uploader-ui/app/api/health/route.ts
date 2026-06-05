import { NextResponse } from "next/server";
import { routerGraphQL } from "@/lib/router-graphql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Readiness now probes the router (which owns DynamoDB connectivity) instead of
// the UI talking to DynamoDB directly. ready:false maps to a 503 so the k8s
// liveness/readiness probes behave as before.
const HEALTH_QUERY = `{ routerHealth { ready endpoint tables latencyMs } }`;

export async function GET() {
  try {
    const data = await routerGraphQL<{
      routerHealth: { ready: boolean; endpoint: string; tables: string[]; latencyMs: number };
    }>(HEALTH_QUERY);
    const h = data.routerHealth;
    if (!h.ready) {
      return NextResponse.json(
        { ready: false, endpoint: h.endpoint, error: "router reports not ready" },
        { status: 503 },
      );
    }
    return NextResponse.json(h);
  } catch (e: unknown) {
    return NextResponse.json(
      { ready: false, error: (e as Error)?.message ?? "router unreachable" },
      { status: 503 },
    );
  }
}
