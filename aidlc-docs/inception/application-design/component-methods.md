# Component Methods — Classification Service

> Method signatures only — the *shape* of the public surface for every component. **Detailed business rules land in Functional Design (per unit) in the Construction phase**; this file only fixes the contracts that those rules will implement.
>
> Conventions:
> - **Pure-domain** signatures use synchronous returns where I/O isn't involved.
> - **Async** signatures return `Promise<Result<T, E>>` where the error is part of normal flow (Q2=B mixed style).
> - **Truly unrecoverable** errors are thrown and caught at `LambdaHandler` (S-04).
> - Factory exports follow Q3=A pattern: `export function createXxx(deps: XxxDeps): Xxx { … }`

---

## Type Aliases (shared across components)

```typescript
// shared/result.ts
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// shared/types.ts
export type DetectionTier =
  | "file-type"
  | "ole2-clsid"
  | "zip-marker"
  | "text-heuristic"
  | "extension-fallback";

export type Category =
  | "ocr-direct" | "media" | "convert" | "email" | "archive" | "slipsheet";

export type SubCategory =
  | "office" | "image" | "tiff" | "html" | "convert-then-ocr" | null;

export type SlipsheetReason =
  | "workspace-policy" | "max-zip-depth" | "low-confidence" | null;

export type MatchType =
  | "exact-unique-signature"   // 0.95
  | "ole2-with-clsid"          // 0.90
  | "zip-with-ooxml-or-odf"    // 0.90
  | "ole2-or-zip-ext-fallback" // 0.70
  | "text-heuristic"           // 0.65
  | "extension-only"           // 0.40
  | "no-match";                // 0.00

export interface TaskPayload {
  taskToken: string;
  workspaceId: string;
  documentId: string;
  s3: { bucket: string; key: string };
  hints: { extension: string | null; contentType: string | null };
  context: { parentArchiveDepth: number; overrideDuplicateCheck: boolean };
}

export interface WorkspaceConfig {
  workspaceId: string;
  policyVersion: string;
  threshold: number;
  maxZipDepth: number;
  quarantineMacros: boolean;
  slipsheetRules: Record<string, "always-slipsheet">;
  hashTtlDays: number | null;
}

export interface ContentHashRecord {
  workspaceId: string;
  contentHash: string;
  firstSeenAt: string;
  firstDocumentId: string;
  format: string;
  policyVersion: string;
  lastSeenAt: string;
  hitCount: number;
  expiresAt?: number;
}
```

---

## Domain Components (classifier-core unit)

### C-01 — Tier1FileTypeDetector

```typescript
export type Tier1Result =
  | { matched: true; ext: string; mime: string }
  | { matched: false };

export interface Tier1FileTypeDetector {
  detect(buffer: Uint8Array): Tier1Result;
}

export function createTier1FileTypeDetector(): Tier1FileTypeDetector;
```

### C-02 — OLE2Parser

```typescript
export type CLSID = string; // canonical hex form: "00020906-0000-0000-C000-000000000046"
export type OLE2ParseError = "non-standard-sector-size" | "directory-beyond-window";

export interface OLE2Parser {
  parseCLSID(buffer: Uint8Array): Result<CLSID, OLE2ParseError>;
}

export function createOLE2Parser(): OLE2Parser;
```

### C-03 — Tier2OLE2Detector

```typescript
export type Tier2OLE2Result =
  | { matched: true; format: string; clsid: CLSID; matchType: "ole2-with-clsid" }
  | { matched: true; format: string; matchType: "ole2-or-zip-ext-fallback" }   // CLSID parse failed or not in lookup → fall back via extension
  | { matched: false };

export interface Tier2OLE2Detector {
  detect(buffer: Uint8Array, extension: string | null): Tier2OLE2Result;
}

export function createTier2OLE2Detector(deps: { parser: OLE2Parser }): Tier2OLE2Detector;
```

### C-04 — ZIPMarkerParser

```typescript
export interface ZIPEntry { filename: string; uncompressed: boolean; }

export interface ZIPMarkerParser {
  scanEntries(buffer: Uint8Array, maxEntries: number): ZIPEntry[];
}

export function createZIPMarkerParser(): ZIPMarkerParser;
```

### C-05 — Tier2ZIPDetector

```typescript
export type Tier2ZIPResult =
  | { matched: true; format: string; family: "ooxml" | "odf"; matchType: "zip-with-ooxml-or-odf" }
  | { matched: true; format: "zip"; family: "plain"; matchType: "exact-unique-signature" }
  | { matched: false };

export interface Tier2ZIPDetector {
  detect(buffer: Uint8Array): Tier2ZIPResult;
}

export function createTier2ZIPDetector(deps: { parser: ZIPMarkerParser }): Tier2ZIPDetector;
```

