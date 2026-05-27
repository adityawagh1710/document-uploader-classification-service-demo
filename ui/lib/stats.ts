// In-memory rolling counters powering the dashboard KPI tiles. Wiped on
// process restart — which is fine for a test UI; no persistence is implied.
import type { ClassificationOutput, ClassificationFailure } from "@svc/application/index";

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
}

export interface SuccessInit {
  id: string;
  ts: string;
  inputName: string;
  workspaceId: string;
  elapsedMs: number;
  result: ClassificationOutput;
  objectKey: string;
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
