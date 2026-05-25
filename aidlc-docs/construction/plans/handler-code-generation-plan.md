# Code Generation Plan — U-3 `handler`

> Per-unit Construction stage 5/5. This plan is the source of truth for U-3's code generation. U-3 is the **largest unit** by file count: ~45 files covering 4 new ports, 4 adapters, 5 application components, the Lambda entry, SAM template, bundle smoke check, and extensive test scaffolding (8 unit + 1 PBT + 16 integration + 1 smoke + 1 perf).

---

## 1. Unit Context

### 1.1 Stories Owned by U-3
- **US-PO-001..004** (4 stories) — Pipeline Orchestrator-facing
- **US-WO-001, 002, 003, 005** (4 stories) — Workspace Operator-facing
- **US-DI-001, 002, 004** (3 stories) — Document Ingestion Owner-facing
- **US-DB-001..005** (5 stories) — Downstream Branch-facing
- **US-SD-001, 003, 005** (3 stories) — Service Developer-facing (local dev + integration + smoke)
- **US-SRE-001, 002** (2 stories) — On-Call SRE-facing

**21 stories owned by U-3 in total**. U-2's 2 stories already closed; U-1's 4 stories already closed.

### 1.2 Dependencies and Boundary
- New runtime deps: `@aws-sdk/client-s3@3.654.0`, `@aws-sdk/client-sfn@3.654.0`, `zod@3.23.8` (all exact-pinned); `@aws-lambda-powertools/{logger,metrics,tracer}@^2.10.0` (caret)
- New dev deps: `@types/aws-lambda@^8.10.142`
- Imports from U-1: domain modules + shared types + Logger port
- Imports from U-2: `ContentHashStore`, `WorkspaceConfigStore` ports + DDB adapters + DDB client factory
- Exports: 4 new ports + `ClassificationService` + the Lambda handler

### 1.3 Service Boundaries
- `src/application/**` may import from `src/domain/**`, `src/ports/**`, `src/shared/**` — NOT from `src/adapters/**`
- `src/adapters/{s3,crypto,step-functions,powertools}/**` may import AWS SDK + Powertools + `src/ports/**` + `src/shared/**`
- `src/handler/**` is the only place that imports `src/adapters/**`
- `tests/**` may import anywhere

---

## 2. Code Generation Steps

> Each step has a `[ ]` checkbox. Mark `[x]` immediately on completion.

### Phase 1 — Project Configuration Updates

- [x] **Step 1.1** Update `package.json`: add new runtime deps + dev dep; add `test:smoke` + `verify-bundle` scripts.
- [x] **Step 1.2** Update `vitest.config.ts`: append U-3 coverage thresholds (75% on application/handler; 80% on most adapters; 95% on crypto).
- [x] **Step 1.3** Update `.eslintrc.cjs`: add override for `src/application/**` (no `Date`/`performance` globals; `Date.now`/`Math.random` forbidden); add override for `src/handler/**` (relaxed — wiring layer).

### Phase 2 — New Ports

- [x] **Step 2.1** Create `src/ports/S3Reader.ts` — `S3Reader` interface + `S3Error` union.
- [x] **Step 2.2** Create `src/ports/S3Streamer.ts` — `S3Streamer` interface (re-exports `S3Error` from `S3Reader`).
- [x] **Step 2.3** Create `src/ports/Hasher.ts` — `Hasher` interface.
- [x] **Step 2.4** Create `src/ports/TaskSignaler.ts` — `TaskSignaler` interface + `SignalError` union.

### Phase 3 — Adapters

- [x] **Step 3.1** Create `src/adapters/s3/types.ts` + `S3Adapter.ts` + `map-s3-error.ts` + `index.ts`.
- [x] **Step 3.2** Create `src/adapters/crypto/NodeCryptoHasher.ts` + `index.ts`.
- [x] **Step 3.3** Create `src/adapters/step-functions/StepFunctionAdapter.ts` + `map-signal-error.ts` + `index.ts`.
- [x] **Step 3.4** Create `src/adapters/powertools/PowertoolsLoggerAdapter.ts` + `index.ts`.

### Phase 4 — Application Components

- [x] **Step 4.1** Create `src/application/types.ts` — `ClassificationFailure` discriminated union + `ClassificationOutput` + `ClassificationServiceDeps` + `DetectionState` interfaces.
- [x] **Step 4.2** Create `src/application/InputValidator.ts` — Zod schema + factory.
- [x] **Step 4.3** Create `src/application/OutputBuilder.ts` — `OutputBuilder` factory enforcing slipsheet invariants.
- [x] **Step 4.4** Create `src/application/run-step.ts` — `runStep` instrumentation helper (Pattern P-3-4).
- [x] **Step 4.5** Create `src/application/map-failure-to-error-code.ts` — total switch over `ClassificationFailure.kind` (PBT-U3-005).
- [x] **Step 4.6** Create `src/application/ClassificationService.ts` — the 13-step orchestrator with sub-procedures (`detectInSequence`, `dedupDecide`, `deriveFinalFormat`, `classifyStreamError`).
- [x] **Step 4.7** Create `src/application/index.ts` — barrel export.

### Phase 5 — Lambda Handler Entry

- [x] **Step 5.1** Create `src/handler/lambda.ts` — module-level singleton wiring + the `handler` export per Pattern P-3-7.

### Phase 6 — SAM Local Configuration

- [x] **Step 6.1** Create `template.yaml` at repo root — SAM template for local smoke testing per Pattern P-3-2.

