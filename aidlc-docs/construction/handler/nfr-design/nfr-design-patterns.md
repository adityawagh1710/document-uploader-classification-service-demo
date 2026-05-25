# NFR Design Patterns — U-3 `handler`

> Seven handler-specific patterns. U-3 inherits Patterns #1–8 from U-1 (Result plumbing, exhaustive switch, pure-function determinism, defense-in-depth bounds, PBT, perf bench, fixture manifest, PBT shrink capture) and Patterns P-2-1..P-2-7 from U-2 (DDB lifecycle, LocalStack globalSetup, per-test UUID, adapter logging, AbortSignal timeout, race handling, SDK error pattern matching). The patterns below add what U-3 needs on top.

---

## Pattern P-3-1 — Module-load dependency wiring

**Satisfies**: latency budgets §2.2 (cold-start cost amortised), NFR-6 (config-driven via env vars), SECURITY-15 (init failure visible)

**Pattern**:

```typescript
// src/handler/lambda.ts
import { S3Client } from "@aws-sdk/client-s3";
import { SFNClient } from "@aws-sdk/client-sfn";
import { createDDBDocumentClient } from "@adapters/shared/dynamo-client.js";

// All `createXxx(...)` calls run at module load — ONCE per cold start.
// Anything that throws here = Lambda init error visible in CloudWatch.

const ddb = createDDBDocumentClient();
const s3 = new S3Client({ retryMode: "standard", maxAttempts: 3 });
const sfn = new SFNClient({ retryMode: "standard", maxAttempts: 3 });

const logger = createPowertoolsLogger("classification-service", "documentId");
const tracer = createPowertoolsTracer();
const metrics = createPowertoolsMetrics("ClassificationService");

const inputValidator = createInputValidator();
const outputBuilder = createOutputBuilder();

const taskSignaler = createStepFunctionAdapter({ sfn, logger });
const s3Adapter = createS3Adapter({ s3, logger });

const classificationService = createClassificationService({
  tier1: createTier1FileTypeDetector(),
  tier2OLE2: createTier2OLE2Detector({ parser: createOLE2Parser() }),
  tier2ZIP: createTier2ZIPDetector({ parser: createZIPMarkerParser() }),
  tier3Text: createTier3TextDetector(),
  scorer: createScorer(),
  categoryMapper: createCategoryMapper(),
  slipsheetDecider: createSlipsheetDecider(),
  s3Reader: s3Adapter,
  s3Streamer: s3Adapter,
  hasher: createNodeCryptoHasher(),
  contentHashStore: createDDBContentHashAdapter({
    ddb,
    tableName: requireEnv("CONTENT_HASH_TABLE_NAME"),
    logger,
  }),
  workspaceConfigStore: createDDBWorkspaceConfigAdapter({
    ddb,
    tableName: requireEnv("WORKSPACE_CONFIG_TABLE_NAME"),
    logger,
  }),
  logger,
  nowProvider: () => new Date().toISOString(),
  policyVersionExtractor: (c) => c.policyVersion,
});

export const handler: Handler<unknown, void> = async (event) => {
  /* … per Pattern P-3-7 below … */
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
```

**Why this works**:
- Top-of-file = construct ONCE per warm container; all warm invocations share the wired graph
- `requireEnv` throws early at init if a required env var is missing — Lambda exits with init error before any task arrives
- The `Handler<unknown, void>` typing leaves runtime type narrowing to `InputValidator`

**Enforcement**:
- Code review: any `createXxx()` call inside the handler body is wrong (re-creates on every call)
- ESLint rule (future): `no-restricted-syntax` on `createXxx` calls inside the `handler` function body — but easier to enforce by convention given the single file

---

## Pattern P-3-2 — SAM Local + shared LocalStack

**Satisfies**: smoke-test tier (Lambda runtime fidelity), US-SD-005 (pre-PR smoke)

**Pattern**:

