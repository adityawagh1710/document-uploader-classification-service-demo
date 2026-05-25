# Services — Classification Service

> Per Q9=A: a **single `ClassificationService` orchestrator** composes the domain modules + ports into the linear classification flow. This file describes the orchestration sequence, where ports are called, where retries are caught, and where failures fan out.

---

## Service Inventory

There is exactly **one** application service:

| ID | Service | Layer | Unit |
|---|---|---|---|
| S-01 | `ClassificationService` | application | handler |

Domain modules (Tier1/Tier2/Tier3 detectors, Scorer, CategoryMapper, SlipsheetDecider) are **not services** — they are pure functions hidden behind component factories. They are called *by* the service.

The `LambdaHandler` (S-04) is the runtime entry point, not a service — it constructs the dependency graph and delegates to `ClassificationService.classify`.

---

## `ClassificationService.classify` — Orchestration Sequence

The orchestrator runs a linear flow with explicit early-exit at the tier boundary. Each step is named for traceability in logs (per NFR-7).

```
classify(payload: TaskPayload): Promise<Result<ClassificationOutput, ClassificationFailure>>
  │
  ├─ STEP 1  validate-input
  │        InputValidator.validate(payload) → unwrap or fail with kind:"input-validation"
  │
  ├─ STEP 2  load-workspace-config
  │        WorkspaceConfigStore.get(payload.workspaceId)
  │          → returns WorkspaceConfig { policyVersion, threshold, maxZipDepth,
  │                                       quarantineMacros, slipsheetRules, hashTtlDays }
  │
  ├─ STEP 3  read-detection-window
  │        S3Reader.getRange({ bucket, key, start: 0, end: 4099 })
  │          → 4,100-byte buffer (or whatever bytes exist if object is smaller)
  │
  ├─ STEP 4  detect-tier1
  │        Tier1FileTypeDetector.detect(buffer)
  │          → if matched: capture { format, mime, matchType: "exact-unique-signature" }
  │          → if not matched: continue to STEP 5
  │
  ├─ STEP 5  detect-tier2-ole2
  │        ONLY IF buffer starts with OLE2 signature D0 CF 11 E0 A1 B1 1A E1
  │        Tier2OLE2Detector.detect(buffer, extension)
  │          → matched (clsid present): capture { format, matchType: "ole2-with-clsid" }
  │          → matched (extension fallback): capture { format, matchType: "ole2-or-zip-ext-fallback" }
  │          → not matched: continue
  │
  ├─ STEP 6  detect-tier2-zip
  │        ONLY IF buffer starts with ZIP signature 50 4B 03 04 AND no Tier 2 OLE2 result
  │        Tier2ZIPDetector.detect(buffer)
  │          → matched OOXML/ODF: capture { format, matchType: "zip-with-ooxml-or-odf" }
  │          → matched plain ZIP: capture { format: "zip", matchType: "exact-unique-signature" }
  │
  ├─ STEP 7  detect-tier3-text
  │        ONLY IF no result from any prior tier
  │        Tier3TextDetector.detect(buffer)
  │          → matched: capture { format, matchType: "text-heuristic" }
  │          → not matched: capture { format: null, matchType: "no-match" }
  │
  ├─ STEP 8  score
  │        Scorer.score({ matchType, detectedFormat, extension, contentType })
  │          → score ∈ [0, 1]
  │
  ├─ STEP 9  map-category
  │        IF detectedFormat is set:
  │          CategoryMapper.map(detectedFormat, detectionTier) → { category, subCategory }
  │        ELSE:
  │          { category: "slipsheet", subCategory: null }  (no detection → slipsheet by default)
  │
  ├─ STEP 10 decide-slipsheet
  │        SlipsheetDecider.decide({
  │          score, threshold, detectedFormat,
  │          parentArchiveDepth, maxZipDepth,
  │          quarantineMacros, slipsheetRules
  │        }) → { slipsheet, reason }
  │
  │        IF slipsheet:
  │          override category := "slipsheet"
  │          set isForcedSlipsheet := true
  │          set slipsheetReason := reason
  │
  ├─ STEP 11 stream-hash
  │        contentHash := Hasher.sha256( S3Streamer.stream({ bucket, key }) )
  │          (streaming — never buffers the full object per NFR-2)
  │
  ├─ STEP 12 dedup-decision
  │        existingRecord := ContentHashStore.get({ workspaceId, contentHash })
  │
  │        CASE A — no existing record:
  │            ContentHashStore.putIfAbsent(record) [conditional write]
  │            isDuplicate := false
  │
  │        CASE B — record exists, override flag set:
  │            isDuplicate := true (echo override behaviour per Q15=C)
  │            DO NOT update the record
  │            DO NOT short-circuit — pipeline continues per FR-7 #4
  │
  │        CASE C — record exists, policyVersion mismatches current config.policyVersion:
  │            ContentHashStore.replaceOnPolicyMismatch(record)  [self-heal]
  │            isDuplicate := false
  │
  │        CASE D — record exists, policyVersion matches, override flag NOT set:
  │            ContentHashStore.updateOnDuplicateHit({ ..., now })   [increment hitCount + lastSeenAt]
  │            isDuplicate := true
  │            short-circuit downstream (the §4.2 payload will carry isDuplicate=true so PO knows)
  │
  └─ STEP 13 build-output
           OutputBuilder.build({
             classification: { format, category, subCategory, confidenceScore, detectionTier,
                               isForcedSlipsheet, slipsheetReason },
             dedup: { contentHash, isDuplicate },
             documentId, workspaceId, policyVersion
           })
           → Result.ok(ClassificationOutput)
```

