// In-memory store for email-extraction service responses, keyed by classifier
// documentId. Lifetime: process-local — survives Next.js hot reload (via the
// globalThis pin, same trick as ui/lib/stats.ts) but not a UI container
// restart. Acceptable for the test dashboard; the deployed Lambda path is
// unaffected.
//
// The classify route writes here when emailDispatch == "ok"; the
// /api/runs/[documentId]/email-extraction route reads from it for the
// ResultPanel popup.

export interface EmailExtractionResponse {
  readonly tenant_id?: string;
  readonly document_id?: string;
  readonly message_id?: string;
  readonly subject?: string | null;
  readonly body_source?: string | null;
  readonly is_html?: boolean;
  readonly body?: string | null;
  readonly body_key?: string | null;
  readonly metadata_key?: string | null;
  readonly attachment_keys?: readonly string[] | null;
  readonly emitted_events?: number;
  readonly nested_emits?: number;
  readonly attachment_failures?: number;
  readonly duplicate_skipped?: boolean;
  readonly depth_limited?: boolean;
  // App Runner may add fields; keep it open.
  readonly [k: string]: unknown;
}

interface Store {
  byDocId: Map<string, EmailExtractionResponse>;
}

const GLOBAL_KEY = "__EMAIL_EXTRACTIONS__" as const;

function store(): Store {
  const g = globalThis as unknown as { [GLOBAL_KEY]?: Store };
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { byDocId: new Map() };
  return g[GLOBAL_KEY]!;
}

export function recordEmailExtraction(
  documentId: string,
  payload: EmailExtractionResponse,
): void {
  store().byDocId.set(documentId, payload);
}

export function getEmailExtraction(
  documentId: string,
): EmailExtractionResponse | undefined {
  return store().byDocId.get(documentId);
}
