/**
 * Browser-direct GraphQL client for the ingestion-subgraph router (the BFF).
 *
 * The SPA talks GraphQL straight from the browser. The endpoint is read at
 * runtime from window.__APP_CONFIG__.graphqlUrl (injected per-environment by the
 * Docker entrypoint), defaulting to the local compose router. To go same-origin
 * in prod, set GRAPHQL_URL=/graphql and enable the nginx proxy (see deploy/).
 *
 * Live write-path = presignUpload → PUT bytes to S3 → classifyUploaded.
 */

declare global {
  interface Window {
    __APP_CONFIG__?: {
      graphqlUrl?: string;
      /** Local-dev shim "from=to" host rewrite for presigned upload URLs.
       *  LocalStack signs PUT URLs with the internal docker host (localstack:4566),
       *  unreachable from the browser; rewrite it to the host-published endpoint.
       *  Empty/unset on real AWS (dev05) — real S3 hosts are browser-reachable. */
      uploadRewrite?: string;
    };
  }
}

/** This compose stack is effectively single-workspace; wks-ui-001 is seeded as
 *  DEFAULT_WORKSPACE_ID and hardcoded in the reference UI. */
export const DEFAULT_WORKSPACE_ID = 'wks-ui-001';

export function graphqlEndpoint(): string {
  return window.__APP_CONFIG__?.graphqlUrl ?? 'http://localhost:8099/graphql';
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(graphqlEndpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  if (!json.data) {
    throw new Error('graphql: empty response');
  }
  return json.data;
}

// ── Upload write-path ───────────────────────────────────────────────────────

export interface PresignUploadResult {
  documentId: string;
  bucket: string;
  objectKey: string;
  uploadUrl: string;
}

export async function presignUpload(
  workspaceId: string,
  inputName: string,
  contentType?: string,
): Promise<PresignUploadResult> {
  const d = await gql<{ presignUpload: PresignUploadResult }>(
    `mutation($i: PresignUploadInput!) {
      presignUpload(input: $i) { documentId bucket objectKey uploadUrl }
    }`,
    { i: { workspaceId, inputName, contentType } },
  );
  return d.presignUpload;
}

/** Apply the optional local-dev host rewrite (LocalStack internal host →
 *  browser-reachable host). No-op when uploadRewrite is unset (real AWS). */
export function rewriteUploadUrl(uploadUrl: string): string {
  const rule = window.__APP_CONFIG__?.uploadRewrite;
  if (!rule || !rule.includes('=')) return uploadUrl;
  const [from, to] = rule.split('=');
  return from ? uploadUrl.replace(from, to) : uploadUrl;
}

/** PUT the file bytes straight to the presigned S3 URL, reporting progress. */
export function putToPresignedUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', rewriteUploadUrl(uploadUrl), true);
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`upload failed: HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error('upload failed: network error'));
    xhr.send(file);
  });
}

export interface ClassifyOutcome {
  ok: boolean;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  elapsedMs: number;
  documentId: string;
  objectKey: string;
  inputName: string;
  archiveDispatch?: string | null;
  convertDispatch?: string | null;
  emailDispatch?: string | null;
}

export interface ClassifyUploadedInput {
  workspaceId: string;
  documentId: string;
  bucket: string;
  objectKey: string;
  inputName: string;
  extension?: string;
  contentType?: string;
  overrideDuplicateCheck?: boolean;
  parentArchiveDepth?: number;
}

export async function classifyUploaded(input: ClassifyUploadedInput): Promise<ClassifyOutcome> {
  const d = await gql<{ classifyUploaded: ClassifyOutcome }>(
    `mutation($i: ClassifyUploadedInput!) {
      classifyUploaded(input: $i) {
        ok result error elapsedMs documentId objectKey inputName
        archiveDispatch convertDispatch emailDispatch
      }
    }`,
    { i: input },
  );
  return d.classifyUploaded;
}

/** Convenience: presign → PUT (with progress) → classify, for one file. */
export async function uploadAndClassify(
  workspaceId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ClassifyOutcome> {
  const presigned = await presignUpload(workspaceId, file.name, file.type || undefined);
  await putToPresignedUrl(presigned.uploadUrl, file, onProgress);
  const ext = file.name.includes('.') ? file.name.split('.').pop() : undefined;
  return classifyUploaded({
    workspaceId,
    documentId: presigned.documentId,
    bucket: presigned.bucket,
    objectKey: presigned.objectKey,
    inputName: file.name,
    extension: ext,
    contentType: file.type || undefined,
  });
}

// ── Reads ─────────────────────────────────────────────────────────────────

export interface RecentRun {
  id: string;
  ts: string;
  inputName: string;
  workspaceId: string;
  elapsedMs?: number | null;
  status: string;
  result?: Record<string, unknown> | null;
  failureReason?: string | null;
  objectKey?: string | null;
  convertStatus?: string | null;
}

export interface ClassificationStats {
  total: number;
  byTier: Record<string, number>;
  byCategory: Record<string, number>;
  byFormat: Record<string, number>;
  errors: number;
  recent: RecentRun[];
}

export async function classificationStats(workspaceId: string): Promise<ClassificationStats> {
  const d = await gql<{ classificationStats: ClassificationStats }>(
    `query($w: ID!) {
      classificationStats(workspaceId: $w) {
        total errors byTier byCategory byFormat
        recent { id ts inputName workspaceId elapsedMs status result failureReason objectKey convertStatus }
      }
    }`,
    { w: workspaceId },
  );
  return d.classificationStats;
}

export interface RouterHealth {
  ready: boolean;
  endpoint?: string | null;
  tables?: string[] | null;
  latencyMs?: number | null;
}

export async function routerHealth(): Promise<RouterHealth> {
  const d = await gql<{ routerHealth: RouterHealth }>(
    `query { routerHealth { ready endpoint tables latencyMs } }`,
  );
  return d.routerHealth;
}

export interface BackendTarget {
  backend: string;
  endpoint: string;
  region: string;
  bucket: string;
  contentHashTable: string;
  workspaceConfigTable: string;
}

export async function backendTarget(): Promise<BackendTarget> {
  const d = await gql<{ backendTarget: BackendTarget }>(
    `query { backendTarget { backend endpoint region bucket contentHashTable workspaceConfigTable } }`,
  );
  return d.backendTarget;
}

/** Presigned upload keys are `ui/<documentId>/<filename>` — recover the id. */
export function documentIdFromObjectKey(objectKey?: string | null): string | undefined {
  if (!objectKey) return undefined;
  const parts = objectKey.split('/');
  return parts[0] === 'ui' && parts.length >= 2 ? parts[1] : undefined;
}

export interface DocumentRun {
  documentId: string;
  workspaceId: string;
  bucket: string;
  downloadUrl?: string | null;
  convertedDownloadUrl?: string | null;
}

export async function documentRun(
  workspaceId: string,
  documentId: string,
  objectKey?: string,
  runId?: string,
): Promise<DocumentRun | null> {
  // runId (the classifications row key `${ts}#${documentId}`) is REQUIRED for the
  // router to locate the convert row and return convertedDownloadUrl (the PDF).
  const d = await gql<{ documentRun: DocumentRun | null }>(
    `query($w: ID!, $d: ID!, $k: String, $r: String) {
      documentRun(workspaceId: $w, documentId: $d, objectKey: $k, runId: $r) {
        documentId workspaceId bucket downloadUrl convertedDownloadUrl
      }
    }`,
    { w: workspaceId, d: documentId, k: objectKey, r: runId },
  );
  if (d.documentRun) {
    // Presigned GET URLs share the LocalStack internal-host quirk — rewrite for the browser.
    d.documentRun.downloadUrl = d.documentRun.downloadUrl
      ? rewriteUploadUrl(d.documentRun.downloadUrl)
      : d.documentRun.downloadUrl;
    d.documentRun.convertedDownloadUrl = d.documentRun.convertedDownloadUrl
      ? rewriteUploadUrl(d.documentRun.convertedDownloadUrl)
      : d.documentRun.convertedDownloadUrl;
  }
  return d.documentRun;
}

