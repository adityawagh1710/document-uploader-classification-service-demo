# Local Testing Guide

Practical, step-by-step guide for exercising the Classification Service on your laptop using **LocalStack** (DynamoDB + S3 + Step Functions mocks) and **SAM Local** (real Lambda runtime).

> For the design-stage / CI-oriented version, see `aidlc-docs/construction/build-and-test/integration-test-instructions.md`.

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 20.0 | `node --version` |
| npm | ≥ 10 | `npm --version` |
| Docker | ≥ 24.x, daemon running | `docker info` |
| AWS SAM CLI | ≥ 1.120 | `sam --version` |
| AWS CLI v2 | any | `aws --version` |
| LocalStack CLI (optional) | latest | `localstack --version` |

> Docker is the only hard dependency for integration tests — `testcontainers` starts LocalStack programmatically. SAM CLI is only needed for the smoke suite.

Install one-time dev tooling:

```bash
npm ci
```

---

## 2. Two Ways to Run Locally

| Mode | What it does | When to use |
|---|---|---|
| **A. Vitest integration suite** | Boots LocalStack via `testcontainers`, runs adapter + end-to-end tests | Fast feedback loop; CI parity |
| **B. SAM Local + manual LocalStack** | Real Lambda runtime invocation against a long-lived LocalStack | Debug a specific payload, attach a debugger, observe logs |

Pick A for "does my change still work?" and B for "what does my Lambda actually do when given this event?".

---

## 3. Mode A — Vitest Integration Tests

### Run everything

```bash
npm run test:integration
```

Expected runtime: **3–6 min** (LocalStack cold start dominates the first ~30 s).

### Run a single suite

```bash
npx vitest run tests/integration/handler/lambda-end-to-end-happy.int.test.ts
```

### Run persistence-only (faster)

```bash
npx vitest run tests/integration/persistence
```

### Skip Docker-dependent suites

```bash
SKIP_DOCKER=1 npm run test:integration
```

> Local fast-feedback escape hatch only. CI must run with Docker.

### Coverage gates

Integration tests are excluded from the line-coverage threshold (which applies to unit + PBT). Run `npm run test:coverage` separately if you need the gate.

---

## 4. Mode B — SAM Local with a Long-Lived LocalStack

This mode mimics the real deploy: bundled Lambda code running inside a SAM-managed container, talking to LocalStack on the host.

### 4.1 Start LocalStack manually

```bash
docker run --rm -d \
  --name classification-localstack \
  -p 4566:4566 \
  -e SERVICES=s3,dynamodb,stepfunctions \
  -e DEBUG=0 \
  localstack/localstack:latest

# Wait until ready
until curl -s http://localhost:4566/_localstack/health | grep -q '"s3": "available"'; do sleep 1; done
echo "LocalStack ready"
```

### 4.2 Seed the tables

Convenience aliases (export once per shell):

```bash
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_REGION=eu-west-1
export AWS_ENDPOINT_URL=http://localhost:4566
```

Create the two DynamoDB tables matching `infra/lib/data-stack.ts` and `template.yaml`:

```bash
# content-hashes: PK=workspaceId, SK=contentHash, TTL on expiresAt
aws dynamodb create-table \
  --table-name content-hashes-test \
  --attribute-definitions \
      AttributeName=workspaceId,AttributeType=S \
      AttributeName=contentHash,AttributeType=S \
  --key-schema \
      AttributeName=workspaceId,KeyType=HASH \
      AttributeName=contentHash,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

aws dynamodb update-time-to-live \
  --table-name content-hashes-test \
  --time-to-live-specification 'Enabled=true,AttributeName=expiresAt'

# workspace-config: PK=workspaceId only
aws dynamodb create-table \
  --table-name workspace-config-test \
  --attribute-definitions AttributeName=workspaceId,AttributeType=S \
  --key-schema AttributeName=workspaceId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

Seed one workspace config row. The full shape is defined in `src/shared/types.ts` `WorkspaceConfig`:

```bash
aws dynamodb put-item \
  --table-name workspace-config-test \
  --item '{
    "workspaceId":       {"S": "wks-local-001"},
    "policyVersion":     {"S": "v1"},
    "threshold":         {"N": "70"},
    "maxZipDepth":       {"N": "3"},
    "quarantineMacros":  {"BOOL": true},
    "slipsheetRules":    {"M": {}},
    "hashTtlDays":       {"N": "30"}
  }'
```

> `hashTtlDays` may be `NULL` to disable per-workspace TTL. `threshold` is the low-confidence cutoff (0–100). `slipsheetRules` is a map of extension → `"always-slipsheet"`.

### 4.3 Upload a fixture to S3

```bash
aws s3 mb s3://classification-local-bucket

aws s3 cp tests/fixtures/ac-1-docx-renamed-pdf/sample.pdf \
  s3://classification-local-bucket/docs/sample.pdf
