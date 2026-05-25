# NFR Requirements — U-3 `handler`

> Per-NFR applicability for the orchestrator + Lambda entry-point unit + locked decisions + SECURITY/PBT compliance + CI quality gates.

---

## 1. Per-NFR Applicability for U-3

U-3 is the unit that materially intersects with the most NFRs from `requirements.md` §3, since it owns the Lambda runtime, the S3 I/O surface, the streaming SHA-256 path, the Step Function callback, and the observability wiring.

| NFR | Applies to U-3? | Concrete meaning for U-3 |
|---|---|---|
| NFR-1 (ranged GET ≤ 4,100 bytes) | **Yes — core** | `S3Adapter.getRange` issues the ranged GET; orchestrator Step 3 is the only call site |
| NFR-2 (streaming SHA-256, no full-file buffer) | **Yes — core** | `S3Streamer.stream` + `NodeCryptoHasher` work together; orchestrator Step 11 never buffers full file |
| NFR-3 (4,100-byte detection window fixed) | **Yes — core** | The orchestrator passes `end: 4099` to `S3Reader.getRange`; never reads more |
| NFR-4 (workspace isolation in DDB) | Inherited | DDB workspace isolation enforced by U-2; U-3 just passes `workspaceId` from validated payload |
| NFR-5 (determinism per input tuple) | **Yes** | Orchestrator injects `nowProvider` for testability; the pure paths (input validation, output building, error mapping) are deterministic |
| NFR-6 (config-driven thresholds) | **Yes** | Threshold/maxZipDepth/quarantineMacros/slipsheetRules/hashTtlDays all come from `workspaceConfigStore.get()` via input dep |
| NFR-7 (structured tier-by-tier logs) | **Yes — core** | Per-step Powertools logging + EMF metrics + X-Ray subsegments per Q5=A |
| NFR-8 (CloudWatch metrics + X-Ray) | **Yes — core** | Powertools wiring; emitted by U-3; U-4 builds dashboards/alarms on top |
| NFR-9 (one invocation per task) | **Yes** | Lambda handler signature is one event per call; Q11=A (Requirements) confirmed; SFN map state controls concurrency |
| NFR-10 (per-workspace TTL) | Inherited | U-2's adapter writes `expiresAt`; U-3 just passes `hashTtlDays` through `buildContentHashRecord` (called within `dedupDecide`) |

**Summary**: U-3 directly owns NFRs 1, 2, 3, 5, 6, 7, 8, 9. NFR-4 and NFR-10 are inherited from U-2's adapter behaviour.

---

## 2. Locked NFR Decisions for U-3

### 2.1 Lambda Configuration — Q1=A + Q2=A

| Setting | Value | Source |
|---|---|---|
| Memory | **512 MB** | Q1=A — ~30% vCPU, ample network for streaming hash |
| Timeout | **30 seconds** | Q1=A — well above p99 happy path (~2s); below typical SFN task timeout |
| Architecture | **ARM64** | U-1 Infrastructure Design (cost + perf) |
| Runtime | **nodejs20.x** | Service-level decision (Application Design Q7=A) |
| Reserved concurrency (prod) | **100** | Q2=A — safety bound against runaway invocations |
| Reserved concurrency (dev/staging) | **None** (unlimited) | Q2=A |

### 2.2 End-to-end Latency Budget — Q3=A (bifurcated)

| Document size | p99 budget |
|---|---|
| ≤ 10 MB | **≤ 3 seconds** |
| > 10 MB | **≤ 15 seconds** |

**Enforcement**:
- CloudWatch alarm on Lambda `Duration` metric per size class (size-class dimension emitted as a custom metric by the orchestrator)
- Integration test perf assertion uses synthetic 1 MB document → expect ≤ 3 s on LocalStack
- A separate manual perf test against a real AWS environment exercises the > 10 MB path

### 2.3 SDK + Powertools Configuration — Q4=A + Q5=A

**SDK retry**: All AWS SDK clients (S3, DDB inherited, SFN) use `retryMode: "standard"` with `maxAttempts: 3`. SDK + SFN task retry are the two layers per Requirements Q9=C.

**Powertools env-vars** (locked production defaults):