### C-06 — Tier3TextDetector

```typescript
export type Tier3Result =
  | { matched: true; format: "xml" | "html" | "eml" | "dxf" | "csv" | "txt"; matchType: "text-heuristic" }
  | { matched: false; reason: "binary-bytes" | "no-pattern-matched" };

export interface Tier3TextDetector {
  detect(buffer: Uint8Array): Tier3Result;
}

export function createTier3TextDetector(): Tier3TextDetector;
```

### C-07 — Scorer

```typescript
export interface ScoringInput {
  matchType: MatchType;
  detectedFormat: string | null;
  extension: string | null;
  contentType: string | null;
}

export interface Scorer {
  score(input: ScoringInput): number; // ∈ [0, 1]
}

export function createScorer(): Scorer;
```

### C-08 — CategoryMapper

```typescript
export interface CategoryDecision {
  category: Category;
  subCategory: SubCategory;
}

export interface CategoryMapper {
  map(detectedFormat: string, detectionTier: DetectionTier): CategoryDecision | null;
}

export function createCategoryMapper(): CategoryMapper;
```

### C-09 — SlipsheetDecider

```typescript
export interface SlipsheetInput {
  score: number;
  threshold: number;
  detectedFormat: string | null;
  parentArchiveDepth: number;
  maxZipDepth: number;
  quarantineMacros: boolean;
  slipsheetRules: WorkspaceConfig["slipsheetRules"];
}

export interface SlipsheetDecision {
  slipsheet: boolean;
  reason: SlipsheetReason;
}

export interface SlipsheetDecider {
  decide(input: SlipsheetInput): SlipsheetDecision;
}

export function createSlipsheetDecider(): SlipsheetDecider;
```

---

## Ports (interfaces only — implementations live in adapters)

### P-01 / P-02 — S3 Ports

```typescript
export type S3Error = "object-not-found" | "access-denied" | "transient" | "throttled" | "unknown";

export interface S3Reader {
  getRange(input: { bucket: string; key: string; start: number; end: number }):
    Promise<Result<Uint8Array, S3Error>>;
}

export interface S3Streamer {
  stream(input: { bucket: string; key: string }): AsyncIterable<Uint8Array>;
}
```

### P-03 — Hasher

```typescript
export interface Hasher {
  sha256(stream: AsyncIterable<Uint8Array>): Promise<string>; // hex
}
```

### P-04 — ContentHashStore

```typescript
export type StoreError =
  | "throttled" | "conditional-check-failed" | "transient" | "unknown";

export type PutOutcome = "written" | "already-existed";

export interface ContentHashStore {
  get(input: { workspaceId: string; contentHash: string }):
    Promise<Result<ContentHashRecord | null, StoreError>>;

  putIfAbsent(record: ContentHashRecord):
    Promise<Result<PutOutcome, StoreError>>;

  updateOnDuplicateHit(input: { workspaceId: string; contentHash: string; now: string }):
    Promise<Result<void, StoreError>>;

  replaceOnPolicyMismatch(record: ContentHashRecord):
    Promise<Result<void, StoreError>>;
}
```

### P-05 — WorkspaceConfigStore

```typescript
export interface WorkspaceConfigStore {
  get(workspaceId: string): Promise<Result<WorkspaceConfig, StoreError>>;
}
```

### P-06 — TaskSignaler

```typescript
export type SignalError = "transient" | "task-not-found" | "unknown";

export interface TaskSignaler {
  sendTaskSuccess(input: { taskToken: string; output: unknown }):
    Promise<Result<void, SignalError>>;

  sendTaskFailure(input: { taskToken: string; error: { code: string; message: string } }):
    Promise<Result<void, SignalError>>;
}
```

### P-07 — Logger

```typescript
export type LogContext = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext & { errorCode?: string }): void;
  debug(message: string, context?: LogContext): void;
}
```

---

## Adapters (factory signatures only — implementation rules in NFR Design)

### A-01 — S3Adapter

```typescript
import type { S3Client } from "@aws-sdk/client-s3";

export function createS3Adapter(deps: { s3: S3Client; logger: Logger }): S3Reader & S3Streamer;
```

### A-02 — NodeCryptoHasher

```typescript
export function createNodeCryptoHasher(): Hasher;
```

### A-03 — DDBContentHashAdapter

```typescript
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export function createDDBContentHashAdapter(deps: {
  ddb: DynamoDBDocumentClient;
  tableName: string;
  logger: Logger;
}): ContentHashStore;
```

### A-04 — DDBWorkspaceConfigAdapter

