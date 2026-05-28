// In-memory rolling counters powering the dashboard KPI tiles. Wiped on
// process restart — which is fine for a test UI; no persistence is implied.
import type { ClassificationOutput, ClassificationFailure } from "@svc/application/index";

export type ArchiveDispatchState = "ok" | "skipped" | "failed";
export type ConvertDispatchState = "ok" | "skipped" | "failed" | "dwg-excluded";
export type ConvertStatus = "queued" | "converting" | "done" | "failed" | null;

export interface RecentRecord {
  readonly id: string;
  readonly ts: string;
  readonly inputName: string;
  readonly workspaceId: string;
  readonly elapsedMs: number;
  readonly status: "ok" | "failed";
  readonly result: ClassificationOutput | null;
  readonly failureReason: string | null;
  readonly failureKind: string | null;
  readonly objectKey: string | null;
  readonly archiveDispatch: ArchiveDispatchState;
  // Convert fan-out state. Populated on rows where category=convert;
  // null on other categories (UI renders the column blank). Worker
  // mutates the DDB row directly (feat/03+04); the in-memory recent[]
  // ring carries the initial state here, NOT the worker's later updates.
  readonly convertStatus: ConvertStatus;
  readonly convertQueuedAt: string | null;
  readonly convertDispatch: ConvertDispatchState;
}

export interface SuccessInit {
  id: string;
  ts: string;
  inputName: string;
  workspaceId: string;
  elapsedMs: number;
  result: ClassificationOutput;
  objectKey: string;
  archiveDispatch: ArchiveDispatchState;
  convertDispatch: ConvertDispatchState;
}

export interface FailureInit {
  id: string;
  ts: string;
  inputName: string;
  workspaceId: string;
  elapsedMs: number;
  failure: ClassificationFailure;
  objectKey: string | null;
}

interface Stats {
  total: number;
  byTier: Record<string, number>;
  byCategory: Record<string, number>;
  byFormat: Record<string, number>;
  errors: number;
  recent: RecentRecord[];
}

// Cap on the in-memory recent-results ring. Set big enough for the dashboard
// to paginate meaningfully without holding unbounded memory. Older entries
// are silently dropped.
const MAX_RECENT = 100;

declare global {
  // eslint-disable-next-line no-var
  var __CLASSIFICATION_STATS__: Stats | undefined;
}

function getStore(): Stats {
  if (!globalThis.__CLASSIFICATION_STATS__) {
    globalThis.__CLASSIFICATION_STATS__ = {
      total: 0,
      byTier: {},
      byCategory: {},
      byFormat: {},
      errors: 0,
      recent: [],
    };
  }
  return globalThis.__CLASSIFICATION_STATS__;
}

export function recordSuccess(init: SuccessInit): RecentRecord {
  const s = getStore();
  s.total += 1;
  s.byTier[init.result.classification.detectionTier] =
    (s.byTier[init.result.classification.detectionTier] ?? 0) + 1;
  s.byCategory[init.result.classification.category] =
    (s.byCategory[init.result.classification.category] ?? 0) + 1;
  s.byFormat[init.result.classification.format] =
    (s.byFormat[init.result.classification.format] ?? 0) + 1;
  // Convert initial state mirrors the dispatch outcome.
  //   - dispatch "ok"             → queued (worker will flip to converting/done/failed)
  //   - dispatch "failed"         → failed (SQS SendMessage threw; nothing will ever process)
  //   - dispatch "dwg-excluded"   → failed (categorically unsupported)
  //   - dispatch "skipped"        → null   (non-convert category OR convert queue disabled)
  // The UI Recent column reads convertStatus directly.
  const isConvert = init.result.classification.category === "convert";
  const convertStatus: ConvertStatus = (() => {
    if (!isConvert) return null;
    if (init.convertDispatch === "ok") return "queued";
    if (init.convertDispatch === "failed") return "failed";
    if (init.convertDispatch === "dwg-excluded") return "failed";
    return null;
  })();
  const record: RecentRecord = {
    id: init.id,
    ts: init.ts,
    inputName: init.inputName,
    workspaceId: init.workspaceId,
    elapsedMs: init.elapsedMs,
    status: "ok",
    result: init.result,
    failureReason: null,
    failureKind: null,
    objectKey: init.objectKey,
    archiveDispatch: init.archiveDispatch,
    convertStatus,
    convertQueuedAt: convertStatus === "queued" ? init.ts : null,
    convertDispatch: init.convertDispatch,
  };
  s.recent.unshift(record);
  s.recent.splice(MAX_RECENT);
  return record;
}

export function recordFailure(init: FailureInit): RecentRecord {
  const s = getStore();
  s.errors += 1;
  const reason = formatFailureReason(init.failure);
  const record: RecentRecord = {
    id: init.id,
    ts: init.ts,
    inputName: init.inputName,
    workspaceId: init.workspaceId,
    elapsedMs: init.elapsedMs,
    status: "failed",
    result: null,
    failureReason: reason,
    failureKind: init.failure.kind,
    objectKey: init.objectKey,
    archiveDispatch: "skipped",
    convertStatus: null,
    convertQueuedAt: null,
    convertDispatch: "skipped",
  };
  s.recent.unshift(record);
  s.recent.splice(MAX_RECENT);
  return record;
}

function formatFailureReason(f: ClassificationFailure): string {
  switch (f.kind) {
    case "input-validation":
      return `validation: ${f.field} — ${f.message}`;
    case "s3":
      return `s3: ${f.reason}`;
    case "store":
      return `store: ${f.reason}`;
    case "signal":
      return `signal: ${f.reason}`;
    case "unexpected":
      return `unexpected: ${f.message}`;
  }
}

export function snapshot(): Stats {
  const s = getStore();
  return {
    total: s.total,
    errors: s.errors,
    byTier: { ...s.byTier },
    byCategory: { ...s.byCategory },
    byFormat: { ...s.byFormat },
    recent: [...s.recent],
  };
}
