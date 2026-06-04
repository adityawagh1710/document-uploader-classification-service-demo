import { useEffect, useState, type ComponentProps } from 'react';
import { FileIcon } from '@untitledui/file-icons';
import {
  Badge,
  BadgeWithIcon,
  Button,
  ButtonUtility,
  FileUpload,
  getReadableFileSize,
  Input,
  ProgressBarBase,
  Table,
  TextArea,
} from '@opus2-platform/codex';
import { CheckCircle, Edit05, Trash01, UploadCloud02, XCircle } from '@opus2-platform/icons';
import { AppTableCard } from '../layout/app-table-card';
import { appToast } from '../../lib/app-toast';
import { classificationStats, presignUpload, putToPresignedUrl, type RecentRun } from '../../lib/graphql';
import {
  documentTransferFileGridClass,
  documentTransferTableColumns,
} from '../document-transfer-table';
import type { UploadData, UploadedFile } from '../upload-wizard';

interface UploadDocumentsProps {
  data: UploadData;
  updateData: (data: Partial<UploadData>) => void;
  updateUploads: (fn: (prev: UploadedFile[]) => UploadedFile[]) => void;
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ts
    : d.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function runCategory(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const cls = (result as Record<string, unknown>).classification;
  if (cls && typeof cls === 'object') {
    const c = (cls as Record<string, unknown>).category;
    return c == null ? undefined : String(c);
  }
  return undefined;
}

const getFileIconType = (fileName: string): ComponentProps<typeof FileIcon>['type'] => {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'doc') return 'doc';
  if (ext === 'docx') return 'docx';
  if (ext === 'xls') return 'xls';
  if (ext === 'xlsx') return 'xlsx';
  return 'empty';
};

interface UploadFileRowProps {
  name: string;
  size: number;
  progress: number;
  failed?: boolean;
  type: ComponentProps<typeof FileIcon>['type'];
  onDelete: () => void;
}

function UploadFileRow({ name, size, progress, failed, type, onDelete }: UploadFileRowProps) {
  const isComplete = progress === 100 && !failed;

  return (
    <li className="border-t border-secondary px-5 py-2.5">
      <div className={documentTransferFileGridClass}>
        <div className={`flex min-w-0 items-center gap-2 ${documentTransferTableColumns.document}`}>
          <FileIcon type={type} theme="light" className="size-4 shrink-0" aria-hidden="true" />
          <p className="truncate text-sm font-medium text-primary">{name}</p>
        </div>

        <div className={documentTransferTableColumns.status}>
          {isComplete && (
            <BadgeWithIcon size="sm" color="success" type="pill-color" iconLeading={CheckCircle}>
              Done
            </BadgeWithIcon>
          )}
          {!isComplete && !failed && (
            <BadgeWithIcon size="sm" color="brand" type="pill-color" iconLeading={UploadCloud02}>
              Uploading
            </BadgeWithIcon>
          )}
          {failed && (
            <BadgeWithIcon size="sm" color="error" type="pill-color" iconLeading={XCircle}>
              Failed
            </BadgeWithIcon>
          )}
        </div>

        <p className={`text-sm text-tertiary ${documentTransferTableColumns.size}`}>
          {getReadableFileSize(size)}
        </p>

        <ButtonUtility
          size="xs"
          color="tertiary"
          tooltip="Remove"
          icon={Trash01}
          onClick={onDelete}
        />
      </div>

      {!failed && (
        <div className={`mt-1.5 ${documentTransferFileGridClass}`}>
          <div className="col-span-3 flex items-center gap-3">
            <ProgressBarBase
              value={progress}
              className="h-1.5 min-w-0 flex-1"
              aria-label={`Upload progress for ${name}`}
            />
            <span className="shrink-0 text-xs font-medium tabular-nums text-secondary">
              {progress}%
            </span>
          </div>
          <div aria-hidden="true" />
        </div>
      )}
    </li>
  );
}

