import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  BadgeWithIcon,
  Button,
  ButtonUtility,
  EmptyState,
  Input,
  Table,
} from '@opus2-platform/codex';
import {
  CheckCircle,
  Download01,
  File06,
  RefreshCw01,
  SearchLg,
  XCircle,
} from '@opus2-platform/icons';
import { getBreadcrumbsForPath, getRouteMeta } from '../config/navigation';
import { appToast } from '../lib/app-toast';
import {
  classificationStats,
  DEFAULT_WORKSPACE_ID,
  documentIdFromObjectKey,
  documentRun,
  type RecentRun,
} from '../lib/graphql';
import { AppTableCard } from '../components/layout/app-table-card';
import { PageFrame } from '../components/layout/page-frame';

const routeMeta = getRouteMeta('/documents');

function nested(result: unknown, group: string, key: string): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const g = (result as Record<string, unknown>)[group];
  if (g && typeof g === 'object') {
    const v = (g as Record<string, unknown>)[key];
    return v == null ? undefined : String(v);
  }
  return undefined;
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ts
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function Documents() {
  const [searchQuery, setSearchQuery] = useState('');
  const [runs, setRuns] = useState<RecentRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const stats = await classificationStats(DEFAULT_WORKSPACE_ID);
      setRuns(stats.recent ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () =>
      runs.filter((r) => r.inputName.toLowerCase().includes(searchQuery.toLowerCase())),
    [runs, searchQuery],
  );

  const handleDownload = async (run: RecentRun) => {
    const documentId = documentIdFromObjectKey(run.objectKey);
    if (!documentId) {
      appToast.error('Cannot download', 'No object key for this document.');
      return;
    }
    setDownloadingKey(run.id);
    try {
      // runId = `${ts}#${documentId}` is what lets the router return the
      // converted-PDF URL (convertedDownloadUrl) for converted documents.
      const runId = `${run.ts}#${documentId}`;
      const dr = await documentRun(DEFAULT_WORKSPACE_ID, documentId, run.objectKey ?? undefined, runId);
      const converted = dr?.convertedDownloadUrl;
      const url = converted ?? dr?.downloadUrl;
      if (!url) {
        appToast.error('Cannot download', 'No download URL available.');
        return;
      }
      window.open(url, '_blank', 'noopener');
      appToast.success(
        converted ? 'Opening converted PDF' : 'Download started',
        run.inputName,
      );
    } catch (err) {
      appToast.error('Download failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setDownloadingKey(null);
    }
  };

  return (
    <PageFrame
      title={routeMeta.title}
      description={routeMeta.description}
      breadcrumbs={getBreadcrumbsForPath('/documents')}
      titleBadge={
        <Badge size="sm" color="gray" type="modern">
          {filtered.length} document{filtered.length !== 1 ? 's' : ''}
        </Badge>
      }
      actions={
        <Button size="sm" color="secondary" iconLeading={RefreshCw01} onClick={load} isLoading={isLoading}>
          Refresh
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          size="sm"
          className="md:max-w-md"
          placeholder="Search by filename..."
          value={searchQuery}
          onChange={setSearchQuery}
          icon={SearchLg}
        />

        {error ? (
          <EmptyState size="sm">
            <EmptyState.Header pattern="circle">
              <EmptyState.FeaturedIcon icon={XCircle} color="error" size="sm" />
            </EmptyState.Header>
            <EmptyState.Content>
              <EmptyState.Title>Couldn&apos;t load documents</EmptyState.Title>
              <EmptyState.Description>{error}</EmptyState.Description>
            </EmptyState.Content>
          </EmptyState>
        ) : filtered.length > 0 ? (
          <AppTableCard size="sm">
            <Table aria-label="Published documents" size="sm">
              <Table.Header>
                <Table.Head id="document" label="Document" isRowHeader className="min-w-48" />
                <Table.Head id="classification" label="Classification" className="min-w-44" />
                <Table.Head id="status" label="Status" className="min-w-28" />
                <Table.Head id="date" label="Date" className="min-w-40" />
                <Table.Head id="actions" label="Actions" className="min-w-20" />
              </Table.Header>

              <Table.Body>
                {filtered.map((run) => {
                  const category = nested(run.result, 'classification', 'category');
                  const format = nested(run.result, 'classification', 'format');
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
                          {category && (
                            <Badge size="sm" color="brand" type="pill-color">
                              {category}
                            </Badge>
                          )}
                          {format && (
                            <Badge size="sm" color="gray" type="pill-color">
                              {format}
                            </Badge>
                          )}
                          {run.convertStatus && (
                            <Badge size="sm" color="gray" type="modern">
                              {run.convertStatus}
                            </Badge>
                          )}
                          {!category && !format && <span className="text-sm text-tertiary">—</span>}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        {ok ? (
                          <BadgeWithIcon size="sm" color="success" type="pill-color" iconLeading={CheckCircle}>
                            Classified
                          </BadgeWithIcon>
                        ) : (
                          <BadgeWithIcon size="sm" color="error" type="pill-color" iconLeading={XCircle}>
                            Failed
                          </BadgeWithIcon>
                        )}
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-sm text-tertiary">
                        {formatTs(run.ts)}
                      </Table.Cell>
                      <Table.Cell>
                        <ButtonUtility
                          size="sm"
                          color="tertiary"
                          icon={Download01}
                          tooltip="Download document"
                          isDisabled={!ok || downloadingKey === run.id}
                          onClick={() => handleDownload(run)}
                        />
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
              <EmptyState.FeaturedIcon icon={File06} color="gray" size="sm" />
            </EmptyState.Header>
            <EmptyState.Content>
              <EmptyState.Title>{isLoading ? 'Loading documents…' : 'No documents found'}</EmptyState.Title>
              <EmptyState.Description>
                {isLoading ? 'Fetching classified documents from the router.' : 'Upload and classify documents to see them here.'}
              </EmptyState.Description>
            </EmptyState.Content>
          </EmptyState>
        )}
      </div>
    </PageFrame>
  );
}
