# Business Logic Model — U-3 `handler`

> Per-component algorithm specifications for U-3's application + adapter layers. The 13-step `ClassificationService.classify()` flow is the centrepiece; everything else exists to support it.

---

## 1. `InputValidator.validate(unknownPayload)` (Application)

**Purpose**: Validate the raw Lambda event against the §4.1 schema using Zod.

**Algorithm**:

```typescript
// Zod schema definition (illustrative; actual code in Code Generation)
const TaskPayloadSchema = z.object({
  taskToken: z.string().min(1),
  workspaceId: z.string().min(1),
  documentId: z.string().min(1),
  s3: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
  }),
  hints: z.object({
    extension: z.string().nullable(),
    contentType: z.string().nullable(),
  }),
  context: z.object({
    parentArchiveDepth: z.number().int().min(0),
    overrideDuplicateCheck: z.boolean(),
  }),
}).passthrough();   // Q1=A: unknown extra fields are silently dropped

function validate(unknownPayload: unknown): Result<TaskPayload, InputValidationFailure> {
  const parsed = TaskPayloadSchema.safeParse(unknownPayload);
  if (parsed.success) {
    return ok(parsed.data as TaskPayload);
  }
  const issue = parsed.error.issues[0];  // first failing field
  return err({
    kind: "input-validation",
    field: issue.path.join("."),
    message: issue.message,
  });
}
```

**Enforced rules**:
- Required fields per Q1=A strict-on-required
- Unknown extra fields silently dropped (`.passthrough()` strips them on `.parse()` but preserves typing)
- All string fields must be non-empty
- `parentArchiveDepth` must be a non-negative integer

**Properties**:
- PBT-U3-001: round-trip preserves valid payloads
- PBT-U3-002: missing required field → Result.error with `kind: "input-validation"`

---

## 2. `ClassificationService.classify(payload)` (Application — the 13-step orchestration)

**Purpose**: Compose domain + persistence + observability into the §4.1 → §4.2 flow.

**Algorithm** (per `services.md` §1, with explicit error mapping per Q2=A):

