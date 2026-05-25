# Domain Entities — U-3 `handler`

> U-3's entity ownership is narrow: most types come from U-1 (`Result<T,E>`, `TaskPayload`, `ClassificationOutput`-ish shape, etc.) and U-2 (`StoreError`, `PutOutcome`). U-3 owns:
> - **`ClassificationFailure`** (the orchestrator-level error discriminator)
> - **`ClassificationServiceDeps`** (the dep set the orchestrator factory accepts)
> - **`LambdaEvent`** (the AWS Lambda runtime event payload)
> - Port discriminators for new ports U-3 introduces: `S3Reader`, `S3Streamer`, `Hasher`, `TaskSignaler`

---

## 1. Entity Index

| Entity | Layer | Owned By | Used By |
|---|---|---|---|
| `ClassificationFailure` | application | U-3 | LambdaHandler (maps to errorCode), tests |
| `ClassificationServiceDeps` | application | U-3 | `createClassificationService` factory |
| `ClassificationOutput` | application | U-3 (restated; final shape) | `OutputBuilder`, tests |
| `LambdaEvent` | handler-entry | U-3 | Lambda runtime entry |
| `S3Error` (port discriminator) | ports | U-3 | `S3Adapter`, orchestrator |
| `SignalError` (port discriminator) | ports | U-3 | `StepFunctionAdapter`, orchestrator |
| `S3Reader` / `S3Streamer` ports | ports | U-3 | adapter + orchestrator |
| `Hasher` port | ports | U-3 | adapter + orchestrator |
| `TaskSignaler` port | ports | U-3 | adapter + orchestrator entry |
| `OutputBuilder` interface | application | U-3 | orchestrator |
| `InputValidator` interface | application | U-3 | orchestrator |
| `ClassificationService` interface | application | U-3 | LambdaHandler |

---

## 2. `ClassificationFailure` Discriminated Union

```typescript
export type ClassificationFailure =
  | { kind: "input-validation"; field: string; message: string }
  | { kind: "s3"; reason: S3Error }
  | { kind: "store"; reason: StoreError }
  | { kind: "signal"; reason: SignalError }
  | { kind: "unexpected"; message: string };
```

**Variant semantics**:
- `input-validation` — the §4.1 payload failed Zod validation. `field` = path of the first failing field; `message` = Zod's user-readable explanation.
- `s3` — an S3 operation returned a typed `S3Error` (object-not-found, access-denied, transient, throttled, unknown).
- `store` — a DDB operation returned a typed `StoreError` (conditional-check-failed, throttled, transient, not-found, unknown).
- `signal` — `TaskSignaler.sendTaskSuccess/Failure` itself failed (network/throttle on SFN). Note: this is *not* a normal user-facing error — the orchestrator cannot signal the task at all. The Lambda handler in this case throws to let the SFN retry layer re-invoke.
- `unexpected` — caught by the Lambda entry-point's global try/catch. Anything not specifically mapped lands here.

---

## 3. `S3Error`, `SignalError` Port Discriminators

```typescript
// src/ports/S3Reader.ts (created in U-3 Code Generation)
export type S3Error =
  | "object-not-found"
  | "access-denied"
  | "transient"
  | "throttled"
  | "unknown";

export interface S3Reader {
  getRange(input: { bucket: string; key: string; start: number; end: number }):
    Promise<Result<Uint8Array, S3Error>>;
}

export interface S3Streamer {
  stream(input: { bucket: string; key: string }): AsyncIterable<Uint8Array>;
  // Note: stream() returning an AsyncIterable can throw mid-stream; the orchestrator
  // catches with try/catch around `for await` and maps to ClassificationFailure.s3
}

// src/ports/TaskSignaler.ts (created in U-3 Code Generation)
export type SignalError =
  | "task-not-found"
  | "transient"
  | "unknown";

export interface TaskSignaler {
  sendTaskSuccess(input: { taskToken: string; output: unknown }):
    Promise<Result<void, SignalError>>;
  sendTaskFailure(input: { taskToken: string; error: { code: string; message: string } }):
    Promise<Result<void, SignalError>>;
}

// src/ports/Hasher.ts (created in U-3 Code Generation)
export interface Hasher {
  sha256(stream: AsyncIterable<Uint8Array>): Promise<string>;  // hex
}
```

---

## 4. `ClassificationOutput` (final shape — restated from §4.2)

```typescript
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
```

