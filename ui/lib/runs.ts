// Per-upload classification run log, persisted to the `classifications`
// DynamoDB table. Unlike lib/stats.ts (in-memory KPI counters, wiped on
// restart), this is the durable feed powering the Recent table: one row per
// upload — success, duplicate, or failure — surviving pod restarts and
// reflecting what's actually in DynamoDB. Scoped per workspace (PK), newest
// first (SK = `<ISO-ts>#<documentId>`).
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, BUCKET, CLASSIFICATIONS_TABLE } from "./classifier";
import type { RecentRecord } from "./stats";

// TTL horizon for the activity log — keeps the sandbox table self-pruning.
const RUN_TTL_DAYS = 30;

// A stored row: the in-memory RecentRecord shape, plus the DynamoDB keys, an
// explicit S3 object reference, and a TTL attribute.
interface RunItem extends RecentRecord {
  runId: string; // SK — `<ts>#<id>`, lexically chronological
  s3Bucket: string;
  s3Key: string | null;
  expiresAt: number; // epoch seconds (DynamoDB TTL)
}

function toRunId(ts: string, id: string): string {
  return `${ts}#${id}`;
}

function computeExpiresAt(ts: string): number {
  const baseMs = Date.parse(ts);
  const ms = Number.isNaN(baseMs) ? Date.now() : baseMs;
  return Math.floor(ms / 1000) + RUN_TTL_DAYS * 24 * 60 * 60;
}

/**
 * Persist one classification run. Best-effort: a failure here must never fail
 * the classification itself (the dedup write already succeeded), so errors are
 * logged and swallowed.
 */
export async function recordRun(record: RecentRecord): Promise<void> {
  const item: RunItem = {
    ...record,
    runId: toRunId(record.ts, record.id),
    s3Bucket: BUCKET,
    s3Key: record.objectKey,
    expiresAt: computeExpiresAt(record.ts),
  };
  try {
    await ddb.send(
      new PutCommand({ TableName: CLASSIFICATIONS_TABLE, Item: item }),
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      "[runs] recordRun failed",
      JSON.stringify({ id: record.id, workspaceId: record.workspaceId, error: (e as Error)?.message }),
    );
  }
}

/**
 * Most-recent runs for a workspace, newest first. Strongly consistent so a row
 * written during a classify is visible to the immediately-following dashboard
 * refresh. Degrades to [] on error so the dashboard still renders.
 */
export async function queryRecentRuns(
  workspaceId: string,
  limit = 100,
): Promise<RecentRecord[]> {
  try {
    const out = await ddb.send(
      new QueryCommand({
        TableName: CLASSIFICATIONS_TABLE,
        KeyConditionExpression: "workspaceId = :w",
        ExpressionAttributeValues: { ":w": workspaceId },
        ScanIndexForward: false, // newest first
        Limit: limit,
        ConsistentRead: true,
      }),
    );
    return (out.Items ?? []).map(toRecentRecord);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      "[runs] queryRecentRuns failed",
      JSON.stringify({ workspaceId, error: (e as Error)?.message }),
    );
    return [];
  }
}

// Strip the DynamoDB-only attributes back to the RecentRecord the dashboard
// expects (objectKey is retained; runId/s3*/expiresAt are dropped).
function toRecentRecord(item: Record<string, unknown>): RecentRecord {
  return {
    id: item.id as string,
    ts: item.ts as string,
    inputName: item.inputName as string,
    workspaceId: item.workspaceId as string,
    elapsedMs: (item.elapsedMs as number) ?? 0,
    status: item.status as RecentRecord["status"],
    result: (item.result as RecentRecord["result"]) ?? null,
    failureReason: (item.failureReason as string | null) ?? null,
    failureKind: (item.failureKind as string | null) ?? null,
    objectKey: (item.objectKey as string | null) ?? null,
    archiveDispatch:
      (item.archiveDispatch as RecentRecord["archiveDispatch"]) ?? "skipped",
  };
}
