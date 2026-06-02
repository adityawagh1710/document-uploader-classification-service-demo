import { NextResponse } from "next/server";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, CLASSIFICATIONS_TABLE } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { documentId: string };
}

/**
 * Live conversion progress proxy.
 *
 * Resolves the office-convert request id from the classifications-dev row
 * (worker writes it via UpdateItem when it starts the call — feat/03 +
 * feat/05), then forwards to office-convert's `/v1/jobs/{requestId}/progress`
 * endpoint. Office-convert is reachable in-cluster via Service DNS; we
 * deliberately do NOT round-trip through the public ALB (no CIDR allowlist
 * issues, no extra latency).
 *
 * Returns `{progress: null, ...}` when:
 *   - the row hasn't been touched by the worker yet (queued only)
 *   - office-convert returned non-200 (e.g. requestId expired from its
 *     in-memory cache — heartbeats have a 30-min TTL)
 *   - office-convert is unreachable
 *
 * Polled by the UI's ConvertCell every ~2s while convertStatus=converting.
 */
const OFFICE_CONVERT_BASE_URL =
  process.env.OFFICE_CONVERT_API_URL ??
  "http://office-convert.office-convert-dev.svc.cluster.local";

const FETCH_TIMEOUT_MS = 3_000;

export async function GET(req: Request, { params }: RouteContext) {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const runId = searchParams.get("runId");

  if (!workspaceId || !runId) {
    return NextResponse.json(
      { error: "workspaceId + runId query params required" },
      { status: 400 },
    );
  }

  // 1. Resolve convertRequestId from the DDB row.
  let row: Record<string, unknown> | null = null;
  try {
    const r = await ddb.send(
      new GetCommand({
        TableName: CLASSIFICATIONS_TABLE,
        Key: { workspaceId, runId },
        ConsistentRead: true,
        ProjectionExpression:
          "convertStatus, convertRequestId, convertStartedAt, convertAttempts",
      }),
    );
    row = r.Item ?? null;
  } catch {
    // Swallow — the UI can still show the static fields it already has.
  }

  const convertStatus = (row?.convertStatus as string | undefined) ?? null;
  const requestId = (row?.convertRequestId as string | undefined) ?? null;

  // If the worker hasn't started yet (queued) OR the row is in a terminal
  // state, there's no live progress to fetch — return what we know.
  if (!requestId || convertStatus !== "converting") {
    return NextResponse.json({
      convertStatus,
      requestId,
      progress: null,
      reason: requestId ? "non_converting_status" : "no_request_id_yet",
    });
  }

  // 2. Forward to office-convert. AbortSignal.timeout caps the round-trip
  // so a hung office-convert pod can't block the UI poll.
  const url = `${OFFICE_CONVERT_BASE_URL.replace(/\/$/, "")}/v1/jobs/${encodeURIComponent(requestId)}/progress`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({
        convertStatus,
        requestId,
        progress: null,
        reason: `office_convert_${res.status}`,
      });
    }
    const progress = (await res.json()) as Record<string, unknown>;
    return NextResponse.json({
      convertStatus,
      requestId,
      progress,
      reason: null,
    });
  } catch (e) {
    const errorName = (e as Error)?.name ?? "fetch_failed";
    return NextResponse.json({
      convertStatus,
      requestId,
      progress: null,
      reason: errorName === "TimeoutError" ? "office_convert_timeout" : errorName,
    });
  }
}
