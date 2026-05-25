"use client";

import { useEffect, useState } from "react";
import { Pill } from "./Pill";

interface RecentItem {
  id: string;
  ts: string;
  inputName: string;
  workspaceId: string;
  elapsedMs: number;
  status: "ok" | "failed";
  failureReason: string | null;
  failureKind: string | null;
  objectKey: string | null;
  result: {
    documentId: string;
    workspaceId: string;
    policyVersion: string;
    classification: {
      format: string;
      category: string;
      subCategory: string | null;
      confidenceScore: number;
      detectionTier: string;
      isForcedSlipsheet: boolean;
      slipsheetReason: string | null;
    };
    dedup: { contentHash: string; isDuplicate: boolean };
  } | null;
}

interface RunDetail {
  documentId: string;
  workspaceId: string;
  ddbRow: Record<string, unknown> | null;
  s3Object: {
    key: string;
    size: number | null;
    contentType: string | null;
    etag: string | null;
    lastModified: string | null;
  } | null;
  bucket: string;
  table: string;
}

export function ResultPanel({ run }: { run: RecentItem }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);

  useEffect(() => {
    setDetail(null);
    const params = new URLSearchParams({ workspaceId: run.workspaceId });
    if (run.result?.dedup.contentHash) params.set("contentHash", run.result.dedup.contentHash);
    if (run.objectKey) params.set("objectKey", run.objectKey);
    fetch(`/api/runs/${encodeURIComponent(run.id)}?${params.toString()}`)
      .then((r) => r.json() as Promise<RunDetail>)
      .then(setDetail)
      .catch(() => undefined);
  }, [run.id, run.workspaceId, run.result?.dedup.contentHash, run.objectKey]);

  return (
    <section
      className="rounded-lg border border-border-subtle bg-slate-900/40 p-4"
      data-testid="result-panel"
    >
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-emerald-400">
          RESULT
        </span>
        <Pill tone={run.status === "ok" ? "ok" : "crit"}>{run.status === "ok" ? "SUCCESS" : "FAILED"}</Pill>
        <span className="ml-auto text-[10.5px] text-slate-500 tabular-nums">{run.elapsedMs} ms</span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs font-mono">
        <Field label="document id" value={run.id} />
        <Field label="workspace id" value={run.workspaceId} />
        <Field label="input name" value={run.inputName} />
        <Field label="object key" value={run.objectKey ?? "—"} />
        {run.result ? (
          <>
            <Field label="format" value={run.result.classification.format} />
            <Field label="category" value={run.result.classification.category} />
            <Field label="sub-category" value={run.result.classification.subCategory ?? "—"} />
            <Field label="detection tier" value={run.result.classification.detectionTier} />
            <Field
              label="confidence score"
              value={run.result.classification.confidenceScore.toFixed(3)}
            />
            <Field
              label="slipsheet reason"
              value={run.result.classification.slipsheetReason ?? "—"}
            />
            <Field label="content hash" value={run.result.dedup.contentHash} />
            <Field label="is duplicate" value={String(run.result.dedup.isDuplicate)} />
            <Field label="policy version" value={run.result.policyVersion} />
          </>
        ) : null}
        {run.failureReason ? (
          <>
            <Field label="failure kind" value={run.failureKind ?? "—"} />
            <Field label="failure reason" value={run.failureReason} />
          </>
        ) : null}
        <Field label="written at" value={run.ts} />
      </dl>

      {detail?.ddbRow ? (
        <>
          <div className="section-hdr mt-4 text-[10.5px]">DYNAMODB ROW ({detail.table})</div>
          <pre
            className="rounded bg-slate-950/70 p-3 text-xs text-slate-300 overflow-auto max-h-60"
            data-testid="ddb-row"
          >
            {JSON.stringify(detail.ddbRow, null, 2)}
          </pre>
        </>
      ) : detail && run.result ? (
        <div className="mt-3 text-xs text-slate-500">
          (no DDB row found — possibly aged out via TTL or never written for failed runs)
        </div>
      ) : null}

      {detail?.s3Object ? (
        <>
          <div className="section-hdr mt-4 text-[10.5px]">S3 OBJECT ({detail.bucket})</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs font-mono">
            <Field label="key" value={detail.s3Object.key} />
            <Field
              label="size"
              value={detail.s3Object.size !== null ? `${detail.s3Object.size} bytes` : "—"}
            />
            <Field label="content type" value={detail.s3Object.contentType ?? "—"} />
            <Field label="etag" value={detail.s3Object.etag ?? "—"} />
            <Field label="last modified" value={detail.s3Object.lastModified ?? "—"} />
          </dl>
        </>
      ) : null}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}:</dt>
      <dd className="text-slate-300 break-all">{value}</dd>
    </>
  );
}