```yaml
# template.yaml — SAM Local config (NOT a deployment template)
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
      CodeUri: ./dist                # esbuild output
      Handler: lambda.handler
      Environment:
        Variables:
          LOG_LEVEL: DEBUG
          POWERTOOLS_DEV: "true"
          POWERTOOLS_SERVICE_NAME: classification-service
          POWERTOOLS_METRICS_NAMESPACE: ClassificationService
          POWERTOOLS_LOGGER_LOG_EVENT: "false"
          CONTENT_HASH_TABLE_NAME: content-hashes-test
          WORKSPACE_CONFIG_TABLE_NAME: workspace-config-test
          # AWS endpoint override for LocalStack — picked up by SDK clients
          AWS_ENDPOINT_URL: http://host.docker.internal:4566
          AWS_REGION: us-east-1
          AWS_ACCESS_KEY_ID: test
          AWS_SECRET_ACCESS_KEY: test
```

Smoke test invocation:

```typescript
// tests/smoke/handler.smoke.test.ts
import { execSync } from "node:child_process";
import { describe, it, expect } from "vitest";

describe("handler (smoke via SAM Local)", () => {
  it("processes a synthetic payload through the real Lambda runtime", () => {
    // (Pre-condition: LocalStack already running per globalSetup)
    const event = JSON.stringify({
      taskToken: "test-token",
      workspaceId: "test-ws",
      documentId: "test-doc",
      s3: { bucket: "test-bucket", key: "test-key" },
      hints: { extension: "pdf", contentType: null },
      context: { parentArchiveDepth: 0, overrideDuplicateCheck: false },
    });
    const result = execSync(
      `sam local invoke ClassificationFunction --event - <<< '${event}'`,
      { encoding: "utf-8", timeout: 60_000 },
    );
    expect(result).toContain("Lambda exited successfully");
  });
});
```

