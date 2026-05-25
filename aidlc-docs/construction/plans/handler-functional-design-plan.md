# Functional Design Plan — U-3 `handler`

> Per-unit Construction stage 1/5. U-3 is the **orchestration unit** — it composes U-1's domain logic with U-2's persistence into the §4.1→§4.2 classification pipeline, plus owns the S3/SFN/Powertools adapters. Detailed business logic lives mostly in `services.md` (the 13-step flow) and `application-design/components.md`; this stage resolves the remaining ambiguities specific to error mapping, validation, output construction, and observability wiring.
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

---

## A. Functional Design Questions

### Question 1 — Zod schema strictness for `TaskPayload` validation
The Step Function may send extra fields we don't know about (forward compatibility) or omit required ones (bug). Choose the schema strictness:

A) **Strict on required + passthrough on unknowns** — every field in §4.1 schema is required and typed; unknown extra fields are silently dropped. Pragmatic for forward compatibility.

B) **Strict on both** — every field required; unknown fields cause `Result.error("input-validation", "unexpected-field-X")`. Catches caller bugs but blocks forward-compat upgrades.

C) **Loose on extras + lenient on missing** — defaults applied for missing optional fields; unknown extras kept. Hides bugs.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Strict on required fields catches caller bugs at the entry point (the orchestrator's first defense). Passthrough on unknowns means a future Step Function State Machine version can add fields (e.g., `priorityHint`) without breaking us — the AWS-recommended pattern for evolving message schemas. Option B blocks forward compatibility for marginal benefit (we'd never *use* the extra field anyway since the validator strips it). Zod's `.passthrough()` mode is the natural fit; alternatively `.strict()` for some sub-objects where shape evolution is unlikely (e.g., `s3`).

### Question 2 — Failure path mapping: orchestrator step → ClassificationFailure kind
Each of the 13 orchestration steps from `services.md` can fail. Confirm or refine the error-mapping table:

A) **Accept the proposed table below** (Section A.2.1) — every step maps to exactly one `ClassificationFailure` kind, with `not-found`/`object-not-found`/`access-denied`/`input-validation` getting their own discriminators.

B) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The table covers every step's failure modes with explicit mapping. The `ClassificationFailure` discriminated union has the right granularity — distinct kinds for input-validation (caller-fault), s3 errors (subdivided by reason), store errors (subdivided), signal errors, and `unexpected` for catches. The orchestrator's caller (Lambda handler) uses these to drive `SendTaskFailure` payloads with appropriate `errorCode`s.

#### A.2.1 — Proposed Failure Mapping Table

| Step | Failure source | `ClassificationFailure.kind` | Lambda handler maps to `SendTaskFailure errorCode` |
|---|---|---|---|
| 1 validate-input | Zod validation | `input-validation` (with `field` + `message`) | `INPUT_VALIDATION_FAILED` |
| 2 load-workspace-config | `WorkspaceConfigStore` returns Result.error | `store` (with `reason`) | `WORKSPACE_NOT_FOUND` (on `not-found`) or `INTERNAL_ERROR` |
| 3 read-detection-window | `S3Reader` returns Result.error | `s3` (with `reason`) | `S3_OBJECT_NOT_FOUND`, `S3_ACCESS_DENIED`, or `INTERNAL_ERROR` |
| 4–7 detect tiers | (pure logic never fails) | — | — |
| 8 score | (pure) | — | — |
| 9 map-category | (pure; null result → orchestrator routes to slipsheet) | — | — |
| 10 decide-slipsheet | (pure) | — | — |
| 11 stream-hash | `S3Streamer` or `Hasher` errors | `s3` (for stream) or `unexpected` (for hasher) | `INTERNAL_ERROR` |
| 12 dedup-decision | `ContentHashStore` returns Result.error | `store` (with `reason`) | (orchestrator-internal: retry on transient/throttled by throwing; other errors → `INTERNAL_ERROR`) |
| 13 build-output | (pure) | — | — |
| Lambda entry-point catch | Unhandled exception in any step | `unexpected` (with `message`) | `UNEXPECTED_ERROR` |
| `TaskSignaler.sendTaskFailure` itself fails | Lambda throws to let SFN re-invoke | (not a `ClassificationFailure`) | (caught at Lambda entry — Lambda exits with error) |

### Question 3 — `OutputBuilder` slipsheet/category fall-through semantics
When `Tier1/2/3` all miss AND no extension fallback applies, the orchestrator produces a slipsheet result. Should the output payload still carry a "best-effort" `detectedFormat`?