### Phase 7 — Bundle Smoke Check

- [x] **Step 7.1** Create `scripts/verify-bundle.sh` — shell script per Pattern P-3-3.

### Phase 8 — Unit Tests

- [x] **Step 8.1** Create `tests/unit/handler/input-validator.test.ts` — Zod schema strict-required + passthrough behaviour.
- [x] **Step 8.2** Create `tests/unit/handler/output-builder.test.ts` — slipsheet invariants + unknown-format fallback.
- [x] **Step 8.3** Create `tests/unit/handler/map-failure-to-error-code.test.ts` — totality on every kind.
- [x] **Step 8.4** Create `tests/unit/handler/run-step.test.ts` — instrumentation helper success + error paths.
- [x] **Step 8.5** Create `tests/unit/handler/adapters/s3-adapter.test.ts` — `mapS3Error` totality.
- [x] **Step 8.6** Create `tests/unit/handler/adapters/crypto-hasher.test.ts` — streaming SHA-256 with known-answer tests.
- [x] **Step 8.7** Create `tests/unit/handler/adapters/step-function-adapter.test.ts` — `mapSignalError` totality.
- [x] **Step 8.8** Create `tests/unit/handler/adapters/powertools-logger-adapter.test.ts` — passthrough verification.

### Phase 9 — PBT Tests

- [x] **Step 9.1** Create `tests/pbt/generators/handler.gen.ts` — generators for `TaskPayload`, `ClassificationFailure`, `BuildOutputInput`.
- [x] **Step 9.2** Create `tests/pbt/handler.test.ts` — PBT-U3-001..005 implementations.

### Phase 10 — Integration Tests (End-to-end)

- [x] **Step 10.1** Create `tests/integration/handler/_orchestrator-setup.ts` — shared deps factory using real U-1 + U-2 components + LocalStack-backed adapters.
- [x] **Step 10.2** Create `tests/integration/handler/ac-3-duplicate-same-workspace.test.ts` — AC-3 verification.
- [x] **Step 10.3** Create `tests/integration/handler/ac-4-cross-workspace-isolation.test.ts` — AC-4.
- [x] **Step 10.4** Create `tests/integration/handler/ac-6-score-at-threshold.test.ts` — AC-6.
- [x] **Step 10.5** Create `tests/integration/handler/ac-9-policy-version-mismatch.test.ts` — AC-9.
- [x] **Step 10.6** Create `tests/integration/handler/ac-10-docm-quarantine.test.ts` — AC-10.
- [x] **Step 10.7** Create `tests/integration/handler/ac-11-non-override-hit-count.test.ts` — AC-11.
- [x] **Step 10.8** Create `tests/integration/handler/edge-cases/unknown-format-slipsheet.test.ts` — BR-3-OUT-3 fallback.
- [x] **Step 10.9** Create `tests/integration/handler/edge-cases/override-flag-immutable-record.test.ts` — BR-3-O-5 Case B.

(AC-1, AC-2, AC-5, AC-7, AC-8 require real binary fixtures committed under `tests/fixtures/`; for U-3's Code Generation we generate synthetic-binary-driven equivalents using the PBT generators where possible, and document real-fixture requirements in `code-summary.md` for a follow-up commit.)

### Phase 11 — Smoke Test

- [x] **Step 11.1** Create `tests/smoke/handler.smoke.test.ts` — SAM Local invocation against LocalStack.

### Phase 12 — Perf Bench Extension

- [x] **Step 12.1** Create `tests/perf/handler.bench.ts` — end-to-end classify() bench against LocalStack with synthetic 1MB document.

### Phase 13 — Test Fixtures

- [x] **Step 13.1** Update `tests/fixtures/manifest.ts` — confirm AC-1/AC-7/AC-8 entries are defined; document where real binaries should be committed (out of code-gen scope).

### Phase 14 — Documentation

- [x] **Step 14.1** Create `aidlc-docs/construction/handler/code/code-summary.md` — file inventory + story completion + implementation notes + open items (real binary fixtures, U-4 handoff).

---

## 3. Story Closure on Completion

| Story | Closed via |
|---|---|
| US-PO-001..004 | Lambda handler + ClassificationService + integration tests |
| US-WO-001..003, 005 | Orchestrator passes workspace-config to domain modules; integration tests exercise (when fixtures committed) |
| US-DI-001, 002, 004 | Integration tests for cross-workspace isolation + slipsheet output |
| US-DB-001..005 | OutputBuilder enforces §4.2 schema; integration tests assert per-category payload shape |
| US-SD-001 | `npm run dev` invocation (documented in README; no new script needed since the Lambda handler can be invoked directly) |
| US-SD-003 | Integration tests run against LocalStack |
| US-SD-005 | Smoke test via SAM Local |
| US-SRE-001, 002 | Structured logging via Powertools + nowProvider determinism |

---

## 4. Scope Estimate

- **~18 source files** under `src/` (4 ports + 4 adapter directories with 2–4 files each + 6 application files + 1 handler)
- **~22 test files** under `tests/` (8 unit + 2 PBT + 9 integration + 1 smoke + 1 perf + 1 manifest update)
- **~3 config / scripts** (package.json, vitest.config.ts, .eslintrc.cjs, template.yaml, verify-bundle.sh)
- **1 documentation file**
- **Total**: ~45 new / updated files

---

## 5. Approval Gate

After review, the user explicitly approves this plan. Then Part 2 executes the steps in order.
