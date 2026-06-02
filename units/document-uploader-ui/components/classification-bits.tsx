"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/primitives";

/**
 * Shared classification display helpers used by the Document Transfer wizard
 * and the Documents browse page. All driven by real backend fields.
 */

export interface ClassificationResult {
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
}

export type ConvertStatus = "queued" | "converting" | "done" | "failed" | null;

const CATEGORY_TONE: Record<string, "primary" | "success" | "warn" | "danger" | "info" | "neutral"> = {
  convert: "primary",
  "ocr-direct": "info",
  email: "info",
  archive: "neutral",
  media: "neutral",
  slipsheet: "warn",
};

export function CategoryBadge({ category }: { category: string }) {
  return <Badge tone={CATEGORY_TONE[category] ?? "neutral"}>{category}</Badge>;
}

export function ClassificationSummary({ c, dedup }: { c: ClassificationResult["classification"]; dedup: ClassificationResult["dedup"] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone="neutral">{c.format}</Badge>
      <CategoryBadge category={c.category} />
      {c.subCategory ? <Badge tone="info">{c.subCategory}</Badge> : null}
      <Badge tone="neutral">{c.detectionTier}</Badge>
      <Badge tone={dedup.isDuplicate ? "warn" : "success"}>{dedup.isDuplicate ? "duplicate" : "new"}</Badge>
      <span className="text-xs tabular-nums text-muted-foreground">score {c.confidenceScore.toFixed(3)}</span>
      {c.slipsheetReason ? <Badge tone="warn">{c.slipsheetReason}</Badge> : null}
    </div>
  );
}

/** Compact elapsed since an ISO timestamp ("12s", "1m 23s", "1h 4m"). */
export function elapsedSince(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
}

export interface ConvertInfo {
  id: string;
  ts: string;
  workspaceId: string;
  convertStatus: ConvertStatus;
  convertStartedAt?: string | null;
  convertQueuedAt?: string | null;
  convertError?: string | null;
}

/**
 * Conversion status indicator + lazy presigned-PDF download for the done
 * state. Reads `convertedDownloadUrl` from /api/runs/[id] on click (5-min TTL
 * presign) — the same contract the Monitor dashboard uses.
 */
export function ConvertStatusCell({ item }: { item: ConvertInfo }) {
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const status = item.convertStatus;

  if (status == null) return <span className="text-muted-foreground">—</span>;

  if (status === "queued" || status === "converting") {
    const base = item.convertStartedAt ?? item.convertQueuedAt ?? item.ts;
    return (
      <Badge tone={status === "queued" ? "warn" : "info"}>
        <span className="animate-pulse">{status === "queued" ? "⏳" : "⟳"}</span>
        {status} · {elapsedSince(base)}
      </Badge>
    );
  }

  if (status === "failed") {
    return (
      <Badge tone="danger" title={item.convertError ?? "conversion failed"}>
        ⚠ {item.convertError ?? "failed"}
      </Badge>
    );
  }

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ workspaceId: item.workspaceId, runId: `${item.ts}#${item.id}` });
      const res = await fetch(`/api/runs/${item.id}?${params.toString()}`);
      if (!res.ok) throw new Error(`runs api ${res.status}`);
      const body = (await res.json()) as { convertedDownloadUrl?: string | null };
      if (!body.convertedDownloadUrl) throw new Error("no download url");
      window.open(body.convertedDownloadUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr((e as Error)?.message ?? "download failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={download}
      disabled={downloading}
      className="inline-flex items-center gap-1 rounded-button border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
      title={err ?? "Download converted PDF"}
    >
      <Download className="h-3 w-3" />
      {downloading ? "…" : "PDF"}
    </button>
  );
}
