/**
 * Monitor (classic) — the original dark "technical dashboard" from the Next.js
 * UI, ported to the Vite SPA as a standalone route. Same KPIs / detection-tier
 * breakdown / recent-classifications table (pagination, clear, clickable rows →
 * result detail, live convert download) — but wired to the new browser-direct
 * GraphQL client instead of the retired Next.js /api/* routes.
 *
 * Intentionally dropped vs the original (the new SPA covers them elsewhere or the
 * router doesn't expose them through the GraphQL BFF): the inline WorkspaceForm /
 * ClassifyForm (see /workspaces and /document-transfer) and the per-chunk convert
 * progress poll (no convertProgress query on the client yet — the elapsed timer
 * still ticks).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { Link } from 'react-router';
import {
  classificationStats,
  routerHealth,
  backendTarget,
  documentRun,
  documentIdFromObjectKey,
  DEFAULT_WORKSPACE_ID,
  type ClassificationStats,
  type RouterHealth,
  type BackendTarget,
} from '../lib/graphql';
import '../styles/monitor-classic.css';

const PAGE_SIZES = [10, 25, 50] as const;

type Row = ClassificationStats['recent'][number];
type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'dim';
type Status = Tone;

interface ClsResult {
  classification?: {
    format?: string;
    category?: string;
    detectionTier?: string;
    confidenceScore?: number;
  };
  dedup?: { isDuplicate?: boolean; contentHash?: string };
}
const clsOf = (r: Row): ClsResult | null => (r.result as unknown as ClsResult | null) ?? null;

const KpiTile: FC<{ label: string; value: string | number; status?: Status; sub?: string }> = ({
  label,
  value,
  status = 'info',
  sub,
}) => (
  <div className={`kpi-tile ${status}`}>
    <div className="label">{label}</div>
    <div className="value">{value}</div>
    {sub ? <div className="sub">{sub}</div> : null}
  </div>
);

const Pill: FC<{ tone?: Tone; children: React.ReactNode }> = ({ tone = 'info', children }) => (
  <span className={`pill ${tone}`}>{children}</span>
);

function elapsedSince(iso?: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Resolve the documentId for a recent row (key is `ui/<docId>/<file>`). */
const docIdOf = (r: Row): string => documentIdFromObjectKey(r.objectKey) ?? r.id;

/** Conversion cell: —/queued/converting/failed/done(download). */
const ConvertCell: FC<{ row: Row }> = ({ row }) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const status = row.convertStatus ?? null;

  if (status == null) return <span className="muted">—</span>;
  if (status === 'queued' || status === 'converting') {
    return (
      <span style={{ color: status === 'queued' ? '#fbbf24' : '#38bdf8' }}>
        {status === 'queued' ? '⏳' : '⟳'} {status} <span className="muted">· {elapsedSince(row.ts)}</span>
      </span>
    );
  }
  if (status === 'failed') return <span className="err" title="conversion failed">⚠ failed</span>;

  // done → lazy-fetch the presigned converted-PDF URL on click
  const onDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const run = await documentRun(row.workspaceId, docIdOf(row), row.objectKey ?? undefined);
      const url = run?.convertedDownloadUrl;
      if (!url) throw new Error('no convertedDownloadUrl');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="mc-btn dl" onClick={onDownload} disabled={busy}>
      {busy ? '…' : failed ? '(failed)' : '⬇ Download PDF'}
    </button>
  );
};