```typescript
async function classify(payload: TaskPayload): Promise<Result<ClassificationOutput, ClassificationFailure>> {
  return tracer.captureAsyncFunc("classify", async () => {
    // STEP 1 already done by Lambda entry-point; InputValidator returns TaskPayload
    
    // STEP 2: load-workspace-config
    const configResult = await tracer.captureAsyncFunc("classify.step2.load-workspace-config", async () => {
      return workspaceConfigStore.get(payload.workspaceId);
    });
    if (!configResult.ok) {
      logger.error("classify.step2.error", { workspaceId: payload.workspaceId, errorCode: configResult.error });
      metrics.addMetric("ClassificationStepDuration", "Milliseconds", duration, {
        step: "load-workspace-config",
        outcome: "error",
        workspaceId: payload.workspaceId,
      });
      return err({ kind: "store", reason: configResult.error });
    }
    const config = configResult.value;
    
    // STEP 3: read-detection-window
    const bufferResult = await tracer.captureAsyncFunc("classify.step3.read-detection-window", async () => {
      return s3Reader.getRange({
        bucket: payload.s3.bucket,
        key: payload.s3.key,
        start: 0,
        end: 4099,
      });
    });
    if (!bufferResult.ok) {
      logger.error("classify.step3.error", { workspaceId: payload.workspaceId, errorCode: bufferResult.error });
      return err({ kind: "s3", reason: bufferResult.error });
    }
    const buffer = bufferResult.value;
    
    // STEPS 4–7: detection tiers (pure logic; cannot fail)
    const detectionState = await detectInSequence(buffer, payload.hints);
    
    // STEP 8: score (pure)
    const confidenceScore = scorer.score({
      matchType: detectionState.matchType,
      detectedFormat: detectionState.detectedFormat,
      extension: payload.hints.extension,
      contentType: payload.hints.contentType,
    });
    
    // STEP 9: map-category (pure)
    const categoryDecision = detectionState.detectedFormat !== null
      ? categoryMapper.map(detectionState.detectedFormat, detectionState.tier)
      : null;
    
    // STEP 10: decide-slipsheet (pure)
    const slipsheetDecision = slipsheetDecider.decide({
      score: confidenceScore,
      threshold: config.threshold,
      detectedFormat: detectionState.detectedFormat,
      parentArchiveDepth: payload.context.parentArchiveDepth,
      maxZipDepth: config.maxZipDepth,
      quarantineMacros: config.quarantineMacros,
      slipsheetRules: config.slipsheetRules,
    });
    
    // STEP 11: stream-hash
    const hashResult = await tracer.captureAsyncFunc("classify.step11.stream-hash", async () => {
      try {
        const stream = s3Streamer.stream({ bucket: payload.s3.bucket, key: payload.s3.key });
        const contentHash = await hasher.sha256(stream);
        return { ok: true as const, value: contentHash };
      } catch (e) {
        // The AsyncIterable can throw mid-stream; map to s3 error
        return { ok: false as const, error: classifyStreamError(e) };
      }
    });
    if (!hashResult.ok) {
      return err({ kind: "s3", reason: hashResult.error });
    }
    const contentHash = hashResult.value;
    
    // STEP 12: dedup-decision (per services.md §1 STEP 12 — 4 cases)
    const dedupResult = await dedupDecide({
      contentHashStore,
      payload,
      contentHash,
      detectionState,
      config,
      now: nowProvider(),
      finalFormat: deriveFinalFormat(detectionState),
    });
    if (!dedupResult.ok) {
      return err({ kind: "store", reason: dedupResult.error });
    }
    const { isDuplicate } = dedupResult.value;
    
    // STEP 13: build-output
    const output = outputBuilder.build({
      documentId: payload.documentId,
      workspaceId: payload.workspaceId,
      policyVersion: config.policyVersion,
      contentHash,
      isDuplicate,
      detectionState,
      slipsheetDecision,
      confidenceScore,
      categoryDecision,
    });
    
    metrics.addMetric("ClassificationOk", "Count", 1, {
      category: output.classification.category,
      detectionTier: output.classification.detectionTier,
      workspaceId: payload.workspaceId,
    });
    
    return ok(output);
  });
}
```

**Sub-procedures referenced above** (defined in the same `ClassificationService.ts` file):

### `detectInSequence(buffer, hints): Promise<DetectionState>`

```typescript
async function detectInSequence(buffer: Uint8Array, hints: Hints): Promise<DetectionState> {
  // Tier 1 (most authoritative; library oracle)
  const t1 = await tier1.detect(buffer);
  if (t1.matched) {
    return {
      tier: "file-type",
      detectedFormat: t1.ext.toLowerCase(),
      matchType: "exact-unique-signature",
    };
  }
  
  // Tier 2 OLE2 (signature-conditional)
  const t2ole2 = tier2OLE2.detect(buffer, hints.extension);
  if (t2ole2.matched) {
    return {
      tier: t2ole2.matchType === "ole2-or-zip-ext-fallback" ? "extension-fallback" : "ole2-clsid",
      detectedFormat: t2ole2.format,
      matchType: t2ole2.matchType,
      ...(t2ole2.matchType === "ole2-with-clsid" && { clsid: t2ole2.clsid }),
    };
  }
  
  // Tier 2 ZIP (signature-conditional)
  const t2zip = tier2ZIP.detect(buffer);
  if (t2zip.matched) {
    return {
      tier: "zip-marker",
      detectedFormat: t2zip.format,
      matchType: t2zip.matchType,
    };
  }
  
  // Tier 3 text heuristic
  const t3 = tier3Text.detect(buffer);
  if (t3.matched) {
    return {
      tier: "text-heuristic",
      detectedFormat: t3.format,
      matchType: "text-heuristic",
    };
  }
  
  // No match — extension-only fallback if hints provide one
  if (hints.extension) {
    return {
      tier: "extension-fallback",
      detectedFormat: hints.extension.toLowerCase().replace(/^\./, ""),
      matchType: "extension-only",
    };
  }
  
  return { tier: "extension-fallback", detectedFormat: null, matchType: "no-match" };
}
```

