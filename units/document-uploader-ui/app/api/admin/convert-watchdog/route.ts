import { NextResponse } from "next/server";
import {
  ScanCommand,
  UpdateCommand,
  type ScanCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { ddb, CLASSIFICATIONS_TABLE } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stuck-job watchdog (feat/07).
 *
 * Scans classifications-dev for rows where convertStatus=converting AND
 * convertStartedAt is older than STUCK_AFTER_MS, and force-flips them to
 * convertStatus=failed with convertError=timeout_watchdog. Triggered by an
 * external scheduler (K8s CronJob — see deploy/k8s/convert-watchdog-cronjob.yaml)
 * curling this route every 5 minutes.
 *
 * Catches the case where the convert-worker (feat/03) was killed mid-call
 * — for example, the SIGTERM grace period elapsed before office-convert
 * finished, or the pod OOMed — leaving the DDB row stuck in `converting`
 * with no SQS message left to redrive. Without the watchdog, the UI's
 * Conversion column would spin "⟳ converting · 2h" forever.
 *
 * Defence-in-depth:
 *   - Optional shared-secret header (WATCHDOG_SHARED_SECRET) so only the
 *     intended caller can fire it. Skipped when the env var is empty,
 *     since LocalStack dev needs zero ceremony.
 *   - MAX_ROWS bounds the per-run blast radius — even if the Scan returns
 *     the world, only the first N rows get touched.
 *   - Returns the list of touched rows in the JSON response, so the
 *     CronJob's pod logs surface what was reaped.
 */
const STUCK_AFTER_MS = Number(process.env.STUCK_AFTER_MS ?? 35 * 60 * 1000); // 35 min
const MAX_ROWS = Number(process.env.WATCHDOG_MAX_ROWS ?? 50);
const SHARED_SECRET = (process.env.WATCHDOG_SHARED_SECRET ?? "").trim();

export async function POST(req: Request) {
  if (SHARED_SECRET) {
    const got = req.headers.get("x-watchdog-secret") ?? "";
    if (got !== SHARED_SECRET) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const cutoffIso = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  const start = Date.now();

  // Scan with a FilterExpression — we don't have a GSI on convertStatus,
  // and at dev05 volume (<10k rows, TTL-bounded to 30 days) a Scan is
  // pragmatic. If volume grows, add a sparse GSI on convertStatus +
  // convertStartedAt and switch to Query.
  let out: ScanCommandOutput;
  try {
    out = await ddb.send(
      new ScanCommand({
        TableName: CLASSIFICATIONS_TABLE,
        FilterExpression:
          "convertStatus = :s AND convertStartedAt < :c",
        ExpressionAttributeValues: {
          ":s": "converting",
          ":c": cutoffIso,
        },
        Limit: 200, // cap the page; we re-bound below by MAX_ROWS
      }),
    );
  } catch (e) {
    return NextResponse.json(
      { error: "scan_failed", detail: (e as Error)?.message },
      { status: 500 },
    );
  }

  const candidates = (out.Items ?? []).slice(0, MAX_ROWS);
  const reaped: Array<{ workspaceId: string; runId: string; convertStartedAt: string }> = [];

  for (const row of candidates) {
    const workspaceId = String(row.workspaceId ?? "");
    const runId = String(row.runId ?? "");
    const startedAt = String(row.convertStartedAt ?? "");
    if (!workspaceId || !runId) continue;
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: CLASSIFICATIONS_TABLE,
          Key: { workspaceId, runId },
          // Re-assert the converting-state guard inside the Update so a
          // racing worker that transitions the row to done/failed between
          // our Scan and Update wins (we don't overwrite their terminal
          // state with our timeout marker).
          UpdateExpression:
            "SET convertStatus = :failed, convertCompletedAt = :now, convertError = :err",
          ConditionExpression: "convertStatus = :converting",
          ExpressionAttributeValues: {
            ":failed": "failed",
            ":converting": "converting",
            ":now": new Date().toISOString(),
            ":err": "timeout_watchdog",
          },
        }),
      );
      reaped.push({ workspaceId, runId, convertStartedAt: startedAt });
    } catch {
      // ConditionalCheckFailedException = worker won the race; skip silently.
    }
  }

  return NextResponse.json({
    ok: true,
    scannedCount: out.Count ?? 0,
    reapedCount: reaped.length,
    cutoffIso,
    stuckAfterMs: STUCK_AFTER_MS,
    durationMs: Date.now() - start,
    reaped,
  });
}
