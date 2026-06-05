"use client";

import { useCallback, useEffect, useState } from "react";
import { Pill } from "./Pill";

interface EmailExtraction {
  tenant_id?: string;
  document_id?: string;
  message_id?: string;
  subject?: string | null;
  body_source?: string | null;
  is_html?: boolean;
  body?: string | null;
  body_key?: string | null;
  metadata_key?: string | null;
  attachment_keys?: string[] | null;
  emitted_events?: number;
  nested_emits?: number;
  attachment_failures?: number;
  duplicate_skipped?: boolean;
  depth_limited?: boolean;
  [k: string]: unknown;
}

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
  archiveDispatch: "ok" | "skipped" | "failed";
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
  downloadUrl: string | null;
}

export function ResultPanel({ run }: { run: RecentItem }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailExtraction, setEmailExtraction] = useState<EmailExtraction | null>(null);

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

  // Reset modal state whenever the selected run changes — stale email JSON
  // from a previously-clicked run would otherwise leak into the next popup.
  useEffect(() => {
    setEmailOpen(false);
    setEmailExtraction(null);
    setEmailError(null);
  }, [run.id]);

  const openEmailExtraction = useCallback(async () => {
    setEmailOpen(true);
    if (emailExtraction || emailLoading) return;
    setEmailLoading(true);
    setEmailError(null);
    try {
      const resp = await fetch(
        `/api/runs/${encodeURIComponent(run.id)}/email-extraction`,
      );
      if (resp.status === 404) {
        setEmailError(
          "No cached extraction for this document — the UI container may have restarted since classification, or this row predates the email fan-out wiring.",
        );
        return;
      }
      if (!resp.ok) {
        setEmailError(`extraction api ${resp.status}`);
        return;
      }
      const body = (await resp.json()) as { extraction: EmailExtraction };
      setEmailExtraction(body.extraction);
    } catch (e) {
      setEmailError((e as Error)?.message ?? "fetch failed");
    } finally {
      setEmailLoading(false);
    }
  }, [run.id, emailExtraction, emailLoading]);

  // Close the modal on Escape — standard a11y for overlay dialogs.
  useEffect(() => {
    if (!emailOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEmailOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [emailOpen]);

  const category = run.result?.classification.category ?? null;
  const isEmail = category === "email";

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
        {run.archiveDispatch === "ok" ? (
          <Pill tone="info">→ zip-extraction</Pill>
        ) : run.archiveDispatch === "failed" ? (
          <Pill tone="warn">dispatch failed</Pill>
        ) : null}
        {detail?.downloadUrl ? (
          <a
            href={detail.downloadUrl}
            target="_blank"
            rel="noreferrer"
            data-testid="download-original"
            className="ml-auto rounded border border-emerald-600/40 bg-emerald-500/10 px-2 py-1 text-[10.5px] font-medium text-emerald-300 hover:bg-emerald-500/20"
          >
            ⬇ Download original
          </a>
        ) : null}
        <span
          className={`${detail?.downloadUrl ? "" : "ml-auto "}text-[10.5px] text-slate-500 tabular-nums`}
        >
          {run.elapsedMs} ms
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs font-mono">
        <Field label="document id" value={run.id} />
        <Field label="workspace id" value={run.workspaceId} />
        <Field label="input name" value={run.inputName} />
        <Field label="object key" value={run.objectKey ?? "—"} />
        {run.result ? (
          <>
            <Field label="format" value={run.result.classification.format} />
            <dt className="text-slate-500">category:</dt>
            <dd className="text-slate-300 break-all">
              {isEmail ? (
                <button
                  type="button"
                  onClick={openEmailExtraction}
                  data-testid="open-email-extraction"
                  className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-300 hover:bg-emerald-500/20"
                  title="View email-extraction response"
                >
                  <span>{run.result.classification.category}</span>
                  <span className="text-[10px] opacity-70">▸ view</span>
                </button>
              ) : (
                run.result.classification.category
              )}
            </dd>
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

      {emailOpen ? (
        <EmailExtractionModal
          loading={emailLoading}
          error={emailError}
          extraction={emailExtraction}
          onClose={() => setEmailOpen(false)}
        />
      ) : null}
    </section>
  );
}

function EmailExtractionModal({
  loading,
  error,
  extraction,
  onClose,
}: {
  loading: boolean;
  error: string | null;
  extraction: EmailExtraction | null;
  onClose: () => void;
}) {
  const attachments = extraction?.attachment_keys ?? [];
  const body = extraction?.body ?? "";
  const bodyTruncated = body.length > 4000;
  const bodyShown = bodyTruncated ? `${body.slice(0, 4000)}\n\n… (truncated, ${body.length - 4000} more chars)` : body;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
      data-testid="email-extraction-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[88vh] overflow-auto rounded-lg border border-emerald-500/30 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-baseline gap-3 border-b border-border-subtle bg-slate-900/95 backdrop-blur px-4 py-3">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-emerald-400">
            EMAIL EXTRACTION
          </span>
          <Pill tone="info">App Runner</Pill>
          <button
            type="button"
            onClick={onClose}
            data-testid="close-email-modal"
            className="ml-auto rounded border border-border-subtle px-2 py-1 text-[10.5px] text-slate-400 hover:bg-slate-800/60"
          >
            Close (Esc)
          </button>
        </header>

        <div className="px-4 py-3">
          {loading ? (
            <div className="text-xs text-slate-400">Loading extraction…</div>
          ) : error ? (
            <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          ) : extraction ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs font-mono">
                <Field label="subject" value={extraction.subject ?? "—"} />
                <Field label="body source" value={extraction.body_source ?? "—"} />
                <Field label="is html" value={String(extraction.is_html ?? false)} />
                <Field label="attachments" value={String(attachments.length)} />
                <Field
                  label="emitted events"
                  value={String(extraction.emitted_events ?? 0)}
                />
                <Field
                  label="nested emits"
                  value={String(extraction.nested_emits ?? 0)}
                />
                <Field
                  label="attachment failures"
                  value={String(extraction.attachment_failures ?? 0)}
                />
                <Field
                  label="duplicate skipped"
                  value={String(extraction.duplicate_skipped ?? false)}
                />
                <Field
                  label="depth limited"
                  value={String(extraction.depth_limited ?? false)}
                />
                <Field label="body key" value={extraction.body_key ?? "—"} />
                <Field label="metadata key" value={extraction.metadata_key ?? "—"} />
              </dl>

              {attachments.length > 0 ? (
                <>
                  <div className="section-hdr mt-4 text-[10.5px]">ATTACHMENT KEYS</div>
                  <ul className="list-disc pl-5 text-xs font-mono text-slate-300 space-y-0.5">
                    {attachments.map((k) => (
                      <li key={k} className="break-all">{k}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              {body ? (
                <>
                  <div className="section-hdr mt-4 text-[10.5px]">BODY ({extraction.body_source ?? "plain"})</div>
                  <pre
                    className="rounded bg-slate-950/70 p-3 text-xs text-slate-300 overflow-auto max-h-60 whitespace-pre-wrap break-words"
                    data-testid="email-body"
                  >
                    {bodyShown}
                  </pre>
                </>
              ) : null}

              <details className="mt-4">
                <summary className="cursor-pointer text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400 hover:text-slate-200">
                  Raw JSON
                </summary>
                <pre
                  className="mt-2 rounded bg-slate-950/70 p-3 text-xs text-slate-300 overflow-auto max-h-80"
                  data-testid="email-raw-json"
                >
                  {JSON.stringify(extraction, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <div className="text-xs text-slate-500">No extraction data.</div>
          )}
        </div>
      </div>
    </div>
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
