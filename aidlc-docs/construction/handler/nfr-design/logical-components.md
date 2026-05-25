# Logical Components — U-3 `handler`

> Per-component NFR-role + pattern + satisfaction. Includes **test infrastructure as first-class** (SAM template, bundle smoke check, end-to-end integration test suite, smoke test).

---

## 1. Source Components (under `src/`)

### 1.1 New Ports (under `src/ports/`)

| Component | NFR Role | Pattern Embodied | NFR Satisfaction |
|---|---|---|---|
| `S3Reader` | Port — ranged read of S3 object | Result-type plumbing (U-1 P-1) | NFR-1, SECURITY-15 |
| `S3Streamer` | Port — streaming read for hash | Result/AsyncIterable (U-1 P-1) | NFR-2 |
| `Hasher` | Port — streaming SHA-256 | Pure-function determinism (U-1 P-3) | NFR-2, NFR-5 |
| `TaskSignaler` | Port — SFN callbacks | Result-type plumbing | FR-9, SECURITY-15 |

### 1.2 Adapters (under `src/adapters/`)

| Component | NFR Role | Pattern Embodied | NFR Satisfaction |
|---|---|---|---|
| `S3Adapter` | Implements `S3Reader` + `S3Streamer` via AWS SDK v3 S3 | P-2-1 (shared client), P-2-5 (timeout 5s for S3), P-2-7 (mapS3Error pattern) | NFR-1, NFR-2, SECURITY-06, 15 |
| `NodeCryptoHasher` | Implements `Hasher` via `node:crypto` streaming | Pure-function determinism | NFR-2, NFR-5 |
| `StepFunctionAdapter` | Implements `TaskSignaler` via SDK v3 SFN | P-2-1, P-2-5, P-2-7 + mapSignalError | FR-9, SECURITY-06, 15 |
| `PowertoolsLoggerAdapter` | Implements `Logger` port via `@aws-lambda-powertools/logger` | P-2-4 (logging granularity) | NFR-7, SECURITY-03 |

### 1.3 Application Layer (under `src/application/`)

| Component | NFR Role | Pattern Embodied | NFR Satisfaction |
|---|---|---|---|
| `ClassificationService` | The 13-step orchestrator | P-3-4 (runStep helper) + P-3-5 (nowProvider) + Result plumbing | All FRs, NFR-1..3, NFR-5..9 |
| `InputValidator` | Zod-based input validation | Pure-function determinism + Result | SECURITY-05, BR-3-V-* |
| `OutputBuilder` | §4.2 payload construction with invariants | Pure-function determinism + discriminated-narrowing | FR-9, BR-3-OUT-*, PBT-U3-003/004 |
| `mapFailureToErrorCode` | Total switch over `ClassificationFailure.kind` | Exhaustive switch (U-1 P-2) | SECURITY-15, PBT-U3-005 |
| `runStep` helper | Per-step instrumentation | P-3-4 | NFR-7, NFR-8 |

### 1.4 Handler Entry (under `src/handler/`)

| Component | NFR Role | Pattern Embodied | NFR Satisfaction |
|---|---|---|---|
| `lambda.ts` | Lambda entry-point | P-3-1 (module-load wiring) + P-3-7 (graceful exit + best-effort signal) | SECURITY-15, BR-3-FS-* |

---

## 2. Configuration Components

### 2.1 `template.yaml` (SAM Local)

```yaml
# (skeleton; full version in Pattern P-3-2)
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Resources:
  ClassificationFunction:
    Type: AWS::Serverless::Function
    Properties:
      Runtime: nodejs20.x
      Architectures: [arm64]
      MemorySize: 512
      Timeout: 30
      CodeUri: ./dist
      Handler: lambda.handler
      Environment:
        Variables:
          LOG_LEVEL: DEBUG
          POWERTOOLS_DEV: "true"
          # … per Pattern P-3-2
```

### 2.2 `scripts/verify-bundle.sh` (Bundle Smoke Check)

Shell script per Pattern P-3-3. CI step: `npm run verify-bundle`.

### 2.3 `.eslintrc.cjs` (Updated for U-3)

```javascript
// Append to existing overrides:
{
  files: ["src/application/**/*.ts"],
  rules: {
    "no-restricted-globals": ["error",
      { name: "Date", message: "Use injected nowProvider() — NFR-5 determinism." },
      { name: "performance", message: "Pure logic; pass timing as input if needed." },
    ],
    "no-restricted-properties": ["error",
      { object: "Date", property: "now", message: "Use nowProvider()." },
      { object: "Math", property: "random", message: "Inject random source." },
    ],
  },
},
{
  files: ["src/handler/**/*.ts"],
  rules: {
    // Handler may use `new Date()` (it's where nowProvider is constructed)
    "no-restricted-globals": "off",
  },
},
```

