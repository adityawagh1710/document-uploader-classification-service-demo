import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import {
  Badge,
  BadgeWithDot,
  BadgeWithIcon,
  Button,
  EmptyState,
  Table,
} from '@opus2-platform/codex';
import {
  AlertCircle,
  CheckCircle,
  Database01,
  File05,
  Loading01,
  RefreshCw01,
  XCircle,
} from '@opus2-platform/icons';
import { getBreadcrumbsForPath, getRouteMeta } from '../config/navigation';
import { AppTableCard } from '../components/layout/app-table-card';
import { PageFrame } from '../components/layout/page-frame';
import {
  backendTarget,
  classificationStats,
  DEFAULT_WORKSPACE_ID,
  routerHealth,
  type BackendTarget,
  type ClassificationStats,
  type RecentRun,
  type RouterHealth,
} from '../lib/graphql';

const routeMeta = getRouteMeta('/monitor');

const SpinningLoader: FC<{ className?: string }> = ({ className }) => (
  <Loading01 className={`animate-spin ${className ?? ''}`} aria-hidden="true" />
);

function nested(result: unknown, group: string, key: string): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const g = (result as Record<string, unknown>)[group];
  if (g && typeof g === 'object') {
    const v = (g as Record<string, unknown>)[key];
    return v == null ? undefined : String(v);
  }
  return undefined;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function StatTile({ label, value, tone }: { label: string; value: string | number; tone?: 'default' | 'error' | 'success' }) {
  const valueColor =
    tone === 'error' ? 'text-error-primary' : tone === 'success' ? 'text-success-primary' : 'text-primary';
  return (
    <div className="rounded-xl border border-secondary bg-primary p-4 shadow-xs">
      <p className="text-xs font-medium text-tertiary">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}

function BreakdownCard({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-xl border border-secondary bg-primary p-4 shadow-xs">
      <p className="mb-3 text-xs font-semibold text-quaternary uppercase">{title}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-tertiary">No data</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([k, v]) => (
            <Badge key={k} size="sm" color="gray" type="pill-color">
              {k}: <span className="ml-1 font-semibold tabular-nums">{v}</span>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ConvertBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="text-sm text-tertiary">—</span>;
  if (status === 'converting' || status === 'queued') {
    return (
      <Badge size="sm" color="brand" type="pill-color">
        <span className="inline-flex items-center gap-1">
          <SpinningLoader className="size-3" /> {status}
        </span>
      </Badge>
    );
  }
  const color = status === 'done' || status === 'converted' ? 'success' : status === 'failed' ? 'error' : 'gray';
  return (
    <Badge size="sm" color={color} type="pill-color">
      {status}
    </Badge>
  );
}

export function Monitor() {
  const [stats, setStats] = useState<ClassificationStats | null>(null);
  const [health, setHealth] = useState<RouterHealth | null>(null);
  const [target, setTarget] = useState<BackendTarget | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const errored = useRef(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [s, h, t] = await Promise.all([
        classificationStats(DEFAULT_WORKSPACE_ID),
        routerHealth(),
        backendTarget(),
      ]);
      setStats(s);
      setHealth(h);
      setTarget(t);
      setLastRefreshed(new Date());
      errored.current = false;
    } catch {
      errored.current = true;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const recent = stats?.recent ?? [];
  const hasInflightConvert = useMemo(
    () => recent.some((r) => r.convertStatus === 'queued' || r.convertStatus === 'converting'),
    [recent],
  );

  // Adaptive polling: 2s while a convert is in flight, 4s at steady state.
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), hasInflightConvert ? 2000 : 4000);
    return () => clearInterval(t);
  }, [refresh, hasInflightConvert]);

  const total = stats?.total ?? 0;
  const errors = stats?.errors ?? 0;
  const successRate = total > 0 ? Math.round(((total - errors) / total) * 100) : 0;
  const inflight = recent.filter((r) => r.convertStatus === 'queued' || r.convertStatus === 'converting').length;

  return (
    <PageFrame
      title={routeMeta.title}
      description={routeMeta.description}
      breadcrumbs={getBreadcrumbsForPath('/monitor')}
      titleBadge={
        health ? (
          <BadgeWithDot size="sm" color={health.ready ? 'success' : 'error'} type="modern">
            {health.ready ? 'Router ready' : 'Router down'}
          </BadgeWithDot>
        ) : undefined
      }
      actions={
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="hidden text-xs text-tertiary sm:inline">
              Updated {lastRefreshed.toLocaleTimeString('en-GB')}
            </span>
          )}
          <Button size="sm" color="secondary" iconLeading={RefreshCw01} onClick={refresh} isLoading={isRefreshing}>
            Refresh
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Backend target */}
        {target && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-secondary bg-secondary px-4 py-2.5 text-xs text-tertiary">
            <span className="inline-flex items-center gap-1.5 font-medium text-secondary">
              <Database01 className="size-3.5" aria-hidden="true" /> {target.backend}
            </span>
            <span>endpoint: <span className="font-mono text-secondary">{target.endpoint}</span></span>
            <span>region: <span className="font-mono text-secondary">{target.region}</span></span>
            <span>bucket: <span className="font-mono text-secondary">{target.bucket}</span></span>
            {typeof health?.latencyMs === 'number' && <span>ddb: <span className="font-mono text-secondary">{health.latencyMs}ms</span></span>}
          </div>
        )}

        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Total classified" value={total} />
          <StatTile label="Errors" value={errors} tone={errors > 0 ? 'error' : 'default'} />
          <StatTile label="Success rate" value={`${successRate}%`} tone="success" />
          <StatTile label="Converting" value={inflight} />
        </div>

        {/* Breakdowns */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <BreakdownCard title="By detection tier" data={stats?.byTier ?? {}} />
          <BreakdownCard title="By category" data={stats?.byCategory ?? {}} />
          <BreakdownCard title="By format" data={stats?.byFormat ?? {}} />
        </div>

        {/* Recent runs */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-primary">Recent classifications</h3>
          {recent.length > 0 ? (
            <AppTableCard size="sm">
              <Table aria-label="Recent classifications" size="sm">
                <Table.Header>
                  <Table.Head id="document" label="Document" isRowHeader className="min-w-48" />
                  <Table.Head id="classification" label="Classification" className="min-w-44" />
                  <Table.Head id="convert" label="Convert" className="min-w-28" />
                  <Table.Head id="status" label="Status" className="min-w-24" />
                  <Table.Head id="time" label="Time" className="min-w-24" />
                </Table.Header>
                <Table.Body>
                  {recent.map((run: RecentRun) => {
                    const category = nested(run.result, 'classification', 'category');
                    const format = nested(run.result, 'classification', 'format');
                    const tier = nested(run.result, 'classification', 'detectionTier');
                    const ok = run.status === 'ok';
                    return (
                      <Table.Row key={run.id} id={run.id}>
                        <Table.Cell>
                          <p className="truncate text-sm font-medium text-primary">{run.inputName}</p>
                          {run.objectKey && (
                            <p className="truncate font-mono text-xs text-tertiary">{run.objectKey}</p>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {category && <Badge size="sm" color="brand" type="pill-color">{category}</Badge>}
                            {format && <Badge size="sm" color="gray" type="pill-color">{format}</Badge>}
                            {tier && <Badge size="sm" color="gray" type="modern">{tier}</Badge>}
                            {!category && !format && <span className="text-sm text-tertiary">—</span>}
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <ConvertBadge status={run.convertStatus} />
                        </Table.Cell>
                        <Table.Cell>
                          {ok ? (
                            <BadgeWithIcon size="sm" color="success" type="pill-color" iconLeading={CheckCircle}>
                              ok
                            </BadgeWithIcon>
                          ) : (
                            <BadgeWithIcon size="sm" color="error" type="pill-color" iconLeading={XCircle}>
                              failed
                            </BadgeWithIcon>
                          )}
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap text-sm text-tertiary">
                          {formatTime(run.ts)}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table>
            </AppTableCard>
          ) : (
            <EmptyState size="sm">
              <EmptyState.Header pattern="circle">
                <EmptyState.FeaturedIcon icon={errored.current ? AlertCircle : File05} color={errored.current ? 'error' : 'gray'} size="sm" />
              </EmptyState.Header>
              <EmptyState.Content>
                <EmptyState.Title>{errored.current ? 'Router unreachable' : 'No classifications yet'}</EmptyState.Title>
                <EmptyState.Description>
                  {errored.current ? 'Could not reach the router. Retrying…' : 'Classify documents to see activity here.'}
                </EmptyState.Description>
              </EmptyState.Content>
            </EmptyState>
          )}
        </div>
      </div>
    </PageFrame>
  );
}