export const MonitorClassic: FC = () => {
  const WS = DEFAULT_WORKSPACE_ID;
  const [health, setHealth] = useState<RouterHealth | null>(null);
  const [stats, setStats] = useState<ClassificationStats | null>(null);
  const [target, setTarget] = useState<BackendTarget | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const seen = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, s, t] = await Promise.all([routerHealth(), classificationStats(WS), backendTarget()]);
      setHealth(h);
      setStats(s);
      setTarget(t);
      setLastRefreshed(new Date());
    } catch {
      /* swallow — tiles show 'unknown' */
    }
  }, [WS]);

  const recent = useMemo(() => stats?.recent ?? [], [stats]);
  const hasInflight = useMemo(
    () => recent.some((r) => r.convertStatus === 'queued' || r.convertStatus === 'converting'),
    [recent],
  );
  const intervalMs = hasInflight ? 2000 : 4000;
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);

  // jump to page 0 when a new newest-run appears
  useEffect(() => {
    const newest = recent[0]?.id ?? null;
    if (newest && newest !== seen.current) {
      seen.current = newest;
      setPage(0);
    }
  }, [recent]);

  // "Clear view" — hide rows older than a stored timestamp (localStorage, per WS)
  const clearKey = `recent_cleared_since_${WS}`;
  const [clearedSince, setClearedSince] = useState<string | null>(null);
  useEffect(() => {
    setClearedSince(localStorage.getItem(clearKey));
  }, [clearKey]);
  const filtered = useMemo(
    () => (clearedSince ? recent.filter((r) => r.ts > clearedSince) : recent),
    [recent, clearedSince],
  );
  const hidden = recent.length - filtered.length;

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);
  const visible = useMemo(
    () => filtered.slice(page * pageSize, (page + 1) * pageSize),
    [filtered, page, pageSize],
  );
  const selected = useMemo(() => filtered.find((r) => r.id === selectedId) ?? null, [filtered, selectedId]);

  const total = stats?.total ?? 0;
  const errors = stats?.errors ?? 0;
  const successRate = total + errors > 0 ? `${((total / (total + errors)) * 100).toFixed(1)}%` : '—';
  const slipRate = total > 0 ? `${(((stats?.byCategory['slipsheet'] ?? 0) / total) * 100).toFixed(1)}%` : '—';
  const tier = (k: string) => stats?.byTier[k] ?? 0;
  const refreshedLabel = lastRefreshed ? lastRefreshed.toLocaleTimeString(undefined, { hour12: false }) : '—';

  return (
    <div className="monitor-shell">
      <div className="mc-main">
        <div className="mc-topbar">
          <Link to="/workspaces" className="mc-back">‹ Back to Workspaces</Link>
        </div>

        <div className="mc-head">
          <h1>📄 Classification test harness</h1>
          <span className="mc-sub">
            {(() => {
              const ep = health?.endpoint ?? '';
              if (ep.startsWith('aws:')) return `Monitor › dev05 · ${ep.slice(4)}`;
              if (!ep) return 'Monitor';
              return 'Monitor › LocalStack';
            })()}
          </span>
          <span className="mc-live">
            <span className="eq-bars" aria-label="Live"><span /><span /><span /></span>
            LIVE
          </span>
        </div>

        <div className="mc-grid mc-grid-6">
          <KpiTile label="Service" value={health?.ready ? 'OK' : 'DOWN'} status={health?.ready ? 'ok' : 'crit'} sub={health?.endpoint ?? ''} />
          <KpiTile
            label={(health?.endpoint ?? '').startsWith('aws:') ? 'DynamoDB' : 'LocalStack'}
            value={health?.ready ? `${health.latencyMs ?? 0} ms` : 'unknown'}
            status={health?.ready ? 'ok' : 'crit'}
            sub={`${health?.tables?.length ?? 0} tables`}
          />
          <KpiTile label="Total classified" value={total} status="info" />
          <KpiTile label="Errors" value={errors} status={errors > 0 ? 'warn' : 'dim'} />
          <KpiTile label="Success rate" value={successRate} status="ok" />
          <KpiTile label="Slipsheet rate" value={slipRate} status="warn" />
        </div>

        <div className="section-hdr">Detection tier breakdown</div>
        <div className="mc-grid mc-grid-5">
          <KpiTile label="file-type" value={tier('file-type')} status="info" />
          <KpiTile label="ole2-clsid" value={tier('ole2-clsid')} status="info" />
          <KpiTile label="zip-marker" value={tier('zip-marker')} status="info" />
          <KpiTile label="text-heuristic" value={tier('text-heuristic')} status="info" />
          <KpiTile label="extension-fallback" value={tier('extension-fallback')} status="warn" />
        </div>

        <div className="section-hdr">
          Recent classifications
          <span className="right">
            {hidden > 0 ? (
              <button type="button" className="mc-btn" onClick={() => { setClearedSince(null); localStorage.removeItem(clearKey); }}>
                Show all ({hidden} hidden)
              </button>
            ) : (
              <button
                type="button"
                className="mc-btn"
                disabled={recent.length === 0}
                onClick={() => { const now = new Date().toISOString(); setClearedSince(now); localStorage.setItem(clearKey, now); setSelectedId(null); setPage(0); }}
              >
                Clear view
              </button>
            )}
            <span>updated {refreshedLabel}</span>
            <span>· {filtered.length} run{filtered.length === 1 ? '' : 's'}</span>
          </span>
        </div>

        <div className="dash-card">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Time</th><th>File</th><th>Workspace</th><th>Status</th><th>Format</th>
                <th>Tier</th><th>Category</th><th>Score</th><th>Dedup</th><th>Elapsed</th>
                <th>Conversion</th><th>Failure reason</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={12} style={{ textAlign: 'center', color: '#64748b', padding: '24px' }}>No classifications yet</td></tr>
              ) : (
                visible.map((r) => {
                  const c = clsOf(r);
                  return (
                    <tr key={r.id} className={r.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(r.id)}>
                      <td className="muted">{r.ts.slice(11, 19)}</td>
                      <td style={{ color: '#e2e8f0' }}>{r.inputName}</td>
                      <td>{r.workspaceId}</td>
                      <td><Pill tone={r.status === 'ok' ? 'ok' : 'crit'}>{r.status === 'ok' ? 'SUCCESS' : 'FAILED'}</Pill></td>
                      <td>{c?.classification?.format ? <Pill tone="dim">{c.classification.format}</Pill> : <span className="muted">—</span>}</td>
                      <td>{c?.classification?.detectionTier ? <Pill tone="info">{c.classification.detectionTier}</Pill> : <span className="muted">—</span>}</td>
                      <td>{c?.classification?.category ? <Pill tone={c.classification.category === 'slipsheet' ? 'warn' : 'ok'}>{c.classification.category}</Pill> : <span className="muted">—</span>}</td>
                      <td>{typeof c?.classification?.confidenceScore === 'number' ? c.classification.confidenceScore.toFixed(3) : <span className="muted">—</span>}</td>
                      <td>{c?.dedup ? <Pill tone={c.dedup.isDuplicate ? 'warn' : 'ok'}>{c.dedup.isDuplicate ? 'dup' : 'new'}</Pill> : <span className="muted">—</span>}</td>
                      <td>{r.elapsedMs} ms</td>
                      <td onClick={(e) => e.stopPropagation()}><ConvertCell row={r} /></td>
                      <td className="err" title={r.failureReason ?? ''}>{r.failureReason ?? <span className="muted">—</span>}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {filtered.length > pageSize ? (
            <div className="mc-pager">
              <button type="button" className="mc-btn" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ Prev</button>
              <span>Page {page + 1} of {totalPages}</span>
              <button type="button" className="mc-btn" disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Next ›</button>
              <label style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span className="muted">Rows</span>
                <select className="mc-select" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}>
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          ) : null}
        </div>

        {selected ? <ResultDetail row={selected} onClose={() => setSelectedId(null)} /> : null}

        <div className="section-hdr">Target</div>
        <div className="detail-grid">
          <div className="detail-card">
            <h3>Backend</h3>
            <div className="kv"><span className="k">backend</span><span className="v">{target?.backend ?? '—'}</span></div>
            <div className="kv"><span className="k">endpoint</span><span className="v">{target?.endpoint ?? '—'}</span></div>
            <div className="kv"><span className="k">region</span><span className="v">{target?.region ?? '—'}</span></div>
          </div>
          <div className="detail-card">
            <h3>Storage</h3>
            <div className="kv"><span className="k">bucket</span><span className="v">{target?.bucket ?? '—'}</span></div>
            <div className="kv"><span className="k">content-hash table</span><span className="v">{target?.contentHashTable ?? '—'}</span></div>
            <div className="kv"><span className="k">workspace-config table</span><span className="v">{target?.workspaceConfigTable ?? '—'}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Result detail panel — classification metadata + lazy presigned download links. */
const ResultDetail: FC<{ row: Row; onClose: () => void }> = ({ row, onClose }) => {
  const c = clsOf(row);
  const [urls, setUrls] = useState<{ original?: string | null; converted?: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    documentRun(row.workspaceId, docIdOf(row), row.objectKey ?? undefined)
      .then((run) => { if (!cancelled && run) setUrls({ original: run.downloadUrl, converted: run.convertedDownloadUrl }); })
      .catch(() => { /* leave urls null */ });
    return () => { cancelled = true; };
  }, [row]);

  return (
    <>
      <div className="section-hdr">
        Result detail
        <span className="right"><button type="button" className="mc-btn" onClick={onClose}>Close</button></span>
      </div>
      <div className="detail-grid">
        <div className="detail-card">
          <h3>Classification</h3>
          <div className="kv"><span className="k">file</span><span className="v">{row.inputName}</span></div>
          <div className="kv"><span className="k">format</span><span className="v">{c?.classification?.format ?? '—'}</span></div>
          <div className="kv"><span className="k">category</span><span className="v">{c?.classification?.category ?? '—'}</span></div>
          <div className="kv"><span className="k">tier</span><span className="v">{c?.classification?.detectionTier ?? '—'}</span></div>
          <div className="kv"><span className="k">score</span><span className="v">{typeof c?.classification?.confidenceScore === 'number' ? c.classification.confidenceScore.toFixed(3) : '—'}</span></div>
        </div>
        <div className="detail-card">
          <h3>Dedup &amp; run</h3>
          <div className="kv"><span className="k">duplicate</span><span className="v">{c?.dedup ? (c.dedup.isDuplicate ? 'yes' : 'no') : '—'}</span></div>
          <div className="kv"><span className="k">content hash</span><span className="v">{c?.dedup?.contentHash ?? '—'}</span></div>
          <div className="kv"><span className="k">elapsed</span><span className="v">{row.elapsedMs} ms</span></div>
          <div className="kv"><span className="k">object key</span><span className="v">{row.objectKey ?? '—'}</span></div>
          <div className="kv"><span className="k">convert</span><span className="v">{row.convertStatus ?? '—'}</span></div>
        </div>
        <div className="detail-card">
          <h3>Downloads</h3>
          <div className="kv">
            <span className="k">original</span>
            <span className="v">{urls?.original ? <a className="mc-back" href={urls.original} target="_blank" rel="noreferrer">⬇ open</a> : '—'}</span>
          </div>
          <div className="kv">
            <span className="k">converted PDF</span>
            <span className="v">{urls?.converted ? <a className="mc-back" href={urls.converted} target="_blank" rel="noreferrer">⬇ open</a> : '—'}</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default MonitorClassic;