| Env Var | Value | Why |
|---|---|---|
| `LOG_LEVEL` | `INFO` | Quiet steady-state; tunable per Lambda instance to `DEBUG` for incidents |
| `POWERTOOLS_SERVICE_NAME` | `classification-service` | Identifies emitted logs/metrics/traces |
| `POWERTOOLS_METRICS_NAMESPACE` | `ClassificationService` | Custom namespace prevents collision with other services |
| `POWERTOOLS_LOGGER_LOG_EVENT` | `false` | **Critical** — prevents `taskToken` (credential-like value) from leaking to CloudWatch per SECURITY-03 |
| `POWERTOOLS_DEV` | `false` (prod), `true` (local dev only) | Production must use structured JSON output, not pretty-printed |
| `POWERTOOLS_LOGGER_SAMPLE_RATE` | `0.01` | 1% of INFO-level logs include debug context — allows incident investigation without doubling log volume |

### 2.4 Coverage Targets — Q6=A

| Directory | Threshold | Rationale |
|---|---|---|
| `src/application/**` | **75% branch** | Pure functions reach 95%+; orchestrator's I/O branches mostly verified by integration tests |
| `src/handler/**` | **75% branch** | Entry point is mostly module-level wiring; tested by integration + smoke |
| `src/adapters/s3/**` | **80% branch** | Matches U-2's adapter target |
| `src/adapters/crypto/**` | **95% branch** | Pure helper |
| `src/adapters/step-functions/**` | **80% branch** | Matches U-2 |
| `src/adapters/powertools/**` | **75% branch** | Wrapper; tested by integration logs |

### 2.5 IAM Scope (for U-4) — Q7=A

**Lambda execution role permission set:**

| Source | Action | Resource | Notes |
|---|---|---|---|
| Inline policy | `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem` | `content-hashes` table ARN | Inherited from U-2 |
| Inline policy | `dynamodb:GetItem` | `workspace-config` table ARN | Inherited from U-2 |
| Inline policy | `s3:GetObject` | `${documentBucketArn}/*` | NEW — U-3 specific |
| Inline policy | `states:SendTaskSuccess`, `states:SendTaskFailure` | Specific State Machine ARN | NEW — U-3 specific |
| Managed policy | `AWSLambdaBasicExecutionRole` (logs) | (managed) | AWS-blessed; `cdk-nag` suppression `AwsSolutions-IAM4` documented |
| Managed policy | `AWSXRayDaemonWriteAccess` (X-Ray) | (managed) | AWS-blessed; `cdk-nag` suppression documented |

**Actions explicitly NOT granted**: `s3:ListBucket`, `s3:PutObject`, `s3:DeleteObject`, `s3:GetBucketLocation`, `states:StartExecution`, `states:DescribeExecution`, `iam:*`, `dynamodb:Scan`, `dynamodb:Query`, `dynamodb:DeleteItem`, `lambda:*`.

`cdk-nag` rule `AwsSolutions-IAM5` passes (no wildcard resources). `AwsSolutions-IAM4` warns on the 2 managed policies → both have documented suppressions.

---

## 3. SECURITY Compliance for U-3 (at this stage)

| Rule | Status for U-3 | Notes |
|---|---|---|
| SECURITY-01 (encryption at rest & in transit) | **Inherited (U-4)** | S3 + DDB SSE via U-4; TLS for all SDK calls (default) |
| SECURITY-02 (network access logs) | N/A | No LB / API Gateway / CDN |
| SECURITY-03 (app-level logging) | **Yes** | Powertools Logger configured; `LOG_EVENT=false` prevents taskToken leakage; structured JSON; correlation ID = documentId |
| SECURITY-04 (HTTP headers) | N/A | No HTML-serving endpoints |
| SECURITY-05 (input validation) | **Yes** | Zod schema in `InputValidator` is the single entry path; BR-3-FS-4 ensures validation runs before any state read |
| SECURITY-06 (least-privilege IAM) | **Yes (Q7=A)** | Per-resource per-action; 2 AWS-managed policies with documented suppressions; no wildcards |
| SECURITY-07 (restrictive network) | **Justified deviation (inherited)** | Lambda outside VPC per U-1 Infrastructure Design Q4=B; documented |
| SECURITY-08 (app-level access control) | **Yes** | Object-level auth implicit via `workspaceId` partition key; orchestrator passes validated `workspaceId` only |
| SECURITY-09 (hardening) | **Yes** | Error messages in `SendTaskFailure` are generic (no stack traces); secrets only via env vars (table names; not credentials — those come from IAM role) |
| SECURITY-10 (supply chain) | **Yes** | All `@aws-sdk/*` exact-pinned; Powertools caret-pinned (patch-only); inherited `npm audit` gate |
| SECURITY-11 (secure design) | **Yes** | Hexagonal layer separation; layered defence (SDK retry → SFN retry → SendTaskFailure); abuse case (ZIP-bomb depth) handled by U-1 + U-2 + orchestrator's `parentArchiveDepth` validation |
| SECURITY-12 (auth/credentials) | **N/A** | Service-to-service via IAM role; no user-level credentials |
| SECURITY-13 (data integrity) | **Yes** | Result-typed plumbing prevents partially-applied state; CloudWatch Logs serve as audit trail; conditional DDB writes inherited from U-2 |
| SECURITY-14 (alerting & monitoring) | **Yes (locked)** | Custom EMF metrics emitted; CloudWatch alarms defined in U-4 |
| SECURITY-15 (fail-safe defaults) | **Yes** | Global try/catch at Lambda entry (BR-3-FS-1); all error paths produce structured failures, never silent advancement (BR-3-FS-3); validation upstream (BR-3-FS-4); taskless failure throws so CloudWatch alarms fire (BR-3-FS-5) |