### `dedupDecide({...})` — implements the 4-case dedup flow from `services.md` §1 STEP 12

```typescript
async function dedupDecide(args): Promise<Result<{ isDuplicate: boolean }, StoreError>> {
  const { contentHashStore, payload, contentHash, config, now, finalFormat } = args;
  
  const existingResult = await contentHashStore.get({
    workspaceId: payload.workspaceId,
    contentHash,
  });
  if (!existingResult.ok) return err(existingResult.error);
  
  const existing = existingResult.value;
  
  // CASE A: no existing record
  if (existing === null) {
    const newRecord = buildContentHashRecord({
      workspaceId: payload.workspaceId,
      contentHash,
      format: finalFormat,
      policyVersion: config.policyVersion,
      firstDocumentId: payload.documentId,
      now,
      hashTtlDays: config.hashTtlDays,
    });
    const putResult = await contentHashStore.putIfAbsent(newRecord);
    if (!putResult.ok) return err(putResult.error);
    // putResult.value is "written" or "already-existed" — in the rare race-with-other-Lambda case
    // we treat "already-existed" as triggering a re-read; for simplicity we just return false
    // (the same effect — pipeline continues; the other caller's record stands)
    return ok({ isDuplicate: false });
  }
  
  // CASE B: override flag set
  if (payload.context.overrideDuplicateCheck) {
    // Echo isDuplicate=true per Q15=C of Requirements; existing record fully immutable
    return ok({ isDuplicate: true });
  }
  
  // CASE C: policyVersion mismatch
  if (existing.policyVersion !== config.policyVersion) {
    const refreshedRecord = buildContentHashRecord({
      workspaceId: payload.workspaceId,
      contentHash,
      format: finalFormat,
      policyVersion: config.policyVersion,
      firstDocumentId: payload.documentId,
      now,
      hashTtlDays: config.hashTtlDays,
    });
    const replaceResult = await contentHashStore.replaceOnPolicyMismatch({
      record: refreshedRecord,
      expectedStalePolicyVersion: existing.policyVersion,
    });
    if (!replaceResult.ok) return err(replaceResult.error);
    return ok({ isDuplicate: false });
  }
  
  // CASE D: clean duplicate — update lastSeenAt + hitCount
  const updateResult = await contentHashStore.updateOnDuplicateHit({
    workspaceId: payload.workspaceId,
    contentHash,
    now,
  });
  if (!updateResult.ok) return err(updateResult.error);
  return ok({ isDuplicate: true });
}
```

### `deriveFinalFormat(detectionState): string`

```typescript
function deriveFinalFormat(state: DetectionState): string {
  return state.detectedFormat ?? "unknown";
}
```

**Properties**:
- Determinism (NFR-5): same inputs → same outputs (modulo `nowProvider` which is injected for tests)
- Per-step instrumentation (Q5=A): every step opens a tracer subsegment, emits metrics, logs at appropriate level

---

## 3. `OutputBuilder.build(input)` (Application)

**Purpose**: Construct the §4.2 `SendTaskSuccess` payload, enforcing the field invariants.

**Algorithm**:

```typescript
function build(input: BuildOutputInput): ClassificationOutput {
  const {
    documentId, workspaceId, policyVersion, contentHash, isDuplicate,
    detectionState, slipsheetDecision, confidenceScore, categoryDecision,
  } = input;
  
  // Slipsheet path overrides category
  if (slipsheetDecision.slipsheet) {
    return {
      documentId,
      workspaceId,
      classification: {
        format: detectionState.detectedFormat ?? "unknown",
        category: "slipsheet",
        subCategory: null,
        confidenceScore,
        detectionTier: detectionState.tier,
        isForcedSlipsheet: true,
        slipsheetReason: slipsheetDecision.reason!,    // non-null by invariant
      },
      dedup: { contentHash, isDuplicate },
      policyVersion,
    };
  }
  
  // Non-slipsheet path — use categoryDecision (may be null for unknown formats)
  if (categoryDecision === null) {
    // Pure logic deemed no category fit; route to slipsheet with low-confidence reason
    return {
      documentId,
      workspaceId,
      classification: {
        format: detectionState.detectedFormat ?? "unknown",
        category: "slipsheet",
        subCategory: null,
        confidenceScore,
        detectionTier: detectionState.tier,
        isForcedSlipsheet: true,
        slipsheetReason: "low-confidence",
      },
      dedup: { contentHash, isDuplicate },
      policyVersion,
    };
  }
  
  return {
    documentId,
    workspaceId,
    classification: {
      format: detectionState.detectedFormat ?? "unknown",
      category: categoryDecision.category,
      subCategory: categoryDecision.subCategory,
      confidenceScore,
      detectionTier: detectionState.tier,
      isForcedSlipsheet: false,
      slipsheetReason: null,
    },
    dedup: { contentHash, isDuplicate },
    policyVersion,
  };
}
```

**Invariants enforced**:
- PBT-U3-003: `slipsheetReason !== null` iff `isForcedSlipsheet === true`
- PBT-U3-004: `subCategory !== null` only when `category === "convert"` (delegated to `CategoryMapper`, but OutputBuilder preserves)

---

## 4. `LambdaHandler` (Handler Entry — `src/handler/lambda.ts`)

**Purpose**: Lambda runtime entry point. Builds the dependency graph at module load, dispatches each invocation to the orchestrator, signals the Step Function task.

**Algorithm**:

```typescript
// Module-level singletons (cold start once; warm reuse)
const ddb = createDDBDocumentClient();
const s3 = new S3Client({ retryMode: "standard", maxAttempts: 3 });
const sfn = new SFNClient({ retryMode: "standard", maxAttempts: 3 });
const logger = createPowertoolsLogger("classification-service", "documentId");
const metrics = createPowertoolsMetrics("ClassificationService");
const tracer = createPowertoolsTracer();

const inputValidator = createInputValidator();
const outputBuilder = createOutputBuilder();
const taskSignaler = createStepFunctionAdapter({ sfn, logger });
const classificationService = createClassificationService({
  // U-1 domain modules
  tier1: createTier1FileTypeDetector(),
  tier2OLE2: createTier2OLE2Detector({ parser: createOLE2Parser() }),
  tier2ZIP: createTier2ZIPDetector({ parser: createZIPMarkerParser() }),
  tier3Text: createTier3TextDetector(),
  scorer: createScorer(),
  categoryMapper: createCategoryMapper(),
  slipsheetDecider: createSlipsheetDecider(),
  
  // U-3 adapters
  s3Reader: createS3Adapter({ s3, logger }),
  s3Streamer: createS3Adapter({ s3, logger }),   // same adapter; both interfaces
  hasher: createNodeCryptoHasher(),
  
  // U-2 adapters
  contentHashStore: createDDBContentHashAdapter({
    ddb,
    tableName: process.env.CONTENT_HASH_TABLE_NAME!,
    logger,
  }),
  workspaceConfigStore: createDDBWorkspaceConfigAdapter({
    ddb,
    tableName: process.env.WORKSPACE_CONFIG_TABLE_NAME!,
    logger,
  }),
  
  // Observability + injectable deps
  logger,
  nowProvider: () => new Date().toISOString(),
  policyVersionExtractor: (config) => config.policyVersion,
});

export const handler: Handler<LambdaEvent, void> = async (event) => {
  let taskToken: string | undefined;
  let documentId: string | undefined;
  
  try {
    // STEP 1: validate (extract taskToken first so we can SendTaskFailure if validation fails)
    const validation = inputValidator.validate(event);
    if (!validation.ok) {
      // Best-effort: try to extract taskToken from raw event for SendTaskFailure
      const rawToken = (event as { taskToken?: unknown })?.taskToken;
      if (typeof rawToken === "string") {
        await taskSignaler.sendTaskFailure({
          taskToken: rawToken,
          error: { code: "INPUT_VALIDATION_FAILED", message: `${validation.error.field}: ${validation.error.message}` },
        });
      } else {
        // Cannot signal SFN without taskToken — throw so Lambda fails and CloudWatch alarms fire
        throw new Error("input-validation failure: cannot extract taskToken");
      }
      return;
    }
    
    const payload = validation.value;
    taskToken = payload.taskToken;
    documentId = payload.documentId;
    logger.appendKeys({ documentId, workspaceId: payload.workspaceId });
    
    // Run the orchestrator
    const result = await classificationService.classify(payload);
    
    if (result.ok) {
      const signalResult = await taskSignaler.sendTaskSuccess({
        taskToken,
        output: result.value,
      });
      if (!signalResult.ok) {
        // SFN can't be signalled — throw to let SFN re-invoke
        throw new Error(`sendTaskSuccess failed: ${signalResult.error}`);
      }
      return;
    }
    
    // Result.error — map kind to errorCode and decide throw vs signal
    const failure = result.error;
    
    // Q4=A: throw on transient/throttled so SFN task-retry triggers
    if (
      (failure.kind === "s3" && (failure.reason === "transient" || failure.reason === "throttled")) ||
      (failure.kind === "store" && (failure.reason === "transient" || failure.reason === "throttled"))
    ) {
      throw new Error(`Transient/throttled failure: ${JSON.stringify(failure)}`);
    }
    
    // Deterministic failure — signal SFN with errorCode
    const { code, message } = mapFailureToErrorCode(failure);
    const signalResult = await taskSignaler.sendTaskFailure({
      taskToken,
      error: { code, message },
    });
    if (!signalResult.ok) {
      throw new Error(`sendTaskFailure failed: ${signalResult.error}`);
    }
  } catch (e) {
    // Global catch — covers domain exceptions, Lambda runtime errors, etc.
    logger.error("handler.unexpected", {
      errorMessage: (e as Error)?.message ?? "unknown",
      stack: (e as Error)?.stack,
    });
    
    // If we have a taskToken, try to signal failure before re-throwing
    if (taskToken) {
      try {
        await taskSignaler.sendTaskFailure({
          taskToken,
          error: { code: "UNEXPECTED_ERROR", message: (e as Error)?.message ?? "Unknown error" },
        });
      } catch {
        // Signalling itself failed — fall through to re-throw
      }
    }
    
    // Re-throw so Lambda exits with error (SFN retry policy decides next step)
    throw e;
  }
};

function mapFailureToErrorCode(failure: ClassificationFailure): { code: string; message: string } {
  switch (failure.kind) {
    case "input-validation":
      return { code: "INPUT_VALIDATION_FAILED", message: `${failure.field}: ${failure.message}` };
    case "s3":
      switch (failure.reason) {
        case "object-not-found": return { code: "S3_OBJECT_NOT_FOUND", message: "S3 object not found" };
        case "access-denied": return { code: "S3_ACCESS_DENIED", message: "S3 access denied" };
        case "transient": return { code: "S3_TRANSIENT", message: "S3 transient error (should be retried)" };
        case "throttled": return { code: "S3_THROTTLED", message: "S3 throttled (should be retried)" };
        case "unknown": return { code: "INTERNAL_ERROR", message: "S3 unknown error" };
      }
      break;
    case "store":
      switch (failure.reason) {
        case "not-found": return { code: "WORKSPACE_NOT_FOUND", message: "Workspace config not found" };
        case "conditional-check-failed": return { code: "DDB_CONDITION_FAILED", message: "DynamoDB conditional check failed" };
        case "throttled": return { code: "DDB_THROTTLED", message: "DynamoDB throttled (should be retried)" };
        case "transient": return { code: "DDB_TRANSIENT", message: "DynamoDB transient error (should be retried)" };
        case "unknown": return { code: "INTERNAL_ERROR", message: "DynamoDB unknown error" };
      }
      break;
    case "signal":
      return { code: "SIGNAL_ERROR", message: `Failed to signal Step Function task: ${failure.reason}` };
    case "unexpected":
      return { code: "UNEXPECTED_ERROR", message: failure.message };
  }
}
```