```

> Substitute any fixture under `tests/fixtures/<id>/`. The actual filenames vary by AC — `ls tests/fixtures/ac-1-docx-renamed-pdf/` to see what's available.

### 4.4 Build the Lambda bundle

```bash
npm run build
# or, if you want the full CDK-produced bundle:
npx cdk synth -c env=dev
```

`template.yaml` references `./dist` as the `CodeUri`, so a plain `tsc` is enough for the smoke path.

### 4.5 Invoke via SAM Local

Create an event payload `events/local-event.json`. Shape is the `TaskPayload` interface in `src/shared/types.ts`, validated by the Zod schema in `src/application/InputValidator.ts`:

```json
{
  "taskToken": "local-token-001",
  "workspaceId": "wks-local-001",
  "documentId": "doc-local-001",
  "s3": {
    "bucket": "classification-local-bucket",
    "key": "docs/sample.pdf"
  },
  "hints": {
    "extension": "pdf",
    "contentType": "application/pdf"
  },
  "context": {
    "parentArchiveDepth": 0,
    "overrideDuplicateCheck": false
  }
}
```

> All six top-level fields and both nested objects are required. `hints.extension` and `hints.contentType` may be `null` but must be present. The schema uses `.passthrough()` so extra fields are tolerated but won't reach the domain layer.

Invoke:

```bash
sam local invoke ClassificationFunction \
  --event events/local-event.json \
  --docker-network host
```

> `--docker-network host` lets the Lambda container reach `localhost:4566` directly. On Mac/Windows, omit it and use `host.docker.internal` (already configured in `template.yaml`).

### 4.6 Run the bundled smoke suite

If you'd rather drive SAM Local from Vitest:

```bash
npm run test:smoke
```

This runs the two suites in `tests/smoke/` against the already-built `dist/` output.

### 4.7 Inspect state after invocation

```bash
# What did we write to content-hashes?
aws dynamodb scan --table-name content-hashes-test

# Lookup by exact key (workspaceId + contentHash)
aws dynamodb query --table-name content-hashes-test \
  --key-condition-expression 'workspaceId = :w' \
  --expression-attribute-values '{":w": {"S": "wks-local-001"}}'

# Step Function callbacks LocalStack received
curl -s http://localhost:4566/_localstack/diagnose | jq '.logs[] | select(.service == "stepfunctions")'
```

### 4.8 Tear down

```bash
docker stop classification-localstack
```

---

## 5. Debugging Tips

### Attach a Node debugger to SAM Local

```bash
sam local invoke ClassificationFunction \
  --event events/local-event.json \
  --debug-port 9229 \
  --debugger-path /path/to/node-debugger
```

Then attach VS Code's "Attach to Node Process" on port 9229.

### Tail LocalStack logs

```bash
docker logs -f classification-localstack
```

### Faster Vitest loop on a single file

```bash
npx vitest tests/integration/handler/lambda-end-to-end-happy.int.test.ts --reporter=verbose
```

### Confirm a fixture's expected classification

`tests/fixtures/<id>/manifest.ts` declares the expected outcome. Read that file before debugging — most "wrong answer" failures are stale fixtures, not code bugs.

---

## 6. Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `Cannot connect to Docker daemon` | Start Docker Desktop or `sudo systemctl start docker`; confirm user is in the `docker` group |
| `Port 4566 in use` | Previous LocalStack still running. `docker ps`, then `docker stop <id>`. Or set `LOCALSTACK_PORT=4567` and re-run |
| `ResourceNotFoundException: Table 'content-hashes-test' not found` | Step 4.2 not run, or LocalStack restarted (state is in-memory) — re-seed |
| `bundling error` in SAM Local | Run `npm run build` (or `npx cdk synth -c env=dev`) — the bundle is stale |
| Flaky `SendTaskSuccess` assertions | LocalStack SFN mock is async — poll, don't `setTimeout` |
| `getaddrinfo ENOTFOUND host.docker.internal` on Linux | Add `--add-host=host.docker.internal:host-gateway` to your `docker run`, or use `--docker-network host` with SAM |
| Orphan LocalStack containers after Ctrl+C | `docker ps --filter "ancestor=localstack/localstack" -q \| xargs -r docker stop` |
| Lambda timeout in SAM Local on cold start | First invoke builds the runtime image (~30 s) — that's expected. Subsequent invokes are cached. Increase `Timeout` in `template.yaml` only if a hot invoke still times out |

---

## 7. What Each Suite Covers (Quick Reference)

| Path | Suite | Verifies |
|---|---|---|
| `tests/integration/persistence/` | DDB adapters | All 4 dedup decisions, TTL, conditional-write race, workspace-config cache |
| `tests/integration/handler/` | End-to-end happy + dedup + validation + large-doc + SFN callback + per-tier detection + error-code totality | 9 suites against LocalStack |
| `tests/integration/handler/edge-cases/` | AC-specific edge cases (renamed extensions, MSG/EML, threshold scoring, policy mismatches, cross-workspace isolation) | 7 ACs |
| `tests/smoke/` | SAM Local cold + warm start | 2 suites against the bundled Lambda |

---

## 8. Cleaning Up

```bash
# Stop any leftover LocalStack
docker ps --filter "ancestor=localstack/localstack" -q | xargs -r docker stop

# Remove generated bundle
rm -rf dist cdk.out

# Clear test fixtures cache (rarely needed)
rm -rf node_modules/.vitest
```

---

## 9. CI Parity Checklist

Before opening a PR, confirm locally:

```bash
npm run typecheck && \
npm run lint && \
npm run test:unit && \
npm run test:pbt && \
npm run test:integration && \
npx cdk synth -c env=dev && \
npm run test:infra && \
bash scripts/verify-bundle.sh cdk.out
```

If all green, CI will also be green.