**Why this works**:
- SAM Local pulls `public.ecr.aws/lambda/nodejs:20` and runs the handler inside it
- `host.docker.internal:4566` routes Lambda → LocalStack (already running on the host's network)
- Env vars set in `template.yaml` mirror the production CDK config
- Catches: cold-start init failures, missing env vars, unbundled imports, esbuild-target mismatches, Lambda layer issues

**Enforcement**:
- CI step: `npm run test:smoke` (separate from `test:integration`)
- Runs after `cdk synth` so the dist/ directory has the bundle

---

## Pattern P-3-3 — Bundle smoke check

**Satisfies**: pre-deploy verification, SECURITY-13 (artifact integrity)

**Pattern**:

```bash
#!/usr/bin/env bash
# scripts/verify-bundle.sh
set -euo pipefail

BUNDLE_DIR="${1:-cdk.out/asset.*}"
BUNDLE_PATH=$(find $BUNDLE_DIR -name "handler.js" | head -n 1)

if [[ -z "$BUNDLE_PATH" ]]; then
  echo "::error::Bundle not found at $BUNDLE_DIR/handler.js"
  exit 1
fi

BUNDLE_SIZE_BYTES=$(stat -c%s "$BUNDLE_PATH" 2>/dev/null || stat -f%z "$BUNDLE_PATH")
MAX_BYTES=5242880

if [[ $BUNDLE_SIZE_BYTES -gt $MAX_BYTES ]]; then
  echo "::error::Bundle size ${BUNDLE_SIZE_BYTES} > 5MB ($MAX_BYTES)"
  exit 1
fi

# Smoke check: bundle must load and export `handler`
node --input-type=module -e "
  const m = await import('$BUNDLE_PATH');
  if (typeof m.handler !== 'function') {
    console.error('handler export missing or not a function');
    process.exit(1);
  }
"

cat > bundle-report.json <<EOF
{
  "bundlePath": "$BUNDLE_PATH",
  "bundleSizeBytes": $BUNDLE_SIZE_BYTES,
  "handlerExported": true,
  "verifiedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "Bundle OK: ${BUNDLE_SIZE_BYTES} bytes"
```

**Why this works**:
- Runs after `cdk synth` in CI; before `cdk deploy`
- Catches: oversized bundles (e.g., accidentally imported the full AWS SDK), missing handler export (e.g., a typo in the export name), bundle-time failures (e.g., circular imports that throw at init)
- JSON report integrates with CI dashboards

**Enforcement**:
- CI step: `npm run verify-bundle` (after `cdk synth`)
- Blocks deployment if size > 5 MB OR handler export missing

---

## Pattern P-3-4 — `runStep` instrumentation helper

**Satisfies**: NFR-7 (per-step structured logs), NFR-8 (CloudWatch metrics + X-Ray), US-SRE-001 (reconstruct decisions from logs)

**Pattern**:

```typescript
// src/application/run-step.ts
import type { Tracer } from "@aws-lambda-powertools/tracer";
import type { Metrics } from "@aws-lambda-powertools/metrics";
import { MetricUnits } from "@aws-lambda-powertools/metrics";
import type { Logger } from "@ports/Logger.js";

export interface RunStepDeps {
  tracer: Tracer;
  metrics: Metrics;
  logger: Logger;
  workspaceId: string;
}

export async function runStep<T>(
  deps: RunStepDeps,
  stepName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  deps.logger.debug(`${stepName}.start`, { workspaceId: deps.workspaceId });
  
  return deps.tracer.captureAsyncFunc(stepName, async () => {
    try {
      const result = await fn();
      const durationMs = Math.round(performance.now() - start);
      deps.logger.debug(`${stepName}.ok`, {
        workspaceId: deps.workspaceId,
        durationMs,
      });
      deps.metrics.addMetric("ClassificationStepDuration", MetricUnits.Milliseconds, durationMs);
      deps.metrics.addDimensions({ step: stepName, outcome: "ok", workspaceId: deps.workspaceId });
      return result;
    } catch (e) {
      const durationMs = Math.round(performance.now() - start);
      deps.logger.error(`${stepName}.error`, {
        workspaceId: deps.workspaceId,
        durationMs,
        errorMessage: (e as Error)?.message,
      });
      deps.metrics.addMetric("ClassificationStepDuration", MetricUnits.Milliseconds, durationMs);
      deps.metrics.addDimensions({ step: stepName, outcome: "error", workspaceId: deps.workspaceId });
      throw e;
    }
  });
}
```

Usage in the orchestrator:

```typescript
// inside classify()
const configResult = await runStep(deps, "classify.step2.load-workspace-config", () =>
  workspaceConfigStore.get(payload.workspaceId),
);
```

**Why this works**:
- Single source of truth for tracer/logger/metric calls
- Adding new instrumentation (e.g., sampling) is one place to change
- The `try/catch` ensures we instrument errors too (the error re-throws so Result-typed errors propagate normally to the caller)
- Note: `runStep` works for both `async () => Promise<Result<T,E>>` (returns Result.error normally — no exception, no error log; the caller handles) AND for `async () => T` that might throw (logs the throw + re-throws). The error log fires only on actual throws.

**Enforcement**:
- Convention: every step's body inside `classify()` wraps with `runStep`
- Code review check
- Test: a unit test verifies the helper emits the expected log entries + metrics on both success and error paths

---

## Pattern P-3-5 — `nowProvider` closure injection

**Satisfies**: NFR-5 (determinism), PBT-U3-001..002 (testability)

**Pattern**:

```typescript
// In src/handler/lambda.ts (production)
const classificationService = createClassificationService({
  // ...
  nowProvider: () => new Date().toISOString(),
  // ...
});

// In tests/integration/persistence/content-hashes.test.ts (test)
const fixedNow = "2026-05-22T10:00:00.000Z";
const service = createClassificationService({
  // ...
  nowProvider: () => fixedNow,
  // ...
});
```

The service uses `deps.nowProvider()` everywhere it needs the current time:
- `buildContentHashRecord({ now: deps.nowProvider() })`
- `updateOnDuplicateHit({ now: deps.nowProvider() })`

**Why this works**:
- Tests get deterministic timestamps without mocking `Date.now`
- Production code is no more complex (one closure passed as a dep)
- NFR-5 ("deterministic per `(bytes, extension, contentType, workspaceConfig, policyVersion)` tuple") becomes provable: the test fixes `now`, the test inputs are the rest of the tuple, the test asserts the deterministic output

**Enforcement**:
- ESLint `no-restricted-globals: ["error", { name: "Date", … }]` is already active in `src/domain/**` — extend to `src/application/**` so the orchestrator can't call `new Date()` directly
- Code review: any `new Date()` or `Date.now()` in `src/application/**` is a violation

---

## Pattern P-3-6 — End-to-end integration coverage

**Satisfies**: AC-1..AC-11 verification, NFR-4 (workspace isolation under orchestration)

**Pattern** — file layout for U-3 integration tests:

```
tests/
├── integration/
│   ├── _setup.ts                                    (already exists — LocalStack globalSetup)
│   ├── _orchestrator-setup.ts                       (NEW — shared deps for handler integration tests)
│   ├── persistence/                                  (already exists — U-2's adapter integration)
│   │   ├── content-hashes.test.ts
│   │   └── workspace-config.test.ts
│   └── handler/                                      (NEW — U-3 orchestrator end-to-end)
│       ├── ac-1-docx-renamed-pdf.test.ts             (AC-1)
│       ├── ac-2-ole2-nonstandard-sector.test.ts      (AC-2)
│       ├── ac-3-duplicate-same-workspace.test.ts     (AC-3)
│       ├── ac-4-cross-workspace-isolation.test.ts    (AC-4)
│       ├── ac-5-zip-max-depth.test.ts                (AC-5)
│       ├── ac-6-score-at-threshold.test.ts           (AC-6)
│       ├── ac-7-msg.test.ts                          (AC-7)
│       ├── ac-8-eml.test.ts                          (AC-8)
│       ├── ac-9-policy-version-mismatch.test.ts      (AC-9)
│       ├── ac-10-docm-quarantine.test.ts             (AC-10)
│       ├── ac-11-non-override-hit-count.test.ts      (AC-11)
│       └── edge-cases/                               (NEW — 4 edge cases from Q6=A)
│           ├── esc-byte-text-eligible.test.ts        (BR-T-1)
│           ├── ooxml-conservative-default.test.ts    (format-mappers.ts)
│           ├── unknown-format-slipsheet.test.ts      (BR-3-OUT-3)
│           └── override-flag-immutable-record.test.ts (BR-3-O-5 Case B)
```

Each test:
1. Generates `workspaceId = "test-${randomUUID()}"`
2. Seeds workspace-config (PutCommand directly to LocalStack DDB)
3. Seeds S3 object (PutObject to LocalStack S3) — for AC tests, with the real binary fixture from `tests/fixtures/manifest.ts`
4. Calls `classificationService.classify(payload)` directly (not through the Lambda entry; that's the smoke tier)
5. Asserts the `Result<ClassificationOutput, ClassificationFailure>` against the expected outcome

**Why this works**:
- The orchestrator's per-step logic is exercised against real (LocalStack-emulated) AWS services
- AC tests pin the spec contract; edge cases cover functional-design-flagged corners
- Per-test workspaceId isolation (Pattern P-2-3) keeps tests parallel-safe

**Enforcement**:
- CI gate: all AC integration tests must pass before merge to main
- Coverage on `src/application/**` reaches the 75% threshold by virtue of these tests + unit tests

---

## Pattern P-3-7 — Graceful Lambda exit + best-effort SendTaskFailure

**Satisfies**: SECURITY-15 (fail-safe), BR-3-FS-1..5 (handler entry rules)

**Pattern** (already detailed in `business-logic-model.md` §4 — restated here as a pattern):

```typescript
export const handler: Handler<unknown, void> = async (event) => {
  let taskToken: string | undefined;
  let documentId: string | undefined;
  
  try {
    // STEP 1: validate
    const validation = inputValidator.validate(event);
    if (!validation.ok) {
      // Try to extract taskToken from raw event for SendTaskFailure
      const rawToken = (event as { taskToken?: unknown })?.taskToken;
      if (typeof rawToken === "string") {
        await taskSignaler.sendTaskFailure({
          taskToken: rawToken,
          error: { code: "INPUT_VALIDATION_FAILED", message: `${validation.error.field}: ${validation.error.message}` },
        });
        return;
      }
      // Can't signal → throw so Lambda exits with error
      throw new Error("input validation failed without taskToken");
    }
    
    const payload = validation.value;
    taskToken = payload.taskToken;
    documentId = payload.documentId;
    logger.appendKeys({ documentId, workspaceId: payload.workspaceId });
    
    // Run the orchestrator
    const result = await classificationService.classify(payload);
    
    if (result.ok) {
      const signalResult = await taskSignaler.sendTaskSuccess({
        taskToken, output: result.value,
      });
      if (!signalResult.ok) throw new Error(`sendTaskSuccess failed: ${signalResult.error}`);
      return;
    }
    
    // Q4=A: throw on transient/throttled
    if (isTransientOrThrottled(result.error)) {
      throw new Error(`Transient/throttled failure: ${JSON.stringify(result.error)}`);
    }
    
    // Deterministic failure — signal SFN with errorCode
    const { code, message } = mapFailureToErrorCode(result.error);
    const signalResult = await taskSignaler.sendTaskFailure({
      taskToken, error: { code, message },
    });
    if (!signalResult.ok) throw new Error(`sendTaskFailure failed: ${signalResult.error}`);
  } catch (e) {
    logger.error("handler.unexpected", { errorMessage: (e as Error)?.message });
    
    // Best-effort: signal SFN before re-throwing
    if (taskToken) {
      try {
        await taskSignaler.sendTaskFailure({
          taskToken,
          error: { code: "UNEXPECTED_ERROR", message: (e as Error)?.message ?? "Unknown error" },
        });
      } catch {
        // Even signal failed — fall through to re-throw
      }
    }
    
    throw e;
  }
};
```

**Why this works**:
- Global try/catch is the last line of defence (SECURITY-15)
- Best-effort `sendTaskFailure` before re-throwing means the State Machine knows what happened even when Lambda is going to fail
- Re-throw after the best-effort signal means CloudWatch alarms still fire on the Lambda error metric (US-SRE-004)

**Enforcement**:
- Single file: `src/handler/lambda.ts`
- Code review check: any new code path in the handler must follow this skeleton
- Integration test for the "validation fails without taskToken" path verifies the throw behaviour

---

## Pattern Summary Table

| # | Pattern | Satisfies | Enforcement |
|---|---|---|---|
| P-3-1 | Module-load dependency wiring | Latency budget, NFR-6, SECURITY-15 | Singleton at module top; code review |
| P-3-2 | SAM Local + shared LocalStack | Smoke-test tier, US-SD-005 | SAM `template.yaml` config; `npm run test:smoke` |
| P-3-3 | Bundle smoke check | Pre-deploy verification, SECURITY-13 | Shell script `verify-bundle.sh`; CI step after `cdk synth` |
| P-3-4 | `runStep` instrumentation helper | NFR-7, NFR-8, US-SRE-001 | Single helper used uniformly; code review |
| P-3-5 | `nowProvider` closure injection | NFR-5, PBT-U3-001..002 | ESLint `no-restricted-globals` on `src/application/**` |
| P-3-6 | End-to-end integration coverage | AC-1..AC-11, NFR-4 | 15 integration test files; CI gate |
| P-3-7 | Graceful Lambda exit + best-effort signal | SECURITY-15, BR-3-FS-* | Single handler file; integration tests for unhappy paths |