export interface WorkspaceConfig {
  workspaceId: string;
  policyVersion: string;
  threshold: number;
  maxZipDepth: number;
  quarantineMacros: boolean;
  slipsheetRules: Record<string, unknown>;
  hashTtlDays?: number | null;
}

export async function workspaceConfig(workspaceId: string): Promise<WorkspaceConfig | null> {
  const d = await gql<{ workspaceConfig: WorkspaceConfig | null }>(
    `query($w: ID!) {
      workspaceConfig(workspaceId: $w) {
        workspaceId policyVersion threshold maxZipDepth quarantineMacros slipsheetRules hashTtlDays
      }
    }`,
    { w: workspaceId },
  );
  return d.workspaceConfig;
}

export interface WorkspaceConfigInput {
  workspaceId: string;
  policyVersion?: string;
  threshold?: number;
  maxZipDepth?: number;
  quarantineMacros?: boolean;
  slipsheetRules?: Record<string, unknown>;
  hashTtlDays?: number | null;
}

export async function saveWorkspaceConfig(input: WorkspaceConfigInput): Promise<WorkspaceConfig> {
  const d = await gql<{ saveWorkspaceConfig: WorkspaceConfig }>(
    `mutation($i: WorkspaceConfigInput!) {
      saveWorkspaceConfig(input: $i) {
        workspaceId policyVersion threshold maxZipDepth quarantineMacros slipsheetRules hashTtlDays
      }
    }`,
    { i: input },
  );
  return d.saveWorkspaceConfig;
}
