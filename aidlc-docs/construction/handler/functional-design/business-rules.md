# Business Rules — U-3 `handler`

> All handler-layer rules: input validation, orchestration ordering, output construction, retry coordination, observability, fail-safe defaults, and the PBT property catalogue.

---

## 1. Universal Rules

| Rule ID | Rule | Source |
|---|---|---|
| BR-3-1 | Application code (orchestrator + helpers) returns `Result<T, ClassificationFailure>`; never throws. Only `LambdaHandler` (entry-point) throws — conditionally per BR-3-RT (retry coordination) | Q4=A + BR-5 |
| BR-3-2 | The orchestrator never calls `Date.now()` directly — uses injected `nowProvider()` for testability and determinism | NFR-5 |
| BR-3-3 | All external inputs (Lambda event) flow through `InputValidator` before any orchestrator logic touches them | SECURITY-05 |
| BR-3-4 | Adapters are stateless; ports are interfaces; no direct AWS SDK imports outside `src/adapters/**` and `src/handler/lambda.ts` | Hexagonal (Application Design Q1=A) |
| BR-3-5 | Every adapter and orchestrator method instruments observability per Pattern P-2-4 (Q5=A): debug start/end + error structured context, no PII in logs | NFR-7, SECURITY-03 |

---

## 2. Input Validation Rules (BR-3-V-*)

### BR-3-V-1 — Strict on required + passthrough on unknowns (Q1=A)
- Zod schema declares every §4.1 field; missing required field → Result.error
- `.passthrough()` on the top-level schema (and on objects where forward-compat matters) silently drops unknown extra fields
- Validation runs ONCE at Lambda entry; downstream code receives typed `TaskPayload`

