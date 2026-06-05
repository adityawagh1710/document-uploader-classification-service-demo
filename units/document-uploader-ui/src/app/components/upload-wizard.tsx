import { useMemo, useState } from 'react';
import { Button, ProgressSteps } from '@opus2-platform/codex';
import type { ProgressStepItem } from '@opus2-platform/codex';
import { ArrowLeft, ArrowRight } from '@opus2-platform/icons';
import { getBreadcrumbsForPath, getRouteMeta, getSelectedWorkspaceName } from '../config/navigation';
import { appToast } from '../lib/app-toast';
import { classifyUploaded, DEFAULT_WORKSPACE_ID } from '../lib/graphql';
import type { ClassifyOutcome, PresignUploadResult } from '../lib/graphql';
import { PageFrame, dashboardContentWidthClassName } from './layout/page-frame';
import { UploadDocuments } from './steps/upload-documents';
import { ProcessingDashboard } from './steps/processing-dashboard';

export type DestinationType = 'shared' | 'private';
export type MetadataMode = 'load-file' | 'index' | 'ai-suggested' | 'manual';
export type SubmissionMode = 'full' | 'insert' | 'replace';

/** A file the user added: uploaded straight to S3 via a presigned PUT, then
 *  classified through the router. `outcome` is populated on Continue. */
export interface UploadedFile {
  id: string;
  file: File;
  progress: number;
  status: 'uploading' | 'uploaded' | 'error';
  presign?: PresignUploadResult;
  outcome?: ClassifyOutcome;
  error?: string;
}

export interface UploadData {
  workspaceId: string;
  uploads: UploadedFile[];
  destination: DestinationType | null;
  ocr: boolean;
  conversion: boolean;
  metadataMode: MetadataMode | null;
  submissionType: SubmissionMode | null;
  clientNote?: string;
  batchId?: string;
}

const steps = [
  { id: 1, label: 'Upload' },
  { id: 2, label: 'Processing' },
] as const;

export function UploadWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isClassifying, setIsClassifying] = useState(false);
  const [uploadData, setUploadData] = useState<UploadData>({
    workspaceId: DEFAULT_WORKSPACE_ID,
    uploads: [],
    destination: 'private',
    ocr: true,
    conversion: true,
    metadataMode: null,
    submissionType: null,
  });

  const routeMeta = getRouteMeta('/document-transfer');
  const workspaceName = getSelectedWorkspaceName();

  const updateData = (data: Partial<UploadData>) => {
    setUploadData((prev) => ({ ...prev, ...data }));
  };

  // Functional updater for the uploads list — safe under concurrent per-file
  // PUT-progress callbacks (each file uploads independently).
  const updateUploads = (fn: (prev: UploadedFile[]) => UploadedFile[]) => {
    setUploadData((prev) => ({ ...prev, uploads: fn(prev.uploads) }));
  };

  const readyUploads = uploadData.uploads.filter((u) => u.status === 'uploaded');
  const isUploading = uploadData.uploads.some((u) => u.status === 'uploading');
  const canProceed = currentStep === 1 && readyUploads.length > 0 && !isUploading;

  const pageDescription = useMemo(() => {
    if (workspaceName) return workspaceName;
    return routeMeta.description;
  }, [workspaceName, routeMeta.description]);

  const stepItems = useMemo<ProgressStepItem[]>(
    () =>
      steps.map((step) => ({
        id: step.id,
        label: step.label,
        status:
          currentStep > step.id ? 'complete' : currentStep === step.id ? 'current' : 'upcoming',
      })),
    [currentStep],
  );

  // Continue → classify every uploaded file through the router, then advance.
  const handleContinue = async () => {
    setIsClassifying(true);
    try {
      const classified = await Promise.all(
        uploadData.uploads.map(async (u) => {
          if (u.status !== 'uploaded' || !u.presign || u.outcome) return u;
          try {
            const ext = u.file.name.includes('.') ? u.file.name.split('.').pop() : undefined;
            const outcome = await classifyUploaded({
              workspaceId: uploadData.workspaceId,
              documentId: u.presign.documentId,
              bucket: u.presign.bucket,
              objectKey: u.presign.objectKey,
              inputName: u.file.name,
              extension: ext,
              contentType: u.file.type || undefined,
            });
            return { ...u, outcome };
          } catch (err) {
            return { ...u, error: err instanceof Error ? err.message : 'classify failed' };
          }
        }),
      );
      setUploadData((prev) => ({ ...prev, uploads: classified }));
      setCurrentStep(2);
      const failures = classified.filter((u) => u.outcome && !u.outcome.ok).length;
      if (failures > 0) {
        appToast.warning('Processing started', `${failures} document(s) reported an error.`);
      } else {
        appToast.info(
          'Processing started',
          uploadData.batchId
            ? `Batch ${uploadData.batchId} was classified.`
            : 'Your files were classified.',
        );
      }
    } catch (err) {
      appToast.error('Classification failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsClassifying(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PageFrame
          title={routeMeta.title}
          description={pageDescription}
          breadcrumbs={getBreadcrumbsForPath('/document-transfer')}
        >
          <div className="flex flex-col gap-8">
            <nav aria-label="Transfer progress" className="mx-auto w-full max-w-xs">
              <ProgressSteps items={stepItems} variant="circles-text" size="sm" />
            </nav>

            {currentStep === 1 ? (
              <UploadDocuments data={uploadData} updateData={updateData} updateUploads={updateUploads} />
            ) : (
              <ProcessingDashboard data={uploadData} />
            )}
          </div>
        </PageFrame>
      </div>

      <div className="shrink-0 border-t border-secondary bg-primary px-4 py-4 lg:px-8">
        <div className={`flex items-center justify-between ${dashboardContentWidthClassName}`}>
          <Button
            size="sm"
            color="tertiary"
            iconLeading={ArrowLeft}
            onClick={() => setCurrentStep(1)}
            isDisabled={currentStep === 1}
          >
            Back
          </Button>

          {currentStep === 1 ? (
            <Button
              size="sm"
              color="primary"
              iconTrailing={ArrowRight}
              onClick={handleContinue}
              isDisabled={!canProceed || isClassifying}
              isLoading={isClassifying}
            >
              Continue
            </Button>
          ) : (
            <Button
              size="sm"
              color="tertiary"
              onClick={() => {
                setCurrentStep(1);
                appToast.info('Upload updated', 'You can edit files before continuing.');
              }}
            >
              Edit upload
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