**Blocking findings**: none. The SECURITY-07 deviation is documented and inherited; the 2 managed-policy exceptions are documented.

---

## 4. PBT Compliance for U-3 (at this stage)

| Rule | Status for U-3 | Notes |
|---|---|---|
| PBT-01 (property identification at functional design) | **Compliant** | 5 properties (PBT-U3-001..005) enumerated in `business-rules.md` §8 |
| PBT-02 (round-trip) | **Compliant — design** | PBT-U3-001 (InputValidator JSON round-trip) |
| PBT-03 (invariant) | **Compliant — design** | PBT-U3-002 (strict-on-required), 003 (slipsheetReason invariant), 004 (subCategory invariant), 005 (errorCode totality) |
| PBT-04 (idempotence) | **N/A** | Orchestrator is idempotent at the integration level (BR-3-RT-4); no internal idempotence property to test in isolation |
| PBT-05 (oracle) | **N/A** | No reference implementation pair |
| PBT-06 (stateful PBT) | **N/A** | Stateful behaviour (Cases A/B/C/D dedup) is tested by integration tests, not stateful PBT |
| PBT-07 (generator quality) | **Deferred to Code Generation** | Generators for valid `TaskPayload`, `ClassificationFailure` variants, `DetectionState` |
| PBT-08 (shrinking + reproducibility) | **Inherited from U-1** | `fast-check` + shrunk-failure capture |
| PBT-09 (framework selection) | **Inherited from U-1** | `fast-check` confirmed |
| PBT-10 (complementary testing) | **Locked — strategy** | PBT for pure functions; integration tests for orchestration; smoke tests for Lambda runtime |

**Blocking findings**: none.

---

## 5. CI Quality Gates for U-3

Gates that must pass for any PR touching `src/application/**`, `src/handler/**`, `src/adapters/{s3,crypto,step-functions,powertools}/**`, or the new ports `S3Reader.ts` / `S3Streamer.ts` / `Hasher.ts` / `TaskSignaler.ts`:

| Gate | Tool | Threshold |
|---|---|---|
| Lint | ESLint | Zero errors |
| Type check | `tsc --noEmit` (strict-plus) | Zero errors |
| Unit tests | Vitest | All pass |
| PBT tests | Vitest + `fast-check` | All pass |
| Branch coverage | Vitest + c8 | ≥ 75% on application/handler; ≥ 80% on most adapters; ≥ 95% on `src/adapters/crypto/**` |
| Integration tests | Vitest + testcontainers (LocalStack) | All 11 ACs pass |
| **Smoke tests (NEW)** | SAM Local + LocalStack | Lambda runtime verified end-to-end |
| Bundle smoke check | Node script | bundle loads + exports `handler` + size ≤ 5 MB |
| Supply chain | `npm audit --omit=dev --audit-level=high` | Zero high/critical |

---

## 6. Open Items for Subsequent Stages

| Item | Stage |
|---|---|
| Exact `vitest.config.ts` threshold block for U-3 dirs | NFR Design |
| SAM Local config file (`template.yaml`) | NFR Design (logical) + Code Generation (concrete) |
| Per-environment env-var matrix (table names + concurrency caps) | Infrastructure Design (U-4) |
| CDK function construct: `aws-lambda-nodejs.NodejsFunction` with the locked memory/timeout/concurrency/IAM | Infrastructure Design (U-4) |
| CloudWatch alarms on Lambda Duration (per size class) | Infrastructure Design (U-4) |
| `cdk-nag` suppressions for `AwsSolutions-IAM4` (managed policies) | Infrastructure Design (U-4) |
| Bundle smoke check shell script | Code Generation |
