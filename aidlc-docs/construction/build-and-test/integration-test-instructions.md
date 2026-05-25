# Integration Test Instructions

> Validates interactions across U-1 (classifier-core), U-2 (persistence), U-3 (handler), and U-4 (infrastructure synth) using LocalStack (DynamoDB + S3 + Step Functions) + SAM Local for handler smoke testing.

---

## 1. Purpose

Unit tests verify components in isolation behind ports. Integration tests verify the **adapter ↔ real AWS service** contracts and the **end-to-end happy path through `lambda.ts`**.

Three categories:

| Category | Scope | Tooling |
|---|---|---|
| **A. Persistence integration** | U-2 adapters ↔ real DynamoDB (via LocalStack) | Vitest + testcontainers + LocalStack |
| **B. Handler integration** | U-3 handler ↔ S3 + DDB + Step Functions (LocalStack) | Vitest + testcontainers + LocalStack |
| **C. Handler smoke** | Bundled Lambda invoked end-to-end (cold-start path) | SAM Local + `template.yaml` |

---

## 2. Test Inventory

### 2.1 Persistence Integration (`tests/integration/persistence/`)

| Test | Verifies |
|---|---|
| `dynamo-content-hashes.int.test.ts` | All 4 dedup decision cases (new / override / policy-mismatch / clean-duplicate) against real DDB |
| `dynamo-content-hashes-ttl.int.test.ts` | TTL attribute is honoured by DDB's expiration sweeper (best-effort verification) |
| `dynamo-content-hashes-conditional.int.test.ts` | Conditional write race: 2 concurrent writes to same PK+SK; exactly one succeeds |
| `dynamo-workspace-config.int.test.ts` | Cache populate + GetItem path |

### 2.2 Handler Integration (`tests/integration/handler/`)

| Test | Verifies |
|---|---|
| `lambda-end-to-end-happy.int.test.ts` | Full path: S3 GetObject → hash → DDB conditional write → classification → SFN SendTaskSuccess |
| `lambda-end-to-end-dedup.int.test.ts` | Dedup path: existing-hash branch short-circuits and skips classification |
| `lambda-input-validation.int.test.ts` | Zod validation rejects malformed events with SFN SendTaskFailure |
| `lambda-large-document.int.test.ts` | 50 MB PDF streams through without OOM |
| `lambda-step-function-callback.int.test.ts` | TaskSignaler emits correct shape to LocalStack SFN mock endpoint |
| `lambda-ole2-detection.int.test.ts` | OLE2 CLSID resolution end-to-end |
| `lambda-zip-detection.int.test.ts` | ZIP marker → office detection end-to-end |
| `lambda-text-heuristic.int.test.ts` | Tier-3 fallback path |
| `lambda-failure-error-codes.int.test.ts` | Every domain error → unique error code in SFN failure payload |

### 2.3 Handler Smoke (`tests/smoke/`)

| Test | Verifies |
|---|---|
| `sam-local-cold-start.smoke.test.ts` | `sam local invoke` produces non-error response on representative event JSON |
| `sam-local-warm-start.smoke.test.ts` | Consecutive invokes reuse the warm container |

---

## 3. Environment Setup

### 3.1 LocalStack (via testcontainers)

Tests start LocalStack programmatically using `@testcontainers/localstack`. No manual setup needed for CI or local — Docker only.

```bash
docker --version          # ≥ 24.x
docker info               # confirm daemon is running
```

LocalStack services used:
- `dynamodb` — table creation + CRUD
- `s3` — object upload + range GET
- `stepfunctions` — SFN endpoint mock for `SendTaskSuccess` / `SendTaskFailure`

A shared `tests/_helpers/localstack-fixtures.ts` exports `startLocalstack()` / `stopLocalstack()` used in `beforeAll` / `afterAll`.

### 3.2 SAM Local

```bash
sam --version             # ≥ 1.120.0
```

Smoke tests use `template.yaml` (committed alongside U-3). The first invocation builds the Lambda image (~30 s); subsequent invocations are cached.

---

## 4. Running Integration Tests

### Run all integration tests

```bash
npm run test:integration
```

Vitest config maps to `tests/integration/**`. Expected runtime ≈ 3–6 min (LocalStack startup dominates).

### Run handler smoke

```bash
npm run test:smoke
```

Builds with `npm run build` if needed, then runs SAM Local against `template.yaml`. Expected ≈ 1–2 min.

### Run a single integration suite

```bash
npx vitest run tests/integration/handler/lambda-end-to-end-happy.int.test.ts
```

### Skip Docker-dependent suites (workstations without Docker)

```bash
SKIP_DOCKER=1 npm run test:integration
```

The harness checks `SKIP_DOCKER` and `.skip`s any suite that uses LocalStack. **Do not commit code that fails CI**, but this is acceptable as a local fast-feedback escape hatch.

---

## 5. Diagnosing Failures

### `Cannot connect to Docker daemon`
- Ensure Docker Desktop / `dockerd` is running.
- On Linux: `sudo systemctl start docker` and confirm user is in the `docker` group.

### `Port 4566 in use`
- LocalStack default port is held by a previous run. Either: kill that container (`docker ps` then `docker stop <id>`), or set `LOCALSTACK_PORT=4567` and re-run.

### `ResourceNotFoundException: Table 'content-hashes-dev' not found`
- Fixture failed to create the table. Inspect the LocalStack container logs (`docker logs <localstack-container-id>`). Most often a `CreateTable` race; re-run.

### SAM Local: `bundling error`
- Ensure `cdk.out/` was produced by a recent `cdk synth`. `template.yaml` references the bundled asset path that CDK populated.
- If the bundle is stale, run `npx cdk synth -c env=dev` then re-run the smoke test.

### Flaky `SendTaskSuccess` assertions
- LocalStack's SFN mock returns asynchronously. Adapter uses `awsRequestId` for idempotency; ensure the assertion waits with a poller, not a fixed `setTimeout`.

---

## 6. Test Cleanup

Tests use per-test prefixed PK+SK values (e.g., `wks_test_<uuid>`) so leftover data from a crashed run does not interfere with subsequent runs.

LocalStack containers are torn down by `afterAll`. If a process is killed (Ctrl+C), orphan containers can remain — clean with:

```bash
docker ps --filter "ancestor=localstack/localstack" -q | xargs -r docker stop
```

---

## 7. Story / NFR Coverage

- ✅ NFR-1 (latency p99 ≤ 3 s small docs / 15 s large) — covered by smoke + `lambda-large-document.int.test.ts`
- ✅ NFR-4 (workspace isolation) — covered by `dynamo-content-hashes.int.test.ts` using 2 distinct workspaces
- ✅ NFR-7/8 (observability emission) — handler integration tests assert metrics emitted via Powertools
- ✅ US-CL-007/008 (OLE2 + ZIP detection) — direct end-to-end integration tests
- ✅ US-PE-001 (dedup decisions) — all 4 cases covered in persistence integration