```typescript
export function createDDBWorkspaceConfigAdapter(deps: {
  ddb: DynamoDBDocumentClient;
  tableName: string;
  logger: Logger;
}): WorkspaceConfigStore;
```

### A-05 — StepFunctionAdapter

```typescript
import type { SFNClient } from "@aws-sdk/client-sfn";

export function createStepFunctionAdapter(deps: { sfn: SFNClient; logger: Logger }): TaskSignaler;
```

### A-06 — PowertoolsLoggerAdapter

```typescript
export function createPowertoolsLogger(serviceName: string, correlationKey: string): Logger;
```

---

## Application Layer (handler unit)

### S-01 — ClassificationService (orchestrator)

```typescript
export interface ClassificationOutput {
  documentId: string;
  workspaceId: string;
  classification: {
    format: string;
    category: Category;
    subCategory: SubCategory;
    confidenceScore: number;
    detectionTier: DetectionTier;
    isForcedSlipsheet: boolean;
    slipsheetReason: SlipsheetReason;
  };
  dedup: { contentHash: string; isDuplicate: boolean };
  policyVersion: string;
}

export type ClassificationFailure =
  | { kind: "input-validation"; field: string; message: string }
  | { kind: "s3"; reason: S3Error }
  | { kind: "store"; reason: StoreError }
  | { kind: "signal"; reason: SignalError }
  | { kind: "unexpected"; message: string };

export interface ClassificationServiceDeps {
  // domain
  tier1: Tier1FileTypeDetector;
  tier2OLE2: Tier2OLE2Detector;
  tier2ZIP: Tier2ZIPDetector;
  tier3Text: Tier3TextDetector;
  scorer: Scorer;
  categoryMapper: CategoryMapper;
  slipsheetDecider: SlipsheetDecider;
  // ports
  s3Reader: S3Reader;
  s3Streamer: S3Streamer;
  hasher: Hasher;
  contentHashStore: ContentHashStore;
  workspaceConfigStore: WorkspaceConfigStore;
  // observability
  logger: Logger;
}

export interface ClassificationService {
  classify(payload: TaskPayload): Promise<Result<ClassificationOutput, ClassificationFailure>>;
}

export function createClassificationService(deps: ClassificationServiceDeps): ClassificationService;
```

### S-02 — InputValidator

```typescript
import type { z } from "zod";

export const TaskPayloadSchema: z.ZodType<TaskPayload>;

export interface InputValidator {
  validate(unknownPayload: unknown):
    Result<TaskPayload, { kind: "input-validation"; field: string; message: string }>;
}

export function createInputValidator(): InputValidator;
```

### S-03 — OutputBuilder

```typescript
export interface OutputBuilder {
  build(classification: ClassificationOutput): unknown; // matches §4.2 schema
}

export function createOutputBuilder(): OutputBuilder;
```

### S-04 — LambdaHandler

```typescript
import type { Handler } from "aws-lambda";

// Lambda entry point — exported per AWS conventions.
// Wires Powertools (logger, metrics, tracer), constructs the dependency graph
// once per cold start, calls service.classify, signals task token.
export const handler: Handler<TaskPayload, void>;
```

---

## Infrastructure Layer (infrastructure unit — CDK constructs)

```typescript
import * as cdk from "aws-cdk-lib";

// I-01
export interface ClassificationLambdaStackProps extends cdk.StackProps {
  contentHashTableArn: string;
  workspaceConfigTableArn: string;
  stateMachineArn: string;
  s3BucketArn: string;
  reservedConcurrency?: number;
}
export class ClassificationLambdaStack extends cdk.Stack { /* … */ }

// I-02
export interface ClassificationDataStackProps extends cdk.StackProps { /* … */ }
export class ClassificationDataStack extends cdk.Stack {
  readonly contentHashTable: cdk.aws_dynamodb.ITable;
  readonly workspaceConfigTable: cdk.aws_dynamodb.ITable;
}

// I-03
export interface ClassificationObservabilityStackProps extends cdk.StackProps {
  lambdaFunctionName: string;
  contentHashTableName: string;
  alertingTopicArn: string;
}
export class ClassificationObservabilityStack extends cdk.Stack { /* … */ }
```

---

## Notes on what is intentionally NOT in this file

- **No detailed business rules.** "How does Tier 3 decide between HTML and EML?" — that's a Functional Design (per unit) concern.
- **No retry-policy parameters.** Retry counts, backoff multipliers, and timeout values get pinned in NFR Requirements + NFR Design per unit.
- **No memory/timeout/concurrency numbers for the Lambda.** Those are NFR Requirements (per unit) decisions.
- **No CDK property values.** Encryption keys, alarm thresholds, retention durations — Infrastructure Design (per unit).
