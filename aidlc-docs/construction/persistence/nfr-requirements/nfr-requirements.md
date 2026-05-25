# NFR Requirements — U-2 `persistence`

> Per-NFR applicability for the DynamoDB adapter unit + locked decisions from the NFR Requirements plan + SECURITY/PBT compliance for this stage + CI quality gates for U-2's specific surface.

---

## 1. Per-NFR Applicability for U-2

| NFR | Applies to U-2? | Concrete meaning for U-2 |
|---|---|---|
| NFR-1 (ranged GET ≤ 4,100 bytes) | N/A | S3 concern (U-3 / S3Adapter) |
| NFR-2 (streaming SHA-256) | N/A | Hashing concern (U-3) |
| NFR-3 (4,100-byte detection window) | N/A | Domain concern (U-1) |
| NFR-4 (workspace isolation in DDB) | **Yes — core invariant** | Every DDB op partitioned by `workspaceId`. Integration tests verify cross-workspace isolation explicitly (per BR-2-WI-4). |
| NFR-5 (determinism) | Indirect | Pure helpers (`buildContentHashRecord`, `computeExpiresAt`, `mapDDBError`, `serialiseRecord`/`deserialiseRecord`) are deterministic; DDB calls are not deterministic but their outputs feed back into deterministic decision-making upstream. |
| NFR-6 (config-driven thresholds) | Partial | Table names, retry attempts injected via factory deps; no hardcoded magic numbers in adapter logic. |
| NFR-7 (structured tier-by-tier logs) | Partial | Adapter emits structural log entries (op name, workspaceId, duration, error code) via injected Logger — never sensitive content. Per-tier instrumentation belongs to U-3 around U-2 calls. |
| NFR-8 (CloudWatch metrics + X-Ray) | Inherited | Metric emission lives in U-3 (Powertools wiring); U-2 emits no metrics itself. |
| NFR-9 (one invocation per task) | Inherited | Lambda concurrency model is U-3. |
| NFR-10 (per-workspace TTL) | **Yes** | `expiresAt` attribute written iff `hashTtlDays !== null`; DDB TTL configuration on `content-hashes` (the table-level setting) lives in U-4. |

**Summary**: NFR-4 (workspace isolation) is U-2's primary NFR. NFR-10 (TTL) is U-2-owned. All other NFRs pass through transparently.

---

## 2. Locked NFR Decisions for U-2

### 2.1 Latency Budgets — Q1=A (per-operation)

| Operation | p99 budget | Why |
|---|---|---|
| `ContentHashStore.get` | ≤ 20 ms | Single-item read; DDB's published ~10ms + SDK + network overhead |
| `ContentHashStore.putIfAbsent` | ≤ 30 ms | Conditional write has slightly higher latency than unconditional put |
| `ContentHashStore.updateOnDuplicateHit` | ≤ 30 ms | Conditional update with atomic ADD |
| `ContentHashStore.replaceOnPolicyMismatch` | ≤ 30 ms | Conditional PutItem |
| `WorkspaceConfigStore.get` | ≤ 20 ms | Strong-consistency read |

**Enforcement**: integration tests against LocalStack measure these on every run (LocalStack is sub-millisecond, so passing locally is trivial); production CloudWatch alarms (defined in U-4) page on p99 breaches.

### 2.2 Capacity Mode — Q2=A
Both `content-hashes` and `workspace-config` use **on-demand (PAY_PER_REQUEST)** billing mode. Defined in U-4's CDK.

### 2.3 SDK Retry Configuration — Q3=A
- `retryMode: "standard"` (AWS SDK v3 default)
- `maxAttempts: 3`
- Exponential backoff (SDK default: 50ms, 100ms, 200ms)
- Layer 2 (Step Function task retry) sits on top — handled by U-4 State Machine config

### 2.4 Integration Test Pattern — Q4=A
- One LocalStack container per test run (started by `testcontainers` in a Vitest `globalSetup`)
- Each test generates a unique `workspaceId` (e.g., `test-${randomUUID()}`)
- Cleanup is not strictly necessary (each `workspaceId` is unique) but a per-test `afterEach` deletes the test's content-hash records to keep the container small

### 2.5 Coverage Targets — Q5=A
- **80% branch coverage on `src/adapters/dynamo-content-hashes/**`**
- **80% branch coverage on `src/adapters/dynamo-workspace-config/**`**
- **95% branch coverage on the pure helpers** (`buildContentHashRecord`, `computeExpiresAt`, `mapDDBError`, `serialiseRecord`, `deserialiseRecord`)

Added to the existing `vitest.config.ts` threshold map. The integration test suite (LocalStack-backed) is not counted toward unit coverage but is gated separately by passing.

### 2.6 IAM Scope (for U-4) — Q6=A

**Lambda execution role permission statements:**

```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem"
  ],
  "Resource": "arn:aws:dynamodb:${region}:${account}:table/${contentHashTableName}"
},
{
  "Effect": "Allow",
  "Action": ["dynamodb:GetItem"],
  "Resource": "arn:aws:dynamodb:${region}:${account}:table/${workspaceConfigTableName}"
}
```

**Explicitly NOT granted**: `dynamodb:Scan`, `dynamodb:Query`, `dynamodb:BatchGetItem`, `dynamodb:BatchWriteItem`, `dynamodb:DeleteItem`, `dynamodb:DescribeTable`, `dynamodb:UpdateTable`, `dynamodb:CreateTable`. None are used by U-2's contract.

`cdk-nag` rule `AwsSolutions-IAM5` will pass (no wildcard resource); rule `AwsSolutions-IAM4` will pass (no `AdministratorAccess`-style policies).

