export type DetectionTier =
  | "file-type"
  | "ole2-clsid"
  | "zip-marker"
  | "text-heuristic"
  | "extension-fallback";

export type MatchType =
  | "exact-unique-signature"
  | "ole2-with-clsid"
  | "zip-with-ooxml-or-odf"
  | "ole2-or-zip-ext-fallback"
  | "text-heuristic"
  | "extension-only"
  | "no-match";

export type Category =
  | "ocr-direct"
  | "media"
  | "convert"
  | "email"
  | "archive"
  | "slipsheet";

export type SubCategory =
  | "office"
  | "image"
  | "tiff"
  | "html"
  | "convert-then-ocr"
  | null;

export type SlipsheetReason =
  | "workspace-policy"
  | "max-zip-depth"
  | "low-confidence"
  | null;

export type CLSID = string;

export interface TaskPayload {
  readonly taskToken: string;
  readonly workspaceId: string;
  readonly documentId: string;
  readonly s3: { readonly bucket: string; readonly key: string };
  readonly hints: {
    readonly extension: string | null;
    readonly contentType: string | null;
  };
  readonly context: {
    readonly parentArchiveDepth: number;
    readonly overrideDuplicateCheck: boolean;
  };
}

export interface WorkspaceConfig {
  readonly workspaceId: string;
  readonly policyVersion: string;
  readonly threshold: number;
  readonly maxZipDepth: number;
  readonly quarantineMacros: boolean;
  readonly slipsheetRules: Readonly<Record<string, "always-slipsheet">>;
  readonly hashTtlDays: number | null;
}

export interface ContentHashRecord {
  readonly workspaceId: string;
  readonly contentHash: string;
  readonly firstSeenAt: string;
  readonly firstDocumentId: string;
  readonly format: string;
  readonly policyVersion: string;
  readonly lastSeenAt: string;
  readonly hitCount: number;
  readonly expiresAt?: number;
}
