"use client";

import { useState } from "react";
import { Pill } from "./Pill";

interface ClassifyResponse {
  ok: boolean;
  result?: {
    documentId: string;
    workspaceId: string;
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
    policyVersion: string;
  };
  error?: unknown;
  elapsedMs?: number;
  documentId?: string;
  objectKey?: string;
  inputName?: string;
}

export function ClassifyForm({ onClassified }: { onClassified?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [workspaceId, setWorkspaceId] = useState("wks-ui-001");
  const [extension, setExtension] = useState("");
  const [contentType, setContentType] = useState("");
  const [overrideDup, setOverrideDup] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ClassifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Pick a file first");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append("file", file);
    form.append("workspaceId", workspaceId);
    if (extension) form.append("extension", extension);
    if (contentType) form.append("contentType", contentType);
    form.append("overrideDuplicateCheck", String(overrideDup));

    try {
      const resp = await fetch("/api/classify", { method: "POST", body: form });
      const data = (await resp.json()) as ClassifyResponse;
      setResult(data);
      if (!data.ok) {
        setError(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
      }
      onClassified?.();
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "request failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function convertToPdf() {
    if (!file) return;
    setConverting(true);
    setConvertError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch("/api/convert", { method: "POST", body: form });
      if (!resp.ok) {
        const text = await resp.text();
        setConvertError(`HTTP ${resp.status}: ${text.slice(0, 500)}`);
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/\.[^./\\]+$/, "") + ".pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setConvertError((e as Error)?.message ?? "convert request failed");
    } finally {
      setConverting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border-subtle p-4 bg-slate-900/40">
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-[10.5px] uppercase tracking-[0.1em] text-slate-400 font-semibold">
            File
          </span>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="rounded border border-border-subtle bg-slate-950/40 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-700/60 file:px-3 file:py-1 file:text-slate-200"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.1em] text-slate-400 font-semibold">
            Workspace ID
          </span>
          <input
            type="text"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            placeholder="auto-seeded: wks-ui-001"
            className="rounded border border-border-subtle bg-slate-950/40 px-3 py-2 text-sm tabular-nums placeholder:text-slate-600"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.1em] text-slate-400 font-semibold">
            Extension hint
          </span>
          <input
            type="text"
            value={extension}
            placeholder="docx | pdf | pptx | docm | …"
            onChange={(e) => setExtension(e.target.value)}
            className="rounded border border-border-subtle bg-slate-950/40 px-3 py-2 text-sm placeholder:text-slate-600"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.1em] text-slate-400 font-semibold">
            Content-Type hint
          </span>
          <input
            type="text"
            value={contentType}
            placeholder="application/pdf | application/vnd.openxmlformats-officedocument.* | …"
            onChange={(e) => setContentType(e.target.value)}
            className="rounded border border-border-subtle bg-slate-950/40 px-3 py-2 text-sm placeholder:text-slate-600"
          />
        </label>
        <label className="flex items-center gap-2 mt-2">
          <input
            type="checkbox"
            checked={overrideDup}
            onChange={(e) => setOverrideDup(e.target.checked)}
          />
          <span className="text-sm text-slate-300">overrideDuplicateCheck</span>
        </label>
        <div className="col-span-2 flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting || !file}
            className="rounded bg-sky-600/80 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Classifying…" : "Classify"}
          </button>
          {result?.elapsedMs !== undefined ? (
            <span className="text-xs text-slate-400 tabular-nums">{result.elapsedMs} ms</span>
          ) : null}
        </div>
      </form>

      {error ? (
        <div className="mt-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {result?.ok && result.result ? (
        <div className="mt-4 grid grid-cols-1 gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="info">{result.result.classification.detectionTier}</Pill>
            <Pill tone={result.result.classification.category === "slipsheet" ? "warn" : "ok"}>
              {result.result.classification.category}
            </Pill>
            {result.result.classification.subCategory ? (
              <Pill tone="dim">{result.result.classification.subCategory}</Pill>
            ) : null}
            <Pill tone="dim">{result.result.classification.format}</Pill>
            <Pill tone={result.result.dedup.isDuplicate ? "warn" : "ok"}>
              {result.result.dedup.isDuplicate ? "duplicate" : "new"}
            </Pill>
            <span className="text-xs text-slate-400">
              score {result.result.classification.confidenceScore.toFixed(3)}
            </span>
            {result.result.classification.slipsheetReason ? (
              <Pill tone="warn">{result.result.classification.slipsheetReason}</Pill>
            ) : null}
          </div>

          {result.result.classification.category === "convert" && file ? (
            <div className="mt-2 flex items-center gap-3 rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
              <span className="text-xs text-emerald-300">
                Convertible to PDF via office-convert
              </span>
              <button
                type="button"
                onClick={convertToPdf}
                disabled={converting}
                className="ml-auto rounded bg-emerald-600/80 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {converting ? "Converting…" : "Convert to PDF"}
              </button>
            </div>
          ) : null}

          {convertError ? (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {convertError}
            </div>
          ) : null}

          <pre className="mt-2 max-h-80 overflow-auto rounded bg-slate-950/70 p-3 text-xs text-slate-300">
            {JSON.stringify(result.result, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
