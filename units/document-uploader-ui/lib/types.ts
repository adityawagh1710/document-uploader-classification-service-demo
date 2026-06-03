// Local copies of the classification API response shapes the UI consumes.
// Formerly pulled in via type-only `@svc/...` imports; localized here so the UI
// has ZERO source coupling to the classification service — it talks to the
// wundergraph-router over the wire and only needs these response shapes.

export interface WorkspaceConfig {
  workspaceId: string;
  policyVersion: string;
  threshold: number;
  maxZipDepth: number;
  quarantineMacros: boolean;
  // Router returns this as a string->string map (the `Map` scalar).
  slipsheetRules: Record<string, string>;
  hashTtlDays: number | null;
}

// The classification result envelope returned by the router's classifyUploaded
// mutation (the classification service's ClassificationOutput, passed through).
export interface ClassificationOutput {
  documentId: string;
  workspaceId: string;
  classification: {
    format: string;
    category: string;
    subCategory: string | null;
    confidenceScore: number;
    detectionTier: string;
    isForcedSlipsheet: boolean;
    slipsheetReason?: string | null;
  };
  dedup: {
    contentHash: string;
    isDuplicate: boolean;
  };
  policyVersion: string;
}

// The failure envelope returned (as the opaque error map) when classification
// fails. `reason`/`message` are stringified loosely for display.
export type ClassificationFailure =
  | { kind: "input-validation"; field: string; message: string }
  | { kind: "s3"; reason: string }
  | { kind: "store"; reason: string }
  | { kind: "signal"; reason: string }
  | { kind: "unexpected"; message: string }
  | { kind: string; reason?: string; message?: string };

// The email-extraction-service response shape, surfaced in the ResultPanel
// popup. Returned by /api/runs/[documentId]/email-extraction (router-backed).
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
  readonly [k: string]: unknown;
}