The Lambda handler (S-04) then calls `TaskSignaler.sendTaskSuccess({ taskToken, output })` on `Result.ok`, or `TaskSignaler.sendTaskFailure({ taskToken, error: { code, message } })` on `Result.error`.

---

## Where retries live

| Layer | What retries | How |
|---|---|---|
| **AWS SDK clients (S3, DDB, SFN)** | Transient network / 5xx / throttling | SDK v3 standard retry mode, max 3 attempts, exponential backoff (configured at adapter construction) |
| **Step Function task definition** | Lambda invocation failure (timeout, OOM, init failure, unhandled exception) | State Machine's `Retry` block on the task — the classifier is idempotent (NFR-5 + Step 12 conditional writes) so re-invocation is safe |
| **Application code** | None | Two SDK + State Machine layers are sufficient; the orchestrator never wraps retries itself |

This is Q9=C from `requirement-verification-questions.md`. The classifier handler is naturally idempotent because:
1. `S3Reader.getRange` is read-only.
2. `Hasher.sha256` is pure given the same byte stream.
3. `ContentHashStore.putIfAbsent` uses `ConditionExpression: attribute_not_exists(contentHash)` — a re-run after a successful first run is a no-op (Case A → Case D path).
4. `WorkspaceConfigStore.get` is read-only.

---

## Where failures fan out (Q2=B mixed style)

| Failure source | Path |
|---|---|
| **Expected outcomes (Result.ok with NoMatch / extension fallback)** | Stay inside the orchestration; never throw. Logged as `info` or `debug`. |
| **`InputValidator` returns Result.error** | Orchestrator returns `Result.error({ kind: "input-validation", … })`. Lambda handler converts to `SendTaskFailure` with `errorCode="INPUT_VALIDATION_FAILED"` (per SECURITY-05). |
| **`S3Reader.getRange` returns `S3Error="object-not-found"`** | Orchestrator returns `Result.error({ kind: "s3", reason: "object-not-found" })`. Lambda handler converts to `SendTaskFailure` with `errorCode="S3_OBJECT_NOT_FOUND"`. |
| **`S3Error="transient"` / `"throttled"`** | SDK retries exhausted → orchestrator returns `Result.error({ kind: "s3", reason: "transient" })`. Lambda handler **throws** so Step Function task retry can re-invoke. |
| **`StoreError` from DDB** | Same pattern: `conditional-check-failed` is recoverable (re-read + decide), `throttled`/`transient` after SDK retries → Lambda handler throws for Step Function retry. |
| **Unexpected exception in domain code** | Caught by `LambdaHandler` global try/catch. Logged with full context. Converted to `SendTaskFailure` with `errorCode="UNEXPECTED_ERROR"` (fail-closed per SECURITY-15). |

---

## Observability hooks per step

`Logger` (P-07) and the Powertools Tracer wrap each step:

- **Logger.info** is emitted with `{ documentId, workspaceId, step, tier, format?, score?, hitCount? }` at the start and end of each step.
- **Powertools Tracer** opens a subsegment per STEP (`detect-tier1`, `stream-hash`, `dedup-decision`, …) so X-Ray traces show per-step latency.
- **Powertools Metrics** emits EMF custom metrics: one count per emitted `category`, one count per `detectionTier`, latency histograms by step.

Logged context **never** includes raw S3 bytes, raw input payloads (only field names / sizes), or secrets (per SECURITY-03).

---

## Acceptance-criteria mapping

Each AC from `requirements.md` §8 corresponds to a path through the orchestration above:

| AC | Path |
|---|---|
| AC-1 (`.docx` renamed `.pdf`) | STEP 4 (Tier 1 detects `docx` via ZIP+OOXML markers) → STEP 8 applies −0.15 ext-contradiction modifier → STEP 9 maps to `convert / office` |
| AC-2 (OLE2 non-standard sector size) | STEP 5 → `OLE2Parser` returns `Result.error("non-standard-sector-size")` → fallback path → matchType `ole2-or-zip-ext-fallback` → STEP 8 base 0.70 |
| AC-3 (duplicate same workspace) | STEP 12 Case D — short-circuit with `isDuplicate=true` |
| AC-4 (same file, different workspaces) | STEP 12 Case A in each workspace — partition key isolates |
| AC-5 (`parentArchiveDepth = maxZipDepth`) | STEP 10 `SlipsheetDecider` → reason `max-zip-depth` |
| AC-6 (score = threshold exactly) | STEP 10 `score > threshold` rule fails → reason `low-confidence` |
| AC-7 (`.msg`) | STEP 5 → CLSID `00020D0B-…` → STEP 9 `email` |
| AC-8 (`.eml`) | STEP 4 + STEP 5 + STEP 6 all miss → STEP 7 `Tier3TextDetector` detects EML → STEP 9 `email` |
| AC-9 (policyVersion mismatch) | STEP 12 Case C — `replaceOnPolicyMismatch` |
| AC-10 (`.docm` with `quarantineMacros=true`) | STEP 10 → reason `workspace-policy` |
| AC-11 (non-override dup hit) | STEP 12 Case D — `updateOnDuplicateHit` increments `hitCount` + `lastSeenAt` |
