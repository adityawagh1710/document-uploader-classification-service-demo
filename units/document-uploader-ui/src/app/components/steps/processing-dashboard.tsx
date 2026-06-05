import { useMemo, useState, type FC } from 'react';
import {
  Alert,
  Badge,
  BadgeWithIcon,
  Button,
  Dialog,
  EmptyState,
  getReadableFileSize,
  Modal,
  ModalOverlay,
  ProgressBar,
  Table,
} from '@opus2-platform/codex';
import {
  AlertCircle,
  CheckCircle,
  File05,
  Loading01,
  RefreshCw01,
  XCircle,
  XClose,
} from '@opus2-platform/icons';
import { AppTableCard } from '../layout/app-table-card';
import { appToast } from '../../lib/app-toast';
import { classificationStats } from '../../lib/graphql';
import type { RecentRun } from '../../lib/graphql';
import { documentTransferTableColumns } from '../document-transfer-table';
import type { UploadData, UploadedFile } from '../upload-wizard';

interface ProcessingDashboardProps {
  data: UploadData;
}

const SpinningLoader: FC<{ className?: string }> = ({ className }) => (
  <Loading01 className={`animate-spin ${className ?? ''}`} aria-hidden="true" />
);

/** Read a field from the opaque classification result map, tolerating both
 *  camelCase and snake_case keys emitted by the classifier. */
function resultField(result: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!result || typeof result !== 'object') return undefined;
  for (const k of keys) {
    if (result[k] != null) return result[k];
  }
  return undefined;
}

type DocStatus = 'success' | 'failed';

interface DocView {
  id: string;
  filename: string;
  size: number;
  status: DocStatus;
  category?: string;
  format?: string;
  tier?: string;
  confidence?: number;
  isDuplicate?: boolean;
  convertDispatch?: string | null;
  archiveDispatch?: string | null;
  emailDispatch?: string | null;
  error?: string;
  objectKey?: string;
}

function toDocView(u: UploadedFile): DocView {
  const r = u.outcome?.result;
  // Live result shape is nested: { classification: {...}, dedup: {...} }.
  // Fall back to flat keys defensively in case the shape changes.
  const cls = (resultField(r, 'classification') ?? r) as Record<string, unknown> | undefined;
  const dedup = (resultField(r, 'dedup') ?? r) as Record<string, unknown> | undefined;
  const ok = u.outcome?.ok === true && !u.error;
  const confidenceRaw = resultField(cls, 'confidenceScore', 'confidence_score', 'confidence');
  return {
    id: u.id,
    filename: u.file.name,
    size: u.file.size,
    status: ok ? 'success' : 'failed',
    category: resultField(cls, 'category') as string | undefined,
    format: resultField(cls, 'format') as string | undefined,
    tier: resultField(cls, 'detectionTier', 'detection_tier', 'tier') as string | undefined,
    confidence: typeof confidenceRaw === 'number' ? confidenceRaw : undefined,
    isDuplicate: resultField(dedup, 'isDuplicate', 'is_duplicate') as boolean | undefined,
    convertDispatch: u.outcome?.convertDispatch,
    archiveDispatch: u.outcome?.archiveDispatch,
    emailDispatch: u.outcome?.emailDispatch,
    error:
      u.error ??
      (u.outcome && !u.outcome.ok
        ? ((resultField(u.outcome.error, 'reason', 'message') as string | undefined) ??
          'Classification failed')
        : undefined),
    objectKey: u.outcome?.objectKey ?? u.presign?.objectKey,
  };
}

function StatusBadge({ doc, onFailedPress }: { doc: DocView; onFailedPress?: () => void }) {
  if (doc.status === 'success') {
    return (
      <BadgeWithIcon size="sm" color="success" type="pill-color" iconLeading={CheckCircle}>
        Classified
      </BadgeWithIcon>
    );
  }
  return (
    <button
      type="button"
      onClick={onFailedPress}
      className="cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-solid"
    >
      <BadgeWithIcon size="sm" color="error" type="pill-color" iconLeading={XCircle}>
        Failed
      </BadgeWithIcon>
    </button>
  );
}

function DispatchBadge({ label, value }: { label: string; value?: string | null }) {
  if (!value || value === 'skipped') return null;
  const color = value === 'ok' ? 'success' : value === 'failed' ? 'error' : 'gray';
  return (
    <Badge size="sm" color={color} type="pill-color">
      {label}: {value}
    </Badge>
  );
}

