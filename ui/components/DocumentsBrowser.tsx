"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Download, FileText, Inbox, Info } from "lucide-react";
import { Card, CardBody, Badge, Input, Select } from "@/components/ui/primitives";
import {
  CategoryBadge,
  ConvertStatusCell,
  type ConvertStatus,
} from "@/components/classification-bits";
import { EmailExtractionModal } from "@/components/EmailExtractionModal";

/**
 * Documents — browse everything that has been classified, from the live
 * classifications table (GET /api/stats → recent[]). Each row offers the
 * presigned original download (/api/runs/[id]) and live conversion status.
 * Search / category-filter / sort are client-side over the recent window.
 */

interface RecentItem {
  id: string;
  ts: string;
  inputName: string;
  workspaceId: string;
  status: "ok" | "failed";
  failureReason: string | null;
  objectKey: string | null;
  convertStatus: ConvertStatus;
  convertStartedAt?: string | null;
  convertQueuedAt?: string | null;
  convertError?: string | null;
  result: {
    classification: {
      format: string;
      category: string;
      subCategory: string | null;
      confidenceScore: number;
      detectionTier: string;
    };
    dedup: { contentHash: string; isDuplicate: boolean };
  } | null;
}

type SortKey = "time" | "name" | "format" | "category";

export function DocumentsBrowser() {
  const [items, setItems] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("time");
  const [emailModal, setEmailModal] = useState<{ documentId: string; fileName: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { recent: RecentItem[] };
      setItems(body.recent ?? []);
    } catch {
      /* swallow */
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh periodically so conversion status stays live without a manual reload.
  const inflight = useMemo(
    () => items.some((r) => r.convertStatus === "queued" || r.convertStatus === "converting"),
    [items],
  );
  useEffect(() => {
    void load();
    const t = setInterval(load, inflight ? 2500 : 6000);
    return () => clearInterval(t);
  }, [load, inflight]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of items) if (r.result) set.add(r.result.classification.category);
    return ["all", ...Array.from(set).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items.filter((r) => {
      if (category !== "all" && r.result?.classification.category !== category) return false;
      if (!q) return true;
      return (
        r.inputName.toLowerCase().includes(q) ||
        r.workspaceId.toLowerCase().includes(q) ||
        (r.result?.classification.format.toLowerCase().includes(q) ?? false)
      );
    });
    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.inputName.localeCompare(b.inputName);
        case "format":
          return (a.result?.classification.format ?? "").localeCompare(b.result?.classification.format ?? "");
        case "category":
          return (a.result?.classification.category ?? "").localeCompare(b.result?.classification.category ?? "");
        case "time":
        default:
          return b.ts.localeCompare(a.ts);
      }
    });
    return list;
  }, [items, search, category, sortBy]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-normal text-foreground">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything classified across workspaces — newest first, from the live classifications table.
          </p>
        </div>
        <Link
          href="/document-transfer"
          className="rounded-button bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90"
        >
          + Transfer documents
        </Link>
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, format, workspace…"
            className="pl-8"
          />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-44">
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === "all" ? "All categories" : c}
            </option>
          ))}
        </Select>
        <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} className="w-40">
          <option value="time">Sort: newest</option>
          <option value="name">Sort: name</option>
          <option value="format">Sort: format</option>
          <option value="category">Sort: category</option>
        </Select>
      </div>

      <Card>
        <CardBody className="p-0">
          {loading ? (
            <p className="p-5 text-sm text-muted-foreground">Loading documents…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {items.length === 0 ? "No documents classified yet." : "No documents match your filters."}
              </p>
              <Link href="/document-transfer" className="text-sm font-bold text-primary hover:underline">
                Transfer documents →
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-bold">Time</th>
                  <th className="px-3 py-2 font-bold">File</th>
                  <th className="px-3 py-2 font-bold">Workspace</th>
                  <th className="px-3 py-2 font-bold">Format</th>
                  <th className="px-3 py-2 font-bold">Category</th>
                  <th className="px-3 py-2 font-bold">Score</th>
                  <th className="px-3 py-2 font-bold">Dedup</th>
                  <th className="px-3 py-2 font-bold">Conversion</th>
                  <th className="px-3 py-2 font-bold">Original</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.ts.slice(11, 19)}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 text-foreground">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {r.inputName}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.workspaceId}</td>
                    <td className="px-3 py-2">
                      {r.result ? <Badge tone="neutral">{r.result.classification.format}</Badge> : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.result ? (
                        <span className="inline-flex items-center gap-1.5">
                          <CategoryBadge category={r.result.classification.category} />
                          {r.result.classification.category === "email" ? (
                            <button
                              type="button"
                              onClick={() => setEmailModal({ documentId: r.id, fileName: r.inputName })}
                              className="inline-flex items-center text-primary hover:text-primary/70"
                              title="View email-extraction result"
                              aria-label="View email-extraction result"
                              data-testid={`email-info-${r.id}`}
                            >
                              <Info className="h-4 w-4" />
                            </button>
                          ) : null}
                        </span>
                      ) : r.status === "failed" ? (
                        <Badge tone="danger">failed</Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.result ? r.result.classification.confidenceScore.toFixed(3) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.result ? (
                        <Badge tone={r.result.dedup.isDuplicate ? "warn" : "success"}>
                          {r.result.dedup.isDuplicate ? "dup" : "new"}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ConvertStatusCell
                        item={{
                          id: r.id,
                          ts: r.ts,
                          workspaceId: r.workspaceId,
                          convertStatus: r.convertStatus,
                          convertStartedAt: r.convertStartedAt,
                          convertQueuedAt: r.convertQueuedAt,
                          convertError: r.convertError,
                        }}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <OriginalDownload item={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      <p className="text-xs text-muted-foreground">
        Showing the most recent {items.length} classifications (server window). Older rows age out via the
        30-day TTL on the classifications table.
      </p>

      {emailModal ? (
        <EmailExtractionModal
          documentId={emailModal.documentId}
          fileName={emailModal.fileName}
          onClose={() => setEmailModal(null)}
        />
      ) : null}
    </div>
  );
}

function OriginalDownload({ item }: { item: RecentItem }) {
  const [busy, setBusy] = useState(false);
  if (!item.objectKey) return <span className="text-muted-foreground">—</span>;

  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({
        workspaceId: item.workspaceId,
        objectKey: item.objectKey ?? "",
        runId: `${item.ts}#${item.id}`,
      });
      const res = await fetch(`/api/runs/${item.id}?${params.toString()}`);
      if (!res.ok) throw new Error(`runs api ${res.status}`);
      const body = (await res.json()) as { downloadUrl?: string | null };
      if (body.downloadUrl) window.open(body.downloadUrl, "_blank", "noopener,noreferrer");
    } catch {
      /* swallow — non-critical */
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-button border border-border px-2 py-0.5 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-50"
      title="Download original file"
    >
      <Download className="h-3 w-3" />
      {busy ? "…" : "Get"}
    </button>
  );
}
