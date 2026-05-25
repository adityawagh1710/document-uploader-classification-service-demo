import type {
  Category,
  DetectionTier,
  MatchType,
  SlipsheetReason,
  SubCategory,
  TaskPayload,
  WorkspaceConfig,
} from "../shared/types.js";
import type { S3Error } from "../ports/S3Reader.js";
import type { StoreError } from "../ports/ContentHashStore.js";
import type { SignalError } from "../ports/TaskSignaler.js";

import type { Tier1FileTypeDetector } from "../domain/tier1-filetype/index.js";
import type { Tier2OLE2Detector } from "../domain/tier2-ole2/index.js";
import type { Tier2ZIPDetector } from "../domain/tier2-zip/index.js";
import type { Tier3TextDetector } from "../domain/tier3-text/index.js";
import type { Scorer } from "../domain/scoring/index.js";
import type { CategoryMapper } from "../domain/categories/index.js";
import type { SlipsheetDecider, SlipsheetDecision } from "../domain/slipsheet/index.js";

import type { S3Reader } from "../ports/S3Reader.js";
import type { S3Streamer } from "../ports/S3Streamer.js";
import type { Hasher } from "../ports/Hasher.js";
import type { ContentHashStore } from "../ports/ContentHashStore.js";
import type { WorkspaceConfigStore } from "../ports/WorkspaceConfigStore.js";
import type { Logger } from "../ports/Logger.js";
import type { Result } from "../shared/result.js";

export type ClassificationFailure =
  | { kind: "input-validation"; field: string; message: string }
  | { kind: "s3"; reason: S3Error }
  | { kind: "store"; reason: StoreError }
  | { kind: "signal"; reason: SignalError }
  | { kind: "unexpected"; message: string };

export interface ClassificationOutput {
  readonly documentId: string;
  readonly workspaceId: string;
  readonly classification: {
    readonly format: string;
    readonly category: Category;
    readonly subCategory: SubCategory;
    readonly confidenceScore: number;
    readonly detectionTier: DetectionTier;
    readonly isForcedSlipsheet: boolean;
    readonly slipsheetReason: SlipsheetReason;
  };
  readonly dedup: {
    readonly contentHash: string;
    readonly isDuplicate: boolean;
  };
  readonly policyVersion: string;
}

export interface DetectionState {
  readonly tier: DetectionTier;
  readonly detectedFormat: string | null;
  readonly matchType: MatchType;
  readonly clsid?: string;
}

export interface ClassificationServiceDeps {
  // Domain (U-1)
  tier1: Tier1FileTypeDetector;
  tier2OLE2: Tier2OLE2Detector;
  tier2ZIP: Tier2ZIPDetector;
  tier3Text: Tier3TextDetector;
  scorer: Scorer;
  categoryMapper: CategoryMapper;
  slipsheetDecider: SlipsheetDecider;
  // Ports
  s3Reader: S3Reader;
  s3Streamer: S3Streamer;
  hasher: Hasher;
  contentHashStore: ContentHashStore;
  workspaceConfigStore: WorkspaceConfigStore;
  logger: Logger;
  // Injected for determinism (NFR-5)
  nowProvider: () => string;
  policyVersionExtractor: (config: WorkspaceConfig) => string;
}

export interface ClassificationService {
  classify(payload: TaskPayload): Promise<Result<ClassificationOutput, ClassificationFailure>>;
}

export interface BuildOutputInput {
  readonly documentId: string;
  readonly workspaceId: string;
  readonly policyVersion: string;
  readonly contentHash: string;
  readonly isDuplicate: boolean;
  readonly detectionState: DetectionState;
  readonly slipsheetDecision: SlipsheetDecision;
  readonly confidenceScore: number;
  readonly categoryDecision: { category: Category; subCategory: SubCategory } | null;
}

export interface OutputBuilder {
  build(input: BuildOutputInput): ClassificationOutput;
}

export interface InputValidator {
  validate(unknownPayload: unknown):
    Result<TaskPayload, Extract<ClassificationFailure, { kind: "input-validation" }>>;
}