export function ProcessingDashboard({ data }: ProcessingDashboardProps) {
  const [errorDocId, setErrorDocId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recent, setRecent] = useState<RecentRun[]>([]);

  const docs = useMemo(
    () => data.uploads.filter((u) => u.outcome || u.error).map(toDocView),
    [data.uploads],
  );

  const successDocs = docs.filter((d) => d.status === 'success').length;
  const totalDocuments = docs.length;
  const completionPercentage =
    totalDocuments > 0 ? Math.round((successDocs / totalDocuments) * 100) : 0;

  const errorDoc = docs.find((d) => d.id === errorDocId);

  // Re-pull workspace stats to reflect async convert/archive completion.
  const refreshStatus = async () => {
    setIsRefreshing(true);
    try {
      const stats = await classificationStats(data.workspaceId);
      setRecent(stats.recent ?? []);
      appToast.info('Status refreshed', `${stats.total} run(s) in this workspace.`);
    } catch (err) {
      appToast.error('Refresh failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const convertStatusFor = (doc: DocView): string | undefined => {
    if (!doc.objectKey) return undefined;
    return recent.find((r) => r.objectKey === doc.objectKey)?.convertStatus ?? undefined;
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          {data.batchId && (
            <p className="text-sm text-tertiary">
              Upload <span className="font-mono text-secondary">{data.batchId}</span>
              {' · '}
              {totalDocuments} document{totalDocuments !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <Button
          size="sm"
          color="secondary"
          iconLeading={RefreshCw01}
          onClick={refreshStatus}
          isLoading={isRefreshing}
        >
          Refresh status
        </Button>
      </div>

      <div>
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <p className="text-sm font-medium text-primary">
            {completionPercentage === 100 ? 'Complete' : 'Classified with errors'}
          </p>
          <p className="text-sm text-tertiary">
            {successDocs} of {totalDocuments} classified
          </p>
        </div>
        <ProgressBar
          value={completionPercentage}
          labelPosition="right"
          valueFormatter={(v) => `${v}%`}
          aria-label="Batch progress"
        />
      </div>

      {docs.length > 0 ? (
        <AppTableCard size="sm">
          <Table aria-label="Documents in batch" size="sm">
            <Table.Header>
              <Table.Head key="name" id="name" label="Document" isRowHeader />
              <Table.Head key="classification" id="classification" label="Classification" />
              <Table.Head
                key="status"
                id="status"
                label="Status"
                className={documentTransferTableColumns.status}
              />
              <Table.Head
                key="size"
                id="size"
                label="Size"
                className={`${documentTransferTableColumns.size} [&_.flex]:justify-end`}
              />
            </Table.Header>
            <Table.Body>
              {docs.map((doc) => {
                const convertStatus = convertStatusFor(doc);
                return (
                  <Table.Row key={doc.id} id={doc.id}>
                    <Table.Cell>
                      <p className="truncate text-sm font-medium text-primary">{doc.filename}</p>
                      {doc.objectKey && (
                        <p className="truncate font-mono text-xs text-tertiary">{doc.objectKey}</p>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {doc.category && (
                          <Badge size="sm" color="brand" type="pill-color">
                            {doc.category}
                          </Badge>
                        )}
                        {doc.format && (
                          <Badge size="sm" color="gray" type="pill-color">
                            {doc.format}
                          </Badge>
                        )}
                        {doc.tier && (
                          <Badge size="sm" color="gray" type="modern">
                            {doc.tier}
                          </Badge>
                        )}
                        {typeof doc.confidence === 'number' && (
                          <span className="text-xs text-tertiary">
                            {Math.round(doc.confidence * (doc.confidence <= 1 ? 100 : 1))}%
                          </span>
                        )}
                        {doc.isDuplicate && (
                          <Badge size="sm" color="warning" type="pill-color">
                            duplicate
                          </Badge>
                        )}
                        <DispatchBadge label="convert" value={doc.convertDispatch} />
                        <DispatchBadge label="archive" value={doc.archiveDispatch} />
                        <DispatchBadge label="email" value={doc.emailDispatch} />
                        {convertStatus && (
                          <Badge
                            size="sm"
                            color={
                              convertStatus === 'converted'
                                ? 'success'
                                : convertStatus === 'failed'
                                  ? 'error'
                                  : 'gray'
                            }
                            type="pill-color"
                          >
                            {convertStatus === 'converting' ? (
                              <span className="inline-flex items-center gap-1">
                                <SpinningLoader className="size-3" /> converting
                              </span>
                            ) : (
                              convertStatus
                            )}
                          </Badge>
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell className={`align-middle ${documentTransferTableColumns.status}`}>
                      <StatusBadge doc={doc} onFailedPress={() => setErrorDocId(doc.id)} />
                    </Table.Cell>
                    <Table.Cell className={`text-sm text-tertiary ${documentTransferTableColumns.size}`}>
                      {getReadableFileSize(doc.size)}
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
            <EmptyState.FeaturedIcon icon={File05} color="gray" size="sm" />
          </EmptyState.Header>
          <EmptyState.Content>
            <EmptyState.Title>No documents yet</EmptyState.Title>
            <EmptyState.Description>
              Documents appear here once classified.
            </EmptyState.Description>
          </EmptyState.Content>
        </EmptyState>
      )}

      <ModalOverlay
        isOpen={!!errorDocId}
        onOpenChange={(open) => !open && setErrorDocId(null)}
        isDismissable
      >
        <Modal className="max-w-sm">
          <Dialog className="w-full outline-hidden">
            <div className="rounded-xl border border-secondary bg-primary p-6 shadow-xl">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="size-5 text-error-primary" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-primary">Classification failed</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setErrorDocId(null)}
                  className="text-tertiary hover:text-secondary"
                  aria-label="Close"
                >
                  <XClose className="size-5" />
                </button>
              </div>

              {errorDoc?.error && <Alert color="error" className="mb-2" title={errorDoc.error} />}
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}