A) **Best-effort fields when slipsheeting**:
   - `detectedFormat`: null when truly no detection succeeded; the last-attempted tier's reasoning is captured only in logs (per SECURITY-03 redaction policy)
   - `detectionTier`: the last tier that ran (e.g., `"text-heuristic"` if Tier3 ran but produced `matched:false`)
   - `confidenceScore`: the final score after modifiers (often `0.0` for no-match path)
   - `slipsheetReason`: always set (per FR-8.1)

B) **Null all detection fields** when slipsheeting due to no-match — only `slipsheetReason` and structural metadata survive. Slipsheet branch (US-DB-004) gets less to render.

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: US-DB-004 ("Consume slipsheet payloads with full reason + context") explicitly says the slipsheet branch needs `detectedFormat` best-effort + `confidenceScore` to render an explanatory placeholder. Nulling everything (B) would force the slipsheet branch to re-derive context. The "best-effort" framing matches Q6=B from Requirements (Standard slipsheet payload).

### Question 4 — Retry coordination: when does the orchestrator throw vs return Result.error?
The Lambda handler converts orchestrator results to either `SendTaskSuccess` (Result.ok) or `SendTaskFailure` (most Result.error variants). But some failures should instead **throw** so the Step Function task-retry layer re-invokes the Lambda (per Q9=C of Requirements). Choose the throw/return discrimination:

A) **Throw on `transient` and `throttled`; return Result.error for everything else**. SDK retries already attempted (within `maxAttempts: 3`); when they exhaust, we want SFN's task retry to take a second pass with a fresh Lambda container. All deterministic errors (`input-validation`, `s3.object-not-found`, `store.conditional-check-failed`, `unexpected`) become `SendTaskFailure` immediately.

B) Throw on every error — let SFN retry decide. Wastes retry budget on non-retryable errors.

C) Return Result.error always; never throw. Loses the two-layer retry benefit.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The two-layer retry from Requirements Q9=C is the load-bearing answer; option A operationalises it. Transient/throttled errors are the only ones where re-invocation has a chance of succeeding (the underlying AWS service was momentarily unavailable). Input validation, conditional-check-failed, S3 NotFound — none of these become better on retry. Option B is wasteful; option C abandons the SFN retry layer.

### Question 5 — Powertools wiring: per-step subsegment naming + metric emission
The 13 orchestration steps each merit observability instrumentation. Choose the convention:

A) **X-Ray subsegment per step + EMF metric on every step's outcome**:
   - Subsegment name: `classify.step<N>.<step-name>` (e.g., `classify.step4.detect-tier1`)
   - EMF metric: `ClassificationStepDuration` (Unit: Milliseconds, Dimensions: `step,outcome,workspaceId`)
   - One log entry per step entry/exit (debug level by default; per Pattern P-2-4 logging convention from U-2)

B) **One subsegment for the whole `classify`** + metrics only at the boundary (start, success, failure). Less observability surface; cheaper.

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Per-step instrumentation matches NFR-7 ("structured logs sufficient to reconstruct the tier-by-tier decision for any document") and SECURITY-14 ("alerting on high-value events"). The added overhead is sub-millisecond per step (Powertools is lazy-evaluated). The granularity lets US-SRE-001 reconstruct any classification from logs alone and US-SRE-003 inspect per-step metrics. Option B fails NFR-7 — a "classification step 6 took 4500ms" anomaly would be invisible.

### Question 6 — PBT property catalogue for U-3 (PBT-01 mandatory)
U-3 has more I/O and less pure logic than U-1 or U-2. Most behaviour is verified by integration tests (which compose the real adapters against LocalStack). Confirm the catalogue:

A) **Accept the proposed 5-property catalogue below** (Section A.6.1). PBT focuses on the few genuinely pure parts of U-3: input validation roundtrip, output schema invariants, slipsheet output construction.

B) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: U-3's PBT scope is intentionally narrow because most of U-3's value is in I/O orchestration, which integration tests verify better than property tests. The 5 properties cover the algorithmic edges that LocalStack tests can't easily hit (e.g., the OutputBuilder's `slipsheetReason !== null iff isForcedSlipsheet` invariant; the InputValidator's strict-on-required-fields contract). PBT-01 satisfied.

#### A.6.1 — Proposed PBT Property Catalogue for U-3