### BR-3-V-2 — Validation errors carry field + message
- `ClassificationFailure.input-validation` contains `field` (dotted path, e.g., `"s3.bucket"`) and `message` (Zod's user-readable explanation)
- Used by `mapFailureToErrorCode` to build `SendTaskFailure` with `code: "INPUT_VALIDATION_FAILED"` and `cause: "${field}: ${message}"`

### BR-3-V-3 — String fields must be non-empty
- `taskToken`, `workspaceId`, `documentId`, `s3.bucket`, `s3.key` all use `z.string().min(1)`
- Empty strings are caller bugs; validation catches them at entry

### BR-3-V-4 — Numeric bounds
- `context.parentArchiveDepth: z.number().int().min(0)` — non-negative integer

---

## 3. Orchestration Ordering Rules (BR-3-O-*)

### BR-3-O-1 — Strict 13-step sequence
The orchestrator runs steps 1→13 in order. Early-exit on tier match is internal to step grouping (4–7); no step can be skipped at the orchestration level.

### BR-3-O-2 — Tier-early-exit semantics
- Step 4 (Tier 1) runs always; on match, Steps 5–7 are skipped
- Step 5 (Tier 2 OLE2) runs only if buffer starts with OLE2 signature; on match, Steps 6–7 skipped
- Step 6 (Tier 2 ZIP) runs only if buffer starts with ZIP signature AND Tier 2 OLE2 did not match; on match, Step 7 skipped
- Step 7 (Tier 3 text) runs only if no prior tier matched

### BR-3-O-3 — Pure-step determinism
Steps 4–10 are pure functions. The orchestrator must call them with their declared inputs and treat their outputs as the source of truth. No retries on pure steps (they cannot fail).

### BR-3-O-4 — Step 11 stream-hash always runs
Even when classification produces no match, we still need `contentHash` for the dedup table. The hash is computed from the full S3 object stream (NFR-2 streaming).

### BR-3-O-5 — Step 12 dedup-decision uses the 4-case flow
Per `services.md` §1 STEP 12, the orchestrator implements Cases A/B/C/D exactly:
- Case A: no existing record → `putIfAbsent`
- Case B: override flag → continue without DDB write
- Case C: policyVersion mismatch → `replaceOnPolicyMismatch`
- Case D: clean duplicate → `updateOnDuplicateHit`

### BR-3-O-6 — Step 13 output construction enforces invariants
`OutputBuilder.build` is the single source of `ClassificationOutput`; it enforces the slipsheet + subCategory invariants (PBT-U3-003, PBT-U3-004).

---

## 4. Output Construction Rules (BR-3-OUT-*)

### BR-3-OUT-1 — Slipsheet payload completeness (Q3=A, US-DB-004)
When `isForcedSlipsheet === true`:
- `category === "slipsheet"`
- `subCategory === null`
- `slipsheetReason` is one of `"workspace-policy" | "max-zip-depth" | "low-confidence"`
- `detectedFormat` is best-effort: the last tier's `detectedFormat` if any, else `"unknown"`
- `detectionTier` is the last tier that ran (not `"extension-fallback"` unless extension-fallback actually ran)
- `confidenceScore` is the post-modifier value, even if it's zero

### BR-3-OUT-2 — Non-slipsheet payload
When `isForcedSlipsheet === false`:
- `slipsheetReason === null`
- `category` comes from `CategoryMapper.map(format, tier)`; if null, falls into the slipsheet path (BR-3-OUT-3)
- `subCategory` is `null` unless `category === "convert"`

### BR-3-OUT-3 — Unknown format fallback
If `CategoryMapper.map(format, tier)` returns `null` (format not in FR-6 table):
- Route to slipsheet with `slipsheetReason: "low-confidence"`
- This is the unique case where the orchestrator overrides `SlipsheetDecider`'s decision

### BR-3-OUT-4 — Discriminated invariant
- PBT-U3-003: `slipsheetReason !== null` ⟺ `isForcedSlipsheet === true`
- PBT-U3-004: `subCategory !== null` only when `category === "convert"`

---

## 5. Retry Coordination Rules (BR-3-RT-*) — Q4=A

### BR-3-RT-1 — Throw on transient/throttled
`LambdaHandler` THROWS (causes Lambda to exit with error → SFN task-retry triggers) when:
- `ClassificationFailure.kind === "s3"` and `reason ∈ {"transient", "throttled"}`
- `ClassificationFailure.kind === "store"` and `reason ∈ {"transient", "throttled"}`
- `TaskSignaler.sendTaskSuccess` or `sendTaskFailure` returns `Result.error` (signal layer itself can't succeed)
- Any unhandled exception in the entry-point's try block

### BR-3-RT-2 — Return SendTaskFailure for deterministic errors
For all other failure variants, the Lambda handler signals SFN with `sendTaskFailure({ taskToken, error: { code, message } })`:
- `input-validation` → `INPUT_VALIDATION_FAILED`
- `s3.object-not-found` → `S3_OBJECT_NOT_FOUND`
- `s3.access-denied` → `S3_ACCESS_DENIED`
- `s3.unknown` → `INTERNAL_ERROR`
- `store.not-found` → `WORKSPACE_NOT_FOUND`
- `store.conditional-check-failed` → `DDB_CONDITION_FAILED`
- `store.unknown` → `INTERNAL_ERROR`
- `unexpected` → `UNEXPECTED_ERROR`

### BR-3-RT-3 — SDK retry layer is the first defence
AWS SDK clients (S3, DDB, SFN) use `retryMode: "standard"` with `maxAttempts: 3`. Most transient blips absorb at this layer; only when retries exhaust do they surface to the orchestrator → handler → SFN task retry.

### BR-3-RT-4 — Idempotency by construction
The orchestrator is idempotent under re-invocation:
- S3 reads are pure-read
- SHA-256 is deterministic
- `putIfAbsent` is conditional — second attempt is a no-op (`"already-existed"`)
- `WorkspaceConfigStore.get` is read-only
- This means SFN task retry is safe (no double-write hazards)

### BR-3-RT-5 — `mapFailureToErrorCode` is total (PBT-U3-005)
Every `ClassificationFailure.kind` variant maps to exactly one non-empty `errorCode`. The mapping uses exhaustive switch (TypeScript narrowing catches additions at compile time).

---

## 6. Observability Rules (BR-3-OBS-*)

### BR-3-OBS-1 — Per-step Powertools instrumentation (Q5=A)
Every orchestration step opens a tracer subsegment named `classify.step<N>.<step-name>`, emits an EMF metric `ClassificationStepDuration` with dimensions `(step, outcome, workspaceId)`, and logs structured entry/exit at debug level.

### BR-3-OBS-2 — Correlation ID propagation
The Powertools Logger is configured with `correlationIdPath: "documentId"`. All log entries in a single invocation carry the same `documentId` for trace correlation.

### BR-3-OBS-3 — Sensitive content redaction (SECURITY-03)
Adapters NEVER log:
- Raw S3 bytes
- Full request/response payloads from SFN (only field names, sizes, error codes)
- Workspace policy details (only the `policyVersion` string)
- DDB record contents (only operation outcome + duration)

### BR-3-OBS-4 — Errors always emit structured context
`logger.error(...)` calls include `errorCode`, `sdkErrorName` (when applicable), `durationMs`, plus context-specific keys (`workspaceId`, `documentId`, `step`).

### BR-3-OBS-5 — Custom metrics (US-SRE-003)
The handler emits these EMF custom metrics:
- `ClassificationOk` (Count) dimensioned by `category`, `detectionTier`, `workspaceId`
- `ClassificationStepDuration` (Milliseconds) dimensioned by `step`, `outcome`, `workspaceId`
- `WorkspaceConfigStore.NotFound.Count` (Count) dimensioned by `workspaceId` (when `not-found` triggers)

---

## 7. Fail-Safe Default Rules (BR-3-FS-*) — SECURITY-15

### BR-3-FS-1 — Global try/catch at Lambda entry
The Lambda handler has a top-level `try/catch` that converts any uncaught exception to `{ code: "UNEXPECTED_ERROR" }` and best-effort signals via `sendTaskFailure` (if `taskToken` was extractable) before re-throwing.

### BR-3-FS-2 — Failed signals re-throw
If `TaskSignaler.sendTaskFailure` itself fails (network/SFN unavailable), the Lambda handler throws. Lambda exits with error; SFN's retry policy decides next step.

### BR-3-FS-3 — Unknown format → slipsheet, never silent
Per BR-3-OUT-3, an unknown detected format does NOT silently advance with `category: "convert", subCategory: null`. The orchestrator routes to `slipsheet` with `slipsheetReason: "low-confidence"`.

### BR-3-FS-4 — Validation failure can short-circuit before any state read
If the input event is missing `workspaceId` / `documentId` / `s3.bucket` / etc., validation fails BEFORE any S3 read or DDB call. No state is mutated.

### BR-3-FS-5 — Taskless failure path
If validation fails AND we can't extract `taskToken` from the raw event, the handler throws. The Step Function State Machine itself has timeout/error handling that catches this (CloudWatch alarms fire).

---

## 8. PBT Property Catalogue (PBT-01 satisfaction)

The 5 properties from `handler-functional-design-plan.md` §A.6.1, restated:

| ID | Module | Category | Property | PBT rule |
|---|---|---|---|---|
| PBT-U3-001 | `InputValidator` | Round-trip | `validate(JSON.parse(JSON.stringify(validPayload)))` returns Result.ok with deep-equal payload | PBT-02 |
| PBT-U3-002 | `InputValidator` | Invariant | For any payload missing a required field, `validate(...)` returns Result.error with kind=`input-validation` | PBT-03 |
| PBT-U3-003 | `OutputBuilder` | Invariant | `slipsheetReason !== null` ⟺ `isForcedSlipsheet === true` in built output | PBT-03 |
| PBT-U3-004 | `OutputBuilder` | Invariant | `subCategory !== null` only when `category === "convert"` | PBT-03 |
| PBT-U3-005 | `mapFailureToErrorCode` | Totality | Every `ClassificationFailure.kind` variant → non-empty `errorCode` | PBT-03 |

All 5 are pure-function tests; no LocalStack needed for PBT.

---

## 9. SECURITY Compliance Map for U-3

| Rule | How U-3 satisfies |
|---|---|
| SECURITY-03 (app logging) | Powertools Logger with structured JSON, correlation ID = documentId, redaction rules in BR-3-OBS-3 |
| SECURITY-05 (input validation) | Zod schema in `InputValidator` is the only entry path; runs before any state read (BR-3-V-1) |
| SECURITY-06 (least-privilege IAM) | Handler's IAM role enumerated in U-4 Infrastructure Design: S3 GetObject on specific bucket; SFN SendTask* on specific State Machine; DDB perms inherited from U-2 |
| SECURITY-08 (object-level auth) | Implicit via `workspaceId` partition key in U-2's adapter calls; orchestrator passes `workspaceId` from validated payload |
| SECURITY-09 (hardening) | Error messages in `SendTaskFailure` are generic (no stack traces); production logs redact PII |
| SECURITY-10 (supply chain) | All AWS SDK packages exact-pinned in `package.json`; SDK errors don't leak credentials in log output |
| SECURITY-11 (secure design) | Hexagonal layer separation: orchestrator depends on ports, not AWS SDK directly; layered defence: SDK retry → SFN retry → SendTaskFailure |
| SECURITY-13 (data integrity) | Result-typed plumbing prevents partially-applied state changes; conditional writes in DDB (inherited from U-2) |
| SECURITY-14 (alerting) | Custom EMF metrics enable per-category / per-step / per-failure-rate alarms (defined in U-4) |
| SECURITY-15 (fail-safe) | Global try/catch (BR-3-FS-1); all error paths produce structured failures, never silent advancement (BR-3-FS-3); validation upstream (BR-3-FS-4) |

---

## 10. Cross-cutting Reminders

- **The Lambda handler is the only throwing site** — orchestrator and helpers use `Result<T, E>`
- **Powertools is wrapped in the `Logger` port** — domain code (U-1) never sees Powertools directly
- **All `Date.now()` calls flow through `nowProvider`** — per NFR-5 determinism
- **The 13-step flow is the contract** — never reordered, never collapsed; new logic goes between existing steps with explicit instrumentation
