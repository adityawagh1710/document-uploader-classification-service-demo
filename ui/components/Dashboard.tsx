"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KpiTile } from "./KpiTile";
import { Pill } from "./Pill";
import { ClassifyForm } from "./ClassifyForm";
import { WorkspaceForm } from "./WorkspaceForm";
import { ResultPanel } from "./ResultPanel";
import { LocalStackTarget } from "./LocalStackTarget";

const PAGE_SIZES = [10, 25, 50] as const;

interface Health {
  ready: boolean;
  endpoint: string;
  tables?: string[];
  latencyMs?: number;
  error?: string;
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

interface Stats {
  total: number;
  errors: number;
  byTier: Record<string, number>;
  byCategory: Record<string, number>;
  byFormat: Record<string, number>;
  recent: RecentItem[];
}

export function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const latestSeenId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([
        fetch("/api/health").then((r) => r.json() as Promise<Health>),
        fetch("/api/stats").then((r) => r.json() as Promise<Stats>),
      ]);
      setHealth(h);
      setStats(s);
      setLastRefreshed(new Date());
    } catch {
      // swallow — tile will show 'unknown'
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const newest = stats?.recent[0]?.id ?? null;
    if (newest && newest !== latestSeenId.current) {
      latestSeenId.current = newest;
      setPage(0);
    }
  }, [stats?.recent]);

  const totalRecent = stats?.recent.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRecent / pageSize));
  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  const visibleRecent = useMemo(
    () => (stats?.recent ?? []).slice(page * pageSize, (page + 1) * pageSize),
    [stats?.recent, page, pageSize],
  );

  const selectedRun = useMemo(
    () => stats?.recent.find((r) => r.id === selectedRunId) ?? null,
    [stats?.recent, selectedRunId],
  );

  const tierCount = (k: string) => stats?.byTier[k] ?? 0;
  const successRate =
    stats && stats.total + stats.errors > 0
      ? `${((stats.total / (stats.total + stats.errors)) * 100).toFixed(1)}%`
      : "—";

  const lastRefreshedLabel = lastRefreshed
    ? lastRefreshed.toLocaleTimeString(undefined, { hour12: false })
    : "—";

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-4">
      <header className="flex items-baseline gap-3 mb-4">
        <h1 className="text-lg font-bold text-slate-100">📄 Classification Service · Test UI</h1>
        <span className="text-[11px] text-slate-500">Monitor › Local + dev EKS</span>
        <span className="ml-auto inline-flex items-center gap-2 text-[11px] text-slate-500">
          <span className="eq-bars" aria-label="Live">
            <span></span>
            <span></span>
            <span></span>
          </span>
          LIVE
        </span>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <KpiTile
          label="Service"
          value={health?.ready ? "OK" : "DOWN"}
          status={health?.ready ? "ok" : "crit"}
          sub={health?.endpoint ?? ""}
        />
        <KpiTile
          label="LocalStack"
          value={
            health?.ready
              ? `${health.latencyMs ?? 0} ms`
              : health?.error
                ? "error"
                : "unknown"
          }
          status={health?.ready ? "ok" : "crit"}
          sub={`${health?.tables?.length ?? 0} tables`}
        />
        <KpiTile label="Total classified" value={stats?.total ?? 0} status="info" />
        <KpiTile
          label="Errors"
          value={stats?.errors ?? 0}
          status={(stats?.errors ?? 0) > 0 ? "warn" : "dim"}
        />
        <KpiTile label="Success rate" value={successRate} status="ok" />
        <KpiTile
          label="Slipsheet rate"
          value={
            stats && stats.total > 0
              ? `${(((stats.byCategory["slipsheet"] ?? 0) / stats.total) * 100).toFixed(1)}%`
              : "—"
          }
          status="warn"
        />
      </section>

      <div className="section-hdr">Detection tier breakdown</div>
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiTile label="file-type" value={tierCount("file-type")} status="info" />
        <KpiTile label="ole2-clsid" value={tierCount("ole2-clsid")} status="info" />
        <KpiTile label="zip-marker" value={tierCount("zip-marker")} status="info" />
        <KpiTile label="text-heuristic" value={tierCount("text-heuristic")} status="info" />
        <KpiTile label="extension-fallback" value={tierCount("extension-fallback")} status="warn" />
      </section>

      <div className="section-hdr">Workspace + classification</div>
      <section className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4">
        <WorkspaceForm onSeeded={refresh} />
        <ClassifyForm onClassified={refresh} />
      </section>

      <div className="section-hdr">
        Recent classifications
        <span className="text-slate-500 font-normal normal-case tracking-normal text-[10.5px] ml-2">
          — newest first, max 100
        </span>
        <span className="right">
          <span className="mr-3">updated {lastRefreshedLabel}</span>
          <span>· {totalRecent} run{totalRecent === 1 ? "" : "s"}</span>
          {totalRecent > 0 ? (
            <span className="ml-3 text-slate-600">
              ({page * pageSize + 1}–{Math.min(totalRecent, (page + 1) * pageSize)})
            </span>
          ) : null}
        </span>
      </div>
      <section
        className="rounded-lg border border-border-subtle bg-slate-900/40 overflow-hidden"
        data-testid="recent-table"
      >
        <table className="dash-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>File</th>
              <th>Workspace</th>
              <th>Status</th>
              <th>Format</th>
              <th>Tier</th>
              <th>Category</th>
              <th>Score</th>
              <th>Dedup</th>
              <th>Elapsed</th>
              <th>Failure reason</th>
            </tr>
          </thead>
          <tbody>
            {totalRecent === 0 ? (
              <tr>
                <td colSpan={11} className="text-center text-slate-500 py-6">
                  No classifications yet — upload a file above
                </td>
              </tr>
            ) : (
              visibleRecent.map((r) => {
                const isSelected = r.id === selectedRunId;
                return (
                  <tr
                    key={r.id}
                    data-testid={`row-${r.id}`}
                    onClick={() => setSelectedRunId(r.id)}
                    className={
                      "cursor-pointer transition-colors " +
                      (isSelected ? "bg-sky-500/10 outline outline-1 outline-sky-500/40" : "")
                    }
                  >
                    <td className="text-slate-500">{r.ts.slice(11, 19)}</td>
                    <td className="text-slate-200">{r.inputName}</td>
                    <td>{r.workspaceId}</td>
                    <td>
                      <Pill tone={r.status === "ok" ? "ok" : "crit"}>
                        {r.status === "ok" ? "SUCCESS" : "FAILED"}
                      </Pill>
                    </td>
                    <td>
                      {r.result ? (
                        <Pill tone="dim">{r.result.classification.format}</Pill>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td>
                      {r.result ? (
                        <Pill tone="info">{r.result.classification.detectionTier}</Pill>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td>
                      {r.result ? (
                        <Pill
                          tone={r.result.classification.category === "slipsheet" ? "warn" : "ok"}
                        >
                          {r.result.classification.category}
                        </Pill>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td>
                      {r.result
                        ? r.result.classification.confidenceScore.toFixed(3)
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td>
                      {r.result ? (
                        <Pill tone={r.result.dedup.isDuplicate ? "warn" : "ok"}>
                          {r.result.dedup.isDuplicate ? "dup" : "new"}
                        </Pill>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td>{r.elapsedMs} ms</td>
                    <td className="text-rose-300 max-w-[280px] truncate" title={r.failureReason ?? ""}>
                      {r.failureReason ?? <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {totalRecent > pageSize ? (
          <div
            className="flex items-center gap-3 border-t border-border-subtle bg-slate-950/40 px-3 py-2 text-xs text-slate-400"
            data-testid="pagination"
          >
            <button
              type="button"
              data-testid="page-prev"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded border border-border-subtle px-2 py-1 text-slate-300 hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ‹ Prev
            </button>
            <span data-testid="page-indicator" className="tabular-nums">
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              data-testid="page-next"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="rounded border border-border-subtle px-2 py-1 text-slate-300 hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next ›
            </button>
            <label className="ml-auto flex items-center gap-1.5">
              <span className="text-slate-500 uppercase tracking-[0.06em] text-[10px]">
                Rows
              </span>
              <select
                data-testid="page-size"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                className="rounded border border-border-subtle bg-slate-950/60 px-2 py-1 text-slate-300"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </section>

      {selectedRun ? (
        <>
          <div className="section-hdr">
            Result detail
            <span className="text-slate-500 font-normal normal-case tracking-normal text-[10.5px] ml-2">
              — click any row above to view that run
            </span>
            <span className="right">
              <button
                type="button"
                onClick={() => setSelectedRunId(null)}
                className="rounded border border-border-subtle px-2 py-1 text-[10.5px] text-slate-400 hover:bg-slate-800/60"
              >
                Close
              </button>
            </span>
          </div>
          <ResultPanel run={selectedRun} />
        </>
      ) : null}

      <div className="section-hdr">Target</div>
      <LocalStackTarget />
    </main>
  );
}