### 2.4 `vitest.config.ts` (Updated for U-3)

Appended thresholds per NFR Reqs §2.4:

```typescript
"src/application/**":              { branches: 75, functions: 75, lines: 75, statements: 75 },
"src/handler/**":                  { branches: 75, functions: 75, lines: 75, statements: 75 },
"src/adapters/s3/**":              { branches: 80, functions: 80, lines: 80, statements: 80 },
"src/adapters/crypto/**":          { branches: 95, functions: 95, lines: 95, statements: 95 },
"src/adapters/step-functions/**":  { branches: 80, functions: 80, lines: 80, statements: 80 },
"src/adapters/powertools/**":      { branches: 75, functions: 75, lines: 75, statements: 75 },
```

---

## 3. Test Infrastructure Components

### 3.1 Integration Test Files (Pattern P-3-6)

Per Q6=A — 11 ACs + 4 edge cases + 1 shared setup file = 16 integration files (NEW for U-3, on top of U-2's 2 adapter integration files).

```
tests/integration/handler/
├── _orchestrator-setup.ts                   shared deps factory for handler tests
├── ac-1-docx-renamed-pdf.test.ts             AC-1: real .docx renamed to .pdf
├── ac-2-ole2-nonstandard-sector.test.ts      AC-2: extension fallback at 0.70
├── ac-3-duplicate-same-workspace.test.ts     AC-3: isDuplicate=true short-circuit
├── ac-4-cross-workspace-isolation.test.ts    AC-4: same file, different workspaces both proceed
├── ac-5-zip-max-depth.test.ts                AC-5: forced slipsheet with max-zip-depth reason
├── ac-6-score-at-threshold.test.ts           AC-6: score=threshold → slipsheet low-confidence
├── ac-7-msg.test.ts                          AC-7: MSG via OLE2 CLSID
├── ac-8-eml.test.ts                          AC-8: EML via text heuristic
├── ac-9-policy-version-mismatch.test.ts      AC-9: replaceOnPolicyMismatch path
├── ac-10-docm-quarantine.test.ts             AC-10: workspace-policy slipsheet
├── ac-11-non-override-hit-count.test.ts      AC-11: hitCount increments
└── edge-cases/
    ├── esc-byte-text-eligible.test.ts        BR-T-1 (ESC excluded from binary set)
    ├── ooxml-conservative-default.test.ts    format-mappers default behaviour
    ├── unknown-format-slipsheet.test.ts      BR-3-OUT-3 fallback
    └── override-flag-immutable-record.test.ts BR-3-O-5 Case B
```

### 3.2 PBT Files

```
tests/pbt/handler.test.ts          PBT-U3-001..005 (5 properties)
tests/pbt/generators/handler.gen.ts  generators for TaskPayload, ClassificationFailure, etc.
```

### 3.3 Unit Test Files

```
tests/unit/handler/
├── input-validator.test.ts        Zod schema strict-required + passthrough behaviour
├── output-builder.test.ts         slipsheet invariants + unknown-format fallback
├── map-failure-to-error-code.test.ts  totality on every kind
├── run-step.test.ts               instrumentation helper assertions
└── adapters/
    ├── s3-adapter.test.ts         mapS3Error totality
    ├── crypto-hasher.test.ts      streaming SHA-256 + known-answer tests
    ├── step-function-adapter.test.ts  mapSignalError totality
    └── powertools-logger-adapter.test.ts  passthrough to Powertools API
```

### 3.4 Smoke Test File

```
tests/smoke/handler.smoke.test.ts  SAM Local invocation against LocalStack
```

### 3.5 Perf Test (extension of U-1's `tests/perf/`)

```
tests/perf/handler.bench.ts        end-to-end classify() bench against LocalStack
                                    — synthetic 1MB doc; assert p99 ≤ 3s
                                    — synthetic 20MB doc; assert p99 ≤ 15s
```

---

## 4. CI Workflow Components (logical — materialised in U-4)

Updated CI manifest (extends U-1 + U-2's gates):

| CI Job | Trigger | Tool | Gate |
|---|---|---|---|
| `lint` | every PR | ESLint | Zero errors |
| `typecheck` | every PR | `tsc --noEmit` | Zero errors |
| `test-unit` | every PR | `vitest run tests/unit` | All pass |
| `test-pbt` | every PR | `vitest run tests/pbt tests/regression` | All pass |
| `test-integration` | every PR | `vitest run tests/integration` | All pass; needs Docker |
| `test-smoke` (NEW) | PRs touching `src/handler/**` | `vitest run tests/smoke` | All pass; needs Docker + SAM CLI |
| `coverage` | every PR | `vitest run --coverage` | Per-dir thresholds met |
| `bench` | PRs touching `src/domain/**` or `src/application/**` | `vitest bench --run` | Per-bench budget met |
| `verify-bundle` (NEW) | After `cdk synth` | `scripts/verify-bundle.sh` | Bundle ≤ 5MB + handler export present |
| `supply-chain` | every PR + nightly | `npm audit --omit=dev` | Zero high/critical |

---

## 5. NFR ↔ Component Coverage Matrix

| NFR / SECURITY / PBT rule | Components that satisfy it |
|---|---|
| NFR-1 (ranged GET ≤ 4,100 bytes) | `S3Adapter.getRange` (passes `end: 4099`); integration test `ac-1` exercises |
| NFR-2 (streaming SHA-256) | `S3Streamer.stream` (AsyncIterable, never buffers) + `NodeCryptoHasher` (chunk-by-chunk) |
| NFR-3 (4,100-byte window fixed) | Orchestrator Step 3 passes the constant; constant defined in `src/shared/constants.ts` |
| NFR-5 (determinism) | `nowProvider` injection (Pattern P-3-5); ESLint `no-restricted-globals` on `src/application/**` |
| NFR-6 (config-driven) | `requireEnv` helper (Pattern P-3-1); workspace config from `WorkspaceConfigStore.get` |
| NFR-7 (structured logs) | `PowertoolsLoggerAdapter` + `runStep` helper (Pattern P-3-4) |
| NFR-8 (CloudWatch + X-Ray) | `runStep` emits EMF metrics + X-Ray subsegments; Lambda tracing config in CDK (U-4) |
| NFR-9 (one invocation per task) | Lambda handler signature is `Handler<unknown, void>`; SFN map state config in U-4 |
| Latency budget (Q3 of NFR Reqs) | `tests/perf/handler.bench.ts`; CloudWatch alarm on Lambda Duration (U-4) |
| SECURITY-03 (logging) | `POWERTOOLS_LOGGER_LOG_EVENT=false` env var; Pattern P-2-4 logging granularity |
| SECURITY-05 (input validation) | `InputValidator` + Zod schema |
| SECURITY-06 (least-privilege IAM) | NFR Reqs §2.5 documented; U-4 implements |
| SECURITY-08 (object-level auth) | Orchestrator passes validated `workspaceId` to U-2; partition key isolation |
| SECURITY-10 (supply chain) | Exact-pinned AWS SDK + Zod; caret-pinned Powertools; `npm audit` gate |
| SECURITY-13 (data integrity) | Result-typed plumbing + conditional DDB writes (inherited from U-2) |
| SECURITY-14 (alerting) | EMF custom metrics from `runStep`; CloudWatch alarms in U-4 |
| SECURITY-15 (fail-safe) | Pattern P-3-7 graceful exit + best-effort signal; global try/catch |
| PBT-U3-001..005 | `tests/pbt/handler.test.ts` |

Every applicable rule has a named component. No gaps.

---

## 6. Open Items for Subsequent Stages

| Item | Stage |
|---|---|
| Concrete `cdk-nag` suppression code blocks for the 2 AWS-managed policies | Infrastructure Design (U-4) |
| Per-environment env-var values in CDK | Infrastructure Design (U-4) |
| CloudWatch alarm definitions (Duration p99 by size class, Errors, Throttles) | Infrastructure Design (U-4) |
| `infra/lib/lambda-stack.ts` CDK construct (consumes Lambda Function config + IAM policy from NFR Reqs) | Infrastructure Design (U-4) |
| State Machine ARN parameter resolution (currently passed via env var) | Infrastructure Design (U-4) |
| Binary fixtures for AC-1, AC-7, AC-8 (real `.docx`, `.msg`, `.eml` files committed under `tests/fixtures/`) | Code Generation (U-3) |
| `aws-sam-cli` install in CI runner | Infrastructure Design (U-4) — GitHub Actions setup |