---

## 3. SECURITY Compliance for U-2 (at this stage)

| Rule | Status for U-2 | Notes |
|---|---|---|
| SECURITY-01 (encryption) | **Inherited (U-4)** | DDB tables have SSE enabled by U-4 default (AWS-managed key acceptable; CMK upgrade if compliance requires); TLS enforced by SDK v3 default |
| SECURITY-02 (network access logs) | N/A | No load balancers / API gateways in U-2 |
| SECURITY-03 (app-level logging) | **Yes (adapter)** | Adapter logs op name, workspaceId, duration, error code via injected Logger; never raw records, never SDK credentials |
| SECURITY-04 (HTTP headers) | N/A | No HTTP surface |
| SECURITY-05 (input validation) | Indirect | Adapter assumes orchestrator validated inputs; cheap sanity checks added (non-empty strings) |
| SECURITY-06 (least-privilege IAM) | **Yes (Q6=A)** | Per-table, per-action permissions documented in §2.6 |
| SECURITY-07 (restrictive network) | **Inherited (U-4)** | Lambda in private subnet; DynamoDB VPC endpoint (recommended) — defined in U-4 |
| SECURITY-08 (app-level access control) | **Yes (NFR-4)** | Object-level authorization implicit via workspaceId partition key |
| SECURITY-09 (hardening) | **Inherited (U-4)** | DDB tables have public access blocked; no resource-based policies allowing cross-account by default |
| SECURITY-10 (supply chain) | **Yes (this stage)** | AWS SDK v3 packages exact-pinned in tech-stack-decisions.md §2 |
| SECURITY-11 (secure design) | **Yes** | Adapter is a clean port; no security logic mixed with persistence; all writes use conditional expressions |
| SECURITY-12 (auth/credentials) | N/A | Lambda execution role; no user-level credentials |
| SECURITY-13 (data integrity) | **Yes** | All writes use ConditionExpression where appropriate; no last-write-wins on critical state; DDB Streams can be enabled in U-4 for audit |
| SECURITY-14 (alerting & monitoring) | **Inherited (U-4)** | Alarms on DDB ThrottledRequests / SystemErrors defined in U-4 |
| SECURITY-15 (fail-safe defaults) | **Yes** | All paths return `Result<T, StoreError>`; never throws; unknown errors → `"unknown"` → orchestrator escalates |

**Blocking findings**: none.

---

## 4. PBT Compliance for U-2 (at this stage)

| Rule | Status for U-2 | Notes |
|---|---|---|
| PBT-01 (property identification at functional design) | **Compliant** | 4 properties enumerated in `business-rules.md` §8 |
| PBT-02 (round-trip) | **Compliant — design** | PBT-U2-003 covers `serialise/deserialise` round-trip |
| PBT-03 (invariant) | **Compliant — design** | PBT-U2-001, 002, 004 |
| PBT-04 (idempotence) | **N/A** | DDB operations are atomic at the protocol level; idempotence is a DDB property not an adapter property. Concurrency rules (BR-2-CR-*) document retry-safety. |
| PBT-05 (oracle) | **N/A** | No reference implementation pair exists for an SDK wrapper |
| PBT-06 (stateful PBT) | **N/A** | Adapter is stateless |
| PBT-07 (generator quality) | **Deferred to Code Generation** | Domain generators for `ContentHashRecord`, ISO dates, SDK error names |
| PBT-08 (shrinking + reproducibility) | **Inherited from U-1** | `fast-check` shrinking on; PBT-failure capture in `tests/regression/pbt-failures.json` |
| PBT-09 (framework selection) | **Inherited from U-1** | `fast-check` confirmed |
| PBT-10 (complementary testing) | **Locked — strategy** | Example-based unit tests + PBT for the 4 pure helpers + LocalStack integration tests for the SDK paths |

**Blocking findings**: none.

---

## 5. CI Quality Gates for U-2

Gates that must pass for any PR touching `src/adapters/dynamo-content-hashes/**`, `src/adapters/dynamo-workspace-config/**`, or `src/ports/{ContentHashStore,WorkspaceConfigStore}.ts`:

| Gate | Tool | Threshold |
|---|---|---|
| Lint | ESLint (existing config) | Zero errors |
| Type check | `tsc --noEmit` | Zero errors |
| Unit tests (pure helpers) | Vitest | All pass |
| PBT tests (pure helpers) | Vitest + fast-check | All pass; seeds logged |
| Branch coverage | Vitest + c8 | ≥ 80% on adapter dirs; ≥ 95% on pure helpers |
| Integration tests (LocalStack-backed) | Vitest + testcontainers | All pass; per-test workspaceId isolation |
| Supply chain | `npm audit --omit=dev` | Zero high/critical |
| IAM scope check (deferred to U-4) | `cdk-nag` | `AwsSolutions-IAM5` + `AwsSolutions-IAM4` pass |

---

## 6. Open Items for Subsequent Stages

| Item | Stage |
|---|---|
| Exact `vitest.config.ts` threshold block for U-2 dirs | NFR Design |
| LocalStack `testcontainers` setup module | NFR Design (logical) + Code Generation (concrete) |
| DDB client construction helper (retry config + endpoint override for LocalStack) | NFR Design |
| Integration test scaffolding patterns | NFR Design |
| Concrete CDK stack for both DDB tables (capacity mode, SSE, TTL attribute, on-demand billing) | Infrastructure Design |
| `cdk-nag` rule exemptions (if any) | Infrastructure Design |
| Auto-generated SDK error name catalogue (for PBT-U2-004) | Code Generation |