| ID | Module | Category | Property | PBT rule |
|---|---|---|---|---|
| PBT-U3-001 | `InputValidator` | Round-trip | `validate(JSON.parse(JSON.stringify(validPayload)))` returns Result.ok with deep-equal payload | PBT-02 |
| PBT-U3-002 | `InputValidator` | Invariant | For any payload missing a required field, `validate(...)` returns Result.error with kind=`input-validation` | PBT-03 |
| PBT-U3-003 | `OutputBuilder` | Invariant | `slipsheetReason !== null` iff `isForcedSlipsheet === true` in the built §4.2 payload | PBT-03 |
| PBT-U3-004 | `OutputBuilder` | Invariant | `subCategory !== null` only when `category === "convert"` | PBT-03 |
| PBT-U3-005 | `ClassificationFailure → errorCode` mapping | Totality | Every variant of `ClassificationFailure.kind` maps to exactly one non-empty `errorCode` string in `SendTaskFailure` | PBT-03 |

---

## B. Generation Checklist (executes after plan approval)

### Phase 1 — Domain Entities
- [x] B1. Create `aidlc-docs/construction/handler/functional-design/domain-entities.md`:
  - U-3 entity index (most entities live elsewhere — U-1 shared types, U-2 stores; this lists what U-3 owns)
  - `ClassificationFailure` discriminated union with full variant enumeration (`input-validation`, `s3`, `store`, `signal`, `unexpected`)
  - `ClassificationOutput` shape (already in `component-methods.md` — restated)
  - `ClassificationServiceDeps` shape (the orchestrator's full dep set)
  - `LambdaHandler` entry-point contract
  - Per-step input/output type-flow diagram

### Phase 2 — Business Logic Model
- [x] B2. Create `aidlc-docs/construction/handler/functional-design/business-logic-model.md`:
  - **`InputValidator.validate`** — Zod schema + passthrough strategy (Q1=A); error mapping to `ClassificationFailure.input-validation`
  - **`ClassificationService.classify`** — the 13-step orchestration with per-step error mapping (Q2=A) inline at each step
  - **`OutputBuilder.build`** — §4.2 payload construction with slipsheet output semantics (Q3=A)
  - **`LambdaHandler` (entry-point)** — dependency-wiring + retry coordination (Q4=A: throw on transient/throttled; return for deterministic errors) + `ClassificationFailure → errorCode` mapping table
  - **`PowertoolsLoggerAdapter`** — wraps Powertools Logger behind the `Logger` port
  - **`S3Adapter`** — implements `S3Reader` + `S3Streamer` against AWS S3 SDK v3
  - **`NodeCryptoHasher`** — implements `Hasher` via streaming SHA-256
  - **`StepFunctionAdapter`** — implements `TaskSignaler` against AWS SFN SDK v3
  - Pseudocode + module composition diagrams per module

### Phase 3 — Business Rules
- [x] B3. Create `aidlc-docs/construction/handler/functional-design/business-rules.md`:
  - Universal rules (validation upfront; Result-type plumbing throughout; never throw from business logic — only at Lambda entry handler converts to throw conditionally per Q4=A)
  - Input validation rules (strict on required, passthrough on unknown, per Q1=A)
  - Orchestration ordering rules (steps 1→13 strict; never skip; tier early-exit per `services.md`)
  - Output construction rules (slipsheet best-effort field policy per Q3=A; subCategory only when category=convert per Q3=A)
  - Retry coordination rules (throw on transient/throttled per Q4=A; return Result.error otherwise)
  - Observability rules (per-step Powertools instrumentation per Q5=A; never log sensitive content; correlation ID = documentId)
  - PBT property catalogue (the 5 properties from A.6.1)
  - SECURITY-05 input-validation compliance (every external input goes through Zod)
  - SECURITY-15 fail-safe rules (global try/catch at Lambda entry; UNEXPECTED_ERROR for anything not specifically mapped)

### Phase 4 — Validation
- [x] B4. Verify every U-3 component has a defined algorithm specification.
- [x] B5. Verify all 5 PBT properties map to specific assertions.
- [x] B6. Verify the per-step failure mapping table is complete.

### Phase 5 — Wrap-up
- [x] B7. Update `aidlc-docs/aidlc-state.md` — U-3 Functional Design marked Completed.
- [x] B8. Update `aidlc-docs/audit.md`.
- [x] B9. Present the 2-option completion message.

---

## C. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part B executes without further questions until the standardized 2-option completion message.