**Invariants enforced by `OutputBuilder`**:
- `slipsheetReason !== null` iff `isForcedSlipsheet === true` (PBT-U3-003)
- `subCategory !== null` only when `category === "convert"` (PBT-U3-004)
- `confidenceScore ∈ [0, 1]` (inherited from Scorer's invariant)
- `format` is always non-empty string (defaults to `"unknown"` if classification failed entirely + slipsheeting)

---

## 5. `ClassificationServiceDeps`

```typescript
export interface ClassificationServiceDeps {
  // Domain (U-1)
  tier1: Tier1FileTypeDetector;
  tier2OLE2: Tier2OLE2Detector;
  tier2ZIP: Tier2ZIPDetector;
  tier3Text: Tier3TextDetector;
  scorer: Scorer;
  categoryMapper: CategoryMapper;
  slipsheetDecider: SlipsheetDecider;

  // Ports (U-3 introduces these)
  s3Reader: S3Reader;
  s3Streamer: S3Streamer;
  hasher: Hasher;

  // Ports (U-2 owns these — orchestrator consumes them)
  contentHashStore: ContentHashStore;
  workspaceConfigStore: WorkspaceConfigStore;

  // Observability (Logger from U-1; metrics/tracer pass-through to Powertools at handler-entry)
  logger: Logger;
  nowProvider: () => string;     // ISO-8601 timestamp; injected for testability
  policyVersionExtractor: (config: WorkspaceConfig) => string;   // typically `(c) => c.policyVersion`
}
```

**Notes**:
- `nowProvider` exists so tests can inject deterministic timestamps (`() => "2026-05-22T10:00:00.000Z"`). Per NFR-5 (determinism), the orchestrator never calls `Date.now()` directly.
- `policyVersionExtractor` is trivial (`(c) => c.policyVersion`) but factored as a dep so tests can simulate policy-version mismatches without mocking the whole config.

---

## 6. `LambdaEvent`

```typescript
import type { Handler } from "aws-lambda";

// The Lambda runtime calls handler(event, context) where event has the §4.1 shape
// (after AWS Step Functions JSON serialisation).
export type LambdaEvent = unknown;   // intentionally unknown — InputValidator narrows

export const handler: Handler<LambdaEvent, void>;
```

The handler is typed as `Handler<unknown, void>` because:
1. We don't trust the AWS SDK's type for the event (Step Functions can change shape)
2. `InputValidator.validate` is the type narrowing point
3. The Lambda return value is `void` — actual response goes through `TaskSignaler`

---

## 7. `InputValidator`, `OutputBuilder`, `ClassificationService` Interfaces

```typescript
export interface InputValidator {
  validate(unknownPayload: unknown):
    Result<TaskPayload, Extract<ClassificationFailure, { kind: "input-validation" }>>;
}

export interface OutputBuilder {
  build(input: BuildOutputInput): ClassificationOutput;
}

export interface BuildOutputInput {
  readonly documentId: string;
  readonly workspaceId: string;
  readonly policyVersion: string;
  readonly contentHash: string;
  readonly isDuplicate: boolean;
  readonly detectionState: DetectionState;   // see §8
  readonly slipsheetDecision: SlipsheetDecision;
}

export interface ClassificationService {
  classify(payload: TaskPayload): Promise<Result<ClassificationOutput, ClassificationFailure>>;
}
```

---

## 8. `DetectionState` — Internal Per-Invocation State

The orchestrator accumulates per-step state into a single typed bag. Not a public type — internal helper for the `classify()` function's state-machine-like flow.

```typescript
interface DetectionState {
  readonly tier: DetectionTier;          // "file-type" | "ole2-clsid" | "zip-marker" | "text-heuristic" | "extension-fallback"
  readonly detectedFormat: string | null;
  readonly matchType: MatchType;
  readonly clsid?: string;                // present only when matchType === "ole2-with-clsid"
}
```

Built incrementally by Steps 4–7 of `services.md` §1, consumed by Steps 8–10 + 13.

---

## 9. Per-Step Entity Flow

```
LambdaEvent (unknown)
       │
       │ STEP 1: InputValidator.validate
       ▼
TaskPayload (validated)
       │
       │ STEP 2: WorkspaceConfigStore.get
       ▼
WorkspaceConfig
       │
       │ STEP 3: S3Reader.getRange(0..4099)
       ▼
Uint8Array (4,100 bytes)
       │
       │ STEPS 4–7: tier1/tier2OLE2/tier2ZIP/tier3Text in sequence
       ▼
DetectionState (internal)
       │
       │ STEP 8: Scorer.score
       ▼
+ confidenceScore: number
       │
       │ STEP 9: CategoryMapper.map
       ▼
+ category: Category, subCategory: SubCategory (may be null)
       │
       │ STEP 10: SlipsheetDecider.decide
       ▼
+ SlipsheetDecision { slipsheet, reason }
       │
       │ STEP 11: Hasher.sha256(S3Streamer.stream)
       ▼
+ contentHash: string
       │
       │ STEP 12: dedup-decision (Cases A/B/C/D from services.md)
       ▼
+ isDuplicate: boolean
       │
       │ STEP 13: OutputBuilder.build
       ▼
ClassificationOutput
       │
       │ LambdaHandler entry → TaskSignaler.sendTaskSuccess
       ▼
(Lambda returns; Step Function advances)
```

Each step is a function call. The orchestrator is a single `async classify()` method that threads `DetectionState` through this sequence with explicit error handling at each step.

---

## 10. Entities Out of Scope for U-3

For clarity, U-3 does **not** define:
- `ContentHashRecord`, `WorkspaceConfig` — U-1 shared types
- `ContentHashStore`, `WorkspaceConfigStore`, `StoreError`, `PutOutcome` — U-2 ports
- `Tier1Result`, `Tier2OLE2Result`, etc. — U-1 domain results
- AWS-specific event types (`APIGatewayEvent`, `SQSEvent`, etc.) — irrelevant; this Lambda is Step Function task-token-driven