export function UploadDocuments({ data, updateData, updateUploads }: UploadDocumentsProps) {
  const [showNote, setShowNote] = useState(Boolean(data.clientNote));
  const [isEditingBatchId, setIsEditingBatchId] = useState(false);
  const [recent, setRecent] = useState<RecentRun[]>([]);

  // Previous uploads = the workspace's recent classification runs.
  useEffect(() => {
    classificationStats(data.workspaceId)
      .then((stats) => setRecent(stats.recent ?? []))
      .catch(() => setRecent([]));
  }, [data.workspaceId]);

  const generateBatchId = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `BATCH_${year}${month}${day}_${hours}${minutes}`;
  };

  // Each dropped file is presigned and PUT straight to S3 through the router,
  // with live PUT progress. Classification happens later, on Continue.
  const uploadOne = async (entry: UploadedFile) => {
    try {
      const presigned = await presignUpload(
        data.workspaceId,
        entry.file.name,
        entry.file.type || undefined,
      );
      updateUploads((prev) =>
        prev.map((u) => (u.id === entry.id ? { ...u, presign: presigned } : u)),
      );
      await putToPresignedUrl(presigned.uploadUrl, entry.file, (percent) => {
        updateUploads((prev) =>
          prev.map((u) => (u.id === entry.id ? { ...u, progress: percent } : u)),
        );
      });
      updateUploads((prev) =>
        prev.map((u) =>
          u.id === entry.id ? { ...u, status: 'uploaded', progress: 100 } : u,
        ),
      );
      appToast.success('File uploaded', entry.file.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      updateUploads((prev) =>
        prev.map((u) => (u.id === entry.id ? { ...u, status: 'error', error: message } : u)),
      );
      appToast.error('Upload failed', `${entry.file.name}: ${message}`);
    }
  };

  const addFiles = (newFiles: File[]) => {
    if (!data.batchId && newFiles.length > 0) {
      updateData({ batchId: generateBatchId() });
    }

    const entries: UploadedFile[] = newFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: 'uploading',
    }));

    updateUploads((prev) => [...prev, ...entries]);
    entries.forEach((entry) => void uploadOne(entry));
  };

  const removeFile = (fileId: string) => {
    const removed = data.uploads.find((entry) => entry.id === fileId);
    if (!removed) return;
    updateUploads((prev) => prev.filter((entry) => entry.id !== fileId));
    appToast.success('File removed', `${removed.file.name} was removed from this upload.`);
  };

  const failedCount = data.uploads.filter((f) => f.status === 'error').length;
  const okUploads = data.uploads.filter((f) => f.status !== 'error');
  const totalSize = okUploads.reduce((sum, u) => sum + u.file.size, 0);
  const hasFiles = data.uploads.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="w-full">
        <div className="app-table overflow-hidden rounded-xl border border-secondary bg-primary shadow-xs">
          <FileUpload.DropZone
            hint="PDF, Word, or Excel"
            accept=".pdf,.doc,.docx,.xls,.xlsx"
            allowsMultiple
            className="rounded-none bg-transparent ring-0"
            onDropFiles={(files) => addFiles(Array.from(files))}
          />

          {hasFiles && (
            <>
              <div className="border-t border-secondary px-5 py-2.5">
                <p className="text-xs text-tertiary">
                  {okUploads.length} file{okUploads.length !== 1 ? 's' : ''}
                  {' · '}
                  {getReadableFileSize(totalSize)}
                  {failedCount > 0 && (
                    <span className="text-warning-primary">
                      {' '}
                      · {failedCount} couldn&apos;t be added
                    </span>
                  )}
                </p>
              </div>

              <div className="border-t border-secondary">
                <div
                  className={`table-section-header border-b border-secondary px-5 py-2 ${documentTransferFileGridClass}`}
                  aria-hidden="true"
                >
                  <span className="text-xs font-semibold text-quaternary">Document</span>
                  <span className={`text-xs font-semibold text-quaternary ${documentTransferTableColumns.status}`}>
                    Status
                  </span>
                  <span className={`text-xs font-semibold text-quaternary ${documentTransferTableColumns.size}`}>
                    Size
                  </span>
                  <span className="sr-only">Actions</span>
                </div>

                <ul>
                  {data.uploads.map((upload) => (
                    <UploadFileRow
                      key={upload.id}
                      name={upload.file.name}
                      size={upload.file.size}
                      progress={upload.progress}
                      failed={upload.status === 'error'}
                      type={getFileIconType(upload.file.name)}
                      onDelete={() => removeFile(upload.id)}
                    />
                  ))}
                </ul>
              </div>

              {data.batchId && (
                <div className="flex items-center gap-4 border-t border-secondary px-5 py-2.5">
                  <span className="w-16 shrink-0 text-xs font-medium text-tertiary">Batch ID</span>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {isEditingBatchId ? (
                      <Input
                        size="sm"
                        aria-label="Batch ID"
                        value={data.batchId}
                        onChange={(value) => updateData({ batchId: value })}
                        onBlur={() => setIsEditingBatchId(false)}
                        autoFocus
                        className="max-w-xs"
                      />
                    ) : (
                      <>
                        <span className="truncate font-mono text-sm text-secondary">
                          {data.batchId}
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsEditingBatchId(true)}
                          className="shrink-0 text-tertiary hover:text-secondary"
                          aria-label="Edit batch ID"
                        >
                          <Edit05 className="size-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="border-t border-secondary px-5 py-3">
                {showNote ? (
                  <TextArea
                    size="sm"
                    label="Note"
                    placeholder="Optional message for the team"
                    value={data.clientNote || ''}
                    onChange={(value) => updateData({ clientNote: value })}
                    rows={2}
                    maxLength={500}
                  />
                ) : (
                  <Button size="sm" color="link-gray" onClick={() => setShowNote(true)}>
                    Add a note
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {recent.length > 0 && (
        <div className="border-t border-secondary pt-8">
          <h3 className="mb-4 text-sm font-semibold text-primary">Previous uploads</h3>

          <AppTableCard size="sm">
            <Table aria-label="Previous uploads" size="sm">
              <Table.Header>
                <Table.Head id="date" label="Date/Time" isRowHeader className="min-w-36" />
                <Table.Head id="document" label="Document" className="min-w-52" />
                <Table.Head id="category" label="Category" className="min-w-28" />
                <Table.Head id="status" label="Status" className="min-w-28" />
              </Table.Header>

              <Table.Body>
                {recent.slice(0, 10).map((run) => {
                  const category = runCategory(run.result);
                  const ok = run.status === 'ok';
                  return (
                    <Table.Row key={run.id} id={run.id}>
                      <Table.Cell className="whitespace-nowrap text-sm text-secondary">
                        {formatTs(run.ts)}
                      </Table.Cell>
                      <Table.Cell className="min-w-0">
                        <p className="truncate text-sm font-medium text-primary">{run.inputName}</p>
                      </Table.Cell>
                      <Table.Cell>
                        {category ? (
                          <Badge size="sm" color="brand" type="pill-color">
                            {category}
                          </Badge>
                        ) : (
                          <span className="text-sm text-tertiary">—</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <BadgeWithIcon
                          size="sm"
                          color={ok ? 'success' : 'error'}
                          type="pill-color"
                          iconLeading={ok ? CheckCircle : XCircle}
                        >
                          {ok ? 'Classified' : 'Failed'}
                        </BadgeWithIcon>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          </AppTableCard>
        </div>
      )}
    </div>
  );
}