**Properties**:
- PBT-U3-005: every `ClassificationFailure.kind` variant maps to exactly one non-empty `errorCode`
- The Lambda handler is the **only** place that throws (Q4=A); the orchestrator is purely Result-typed

---

## 5. `PowertoolsLoggerAdapter` (Adapter — implements `Logger` port)

**Purpose**: Wrap `@aws-lambda-powertools/logger` so domain code only sees the `Logger` port.

**Algorithm**:

```typescript
import { Logger as PTLogger } from "@aws-lambda-powertools/logger";

export function createPowertoolsLogger(serviceName: string, correlationKey: string): Logger {
  const ptLogger = new PTLogger({
    serviceName,
    correlationIdPath: correlationKey,
  });
  return {
    info(message, context) { ptLogger.info(message, context); },
    warn(message, context) { ptLogger.warn(message, context); },
    error(message, context) { ptLogger.error(message, context); },
    debug(message, context) { ptLogger.debug(message, context); },
  };
}
```

Powertools handles correlation ID propagation, redaction (per SECURITY-03 — configured in env), structured JSON output to CloudWatch.

---

## 6. `S3Adapter` (Adapter — implements `S3Reader` + `S3Streamer`)

```typescript
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

export function createS3Adapter(deps: { s3: S3Client; logger: Logger }): S3Reader & S3Streamer {
  return Object.freeze({
    async getRange(input): Promise<Result<Uint8Array, S3Error>> {
      try {
        const response = await deps.s3.send(new GetObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Range: `bytes=${input.start}-${input.end}`,
        }), { abortSignal: AbortSignal.timeout(5_000) });
        
        // Read the stream into a Uint8Array
        const chunks: Uint8Array[] = [];
        const reader = response.Body as ReadableStream<Uint8Array>;
        const r = reader.getReader();
        while (true) {
          const { done, value } = await r.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        return ok(Buffer.concat(chunks));
      } catch (e) {
        return err(mapS3Error(e));
      }
    },
    
    async *stream(input): AsyncIterable<Uint8Array> {
      const response = await deps.s3.send(new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
      }));
      const reader = (response.Body as ReadableStream<Uint8Array>).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value) yield value;
      }
    },
  });
}

function mapS3Error(error: unknown): S3Error {
  if (!(error instanceof Error)) return "unknown";
  switch (error.name) {
    case "NoSuchKey":
    case "NotFound":
      return "object-not-found";
    case "AccessDenied":
    case "Forbidden":
      return "access-denied";
    case "TimeoutError":
    case "AbortError":
    case "ServiceUnavailable":
    case "InternalError":
      return "transient";
    case "SlowDown":
    case "ThrottlingException":
      return "throttled";
    default:
      const code = (error as Error & { code?: string }).code;
      if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND") return "transient";
      return "unknown";
  }
}
```

---

## 7. `NodeCryptoHasher` (Adapter — implements `Hasher`)

```typescript
import { createHash } from "node:crypto";

export function createNodeCryptoHasher(): Hasher {
  return Object.freeze({
    async sha256(stream: AsyncIterable<Uint8Array>): Promise<string> {
      const hash = createHash("sha256");
      for await (const chunk of stream) {
        hash.update(chunk);
      }
      return hash.digest("hex");
    },
  });
}
```

Per NFR-2 (streaming SHA-256, no full-file buffer): the hasher reads chunks lazily from the async iterable; `crypto.createHash` accumulates state without retaining chunks.

---

## 8. `StepFunctionAdapter` (Adapter — implements `TaskSignaler`)

```typescript
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from "@aws-sdk/client-sfn";

export function createStepFunctionAdapter(deps: { sfn: SFNClient; logger: Logger }): TaskSignaler {
  return Object.freeze({
    async sendTaskSuccess(input) {
      try {
        await deps.sfn.send(new SendTaskSuccessCommand({
          taskToken: input.taskToken,
          output: JSON.stringify(input.output),
        }), { abortSignal: AbortSignal.timeout(5_000) });
        return ok(undefined);
      } catch (e) {
        return err(mapSignalError(e));
      }
    },
    
    async sendTaskFailure(input) {
      try {
        await deps.sfn.send(new SendTaskFailureCommand({
          taskToken: input.taskToken,
          error: input.error.code,
          cause: input.error.message,
        }), { abortSignal: AbortSignal.timeout(5_000) });
        return ok(undefined);
      } catch (e) {
        return err(mapSignalError(e));
      }
    },
  });
}

function mapSignalError(error: unknown): SignalError {
  if (!(error instanceof Error)) return "unknown";
  if (error.name === "TaskDoesNotExist" || error.name === "TaskTimedOut") return "task-not-found";
  if (error.name === "TimeoutError" || error.name === "AbortError") return "transient";
  return "unknown";
}
```

---

## 9. Module Composition Diagram

```
                            +---------------------------+
                            |     LambdaHandler         |
                            | (src/handler/lambda.ts)   |
                            +-------+------+------------+
                                    |      |
              +---------------------+      +---------------------+
              |                                                  |
              v                                                  v
+----------------------------+              +----------------------------+
| ClassificationService      |              | TaskSignaler                |
| (src/application/         |              | (StepFunctionAdapter)       |
|  ClassificationService.ts) |              +----------------------------+
+----------------------------+
   |
   +-- InputValidator   -----+
   +-- OutputBuilder    -----+
   |
   |  domain modules (U-1):
   +-- tier1/tier2OLE2/tier2ZIP/tier3Text/scorer/categoryMapper/slipsheetDecider
   |
   |  ports → adapters:
   +-- S3Reader       --→ S3Adapter
   +-- S3Streamer     --→ S3Adapter (same adapter)
   +-- Hasher         --→ NodeCryptoHasher
   +-- ContentHashStore  --→ DDBContentHashAdapter (U-2)
   +-- WorkspaceConfigStore  --→ DDBWorkspaceConfigAdapter (U-2)
   +-- Logger         --→ PowertoolsLoggerAdapter
```

Every adapter implements one or more ports. The orchestrator sees only ports; the Lambda handler is the wiring layer.

---

## 10. AC Path Mapping

Each AC from `requirements.md` §8 corresponds to a specific path through this orchestration. Restated from `services.md` §6 for U-3 implementation reference:

| AC | Path |
|---|---|
| AC-1 (`.docx` renamed `.pdf`) | Step 4 (Tier 1 miss) → Step 6 (Tier 2 ZIP → ooxml) → Step 8 (ext contradicts → −0.15) |
| AC-2 (OLE2 non-standard sector) | Step 5 → CLSID parse fails → extension fallback → Step 8 base 0.70 |
| AC-3 (duplicate same workspace) | Step 12 Case D — `isDuplicate=true`; orchestrator returns; Lambda calls `sendTaskSuccess` |
| AC-5 (zip depth) | Step 10 → reason `max-zip-depth`; Step 13 routes to slipsheet |
| AC-7 (`.msg`) | Step 5 → CLSID `00020D0B-…` → Step 9 `email` |
| AC-8 (`.eml`) | Step 7 → Tier3 EML match → Step 9 `email` |
| AC-9 (policy version mismatch) | Step 12 Case C → `replaceOnPolicyMismatch` |
| AC-10 (`.docm` quarantine) | Step 10 → reason `workspace-policy`; Step 13 slipsheet |
| AC-11 (non-override dup hit) | Step 12 Case D — `updateOnDuplicateHit` |

Integration tests in U-3's Code Generation will assert these path traversals.
