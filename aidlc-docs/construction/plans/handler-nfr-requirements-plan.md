# NFR Requirements Plan — U-3 `handler`

> Per-unit Construction stage 2/5. U-3 is the **operationally biggest** unit — it owns the Lambda runtime, its IAM scope (S3 + DDB inherited from U-2 + SFN + observability), end-to-end latency, and most of the SECURITY/NFR rules. This plan pins the Lambda configuration, SDK pinning, Powertools wiring, IAM scope, and coverage targets.
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

---

## A. NFR Requirements Questions

### Question 1 — Lambda memory + timeout
Choose the Lambda function's memory + timeout configuration.

A) **memory 512 MB; timeout 30 s** — generous for a service that does S3 ranged GET + streaming hash + DDB + SFN. 512 MB also doubles CPU/network allotment vs. the 128 MB minimum. 30 s leaves headroom for slow networks; the orchestrator's typical happy path completes in 500 ms–2 s.

B) memory 256 MB; timeout 15 s — tighter. Risks timeouts on large-object hashing.

C) memory 1 GB; timeout 60 s — overprovisioned. Higher per-invocation cost; longer max-duration without a benefit.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: 512 MB is the sweet spot — at 512 MB you get ~30% CPU vCPU vs. 128 MB's ~7%, and network throughput is materially higher (the streaming SHA-256 step is bandwidth-bound for documents > 1 MB). 30 s is well above the p99 happy-path latency (~2 s) yet below the Step Function task timeout (typically 60 s+), so we fail-then-retry rather than time-out-mid-flight. Option B's 256 MB throttles streaming hash on large documents; option C's 1 GB is pure cost overhead.

### Question 2 — Reserved concurrency
Reserved concurrency caps the number of simultaneous Lambda invocations.

A) **No reserved concurrency in dev/staging; 100 reserved in prod** — production cap protects against runaway document floods that could exhaust DDB on-demand burst allowance. Dev/staging unlimited (single-developer load).

B) Unlimited everywhere — relies on Lambda's account-default 1000 concurrent executions. Risks consuming the whole account budget if upstream goes haywire.

C) 10 reserved everywhere — very conservative; safe but constrains legitimate bursts.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Per-environment is the right answer. Prod's 100 cap is a safety bound — at 100 concurrent invocations × 2 s typical execution × 4 DDB ops/invocation = 200 DDB requests/second sustained, well within on-demand burst allowance. Higher caps invite runaway scenarios (a stuck upstream re-invocation loop) without a documented business need. Dev/staging are typically single-developer-load so unlimited is fine. Option C's 10 globally is over-conservative — would queue legitimate customer bursts.

### Question 3 — End-to-end latency budget (Lambda invocation start → SendTaskSuccess)
The full classify-and-signal path. Choose the p99 budget.

A) **p99 ≤ 3 s for documents ≤ 10 MB; p99 ≤ 15 s for documents > 10 MB** — bifurcated by size because streaming SHA-256 dominates large-document latency. Small-doc target is aggressive (catches regressions); large-doc accommodates network bandwidth.

B) p99 ≤ 10 s overall — single budget; easier to monitor; loses small-doc regression signal.

C) p99 ≤ 5 s overall — strict; may fail on legitimate large-document hashes.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Bifurcated budgets match the actual latency profile. Small documents (the majority) bottleneck on Lambda cold start + DDB calls (~hundreds of ms). Large documents bottleneck on streaming hash bandwidth (a 100 MB document at 10 MB/s = 10 s just for hashing). One global budget either misses small-doc regressions (option B's 10 s ceiling hides 5× degradations) or false-alarms on legitimate large hashes (option C's 5 s).

### Question 4 — AWS SDK + Powertools version pinning strategy
U-3 adds several new AWS SDK packages + Powertools modules. Pin strategy?

A) **Exact pin for all AWS SDK clients** (`@aws-sdk/client-s3`, `@aws-sdk/client-sfn`, plus inherited `@aws-sdk/client-dynamodb`); **caret pin for Powertools** (`@aws-lambda-powertools/logger`, `metrics`, `tracer`). Rationale: SDK clients affect runtime behaviour materially; Powertools is observability glue — patch updates are safe.

B) Exact pin for everything — strictest reproducibility; more upgrade churn.

C) Caret pin for everything — accepts patch + minor; risk on SDK silent behaviour changes.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Bifurcated strategy matches the U-2 precedent and the actual risk profile. AWS SDK clients can ship semantically meaningful changes in minor versions (e.g., new retry-mode defaults, header changes). Powertools is observability instrumentation — patch updates are mostly bug fixes that we want automatically. The exact-pin on `@aws-sdk/*` also matches U-2's choice for the DDB clients (Requirements §10).

### Question 5 — Powertools runtime configuration
Powertools accepts several environment-driven knobs. Choose the production defaults.

A) **`LOG_LEVEL=INFO` (debug-tunable per Lambda instance), `POWERTOOLS_METRICS_NAMESPACE=ClassificationService`, `POWERTOOLS_SERVICE_NAME=classification-service`, `POWERTOOLS_DEV=false`, `POWERTOOLS_LOGGER_LOG_EVENT=false`** (do not auto-log event payloads — SECURITY-03 redaction).

B) `LOG_LEVEL=DEBUG` everywhere — full verbosity. Cheap CloudWatch but noisy.

C) Defaults left to Powertools — accept all built-in defaults; no env-var overrides.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Option A is the production-ready configuration. `LOG_LEVEL=INFO` gives steady-state quietness with the ability to flip an individual Lambda instance to DEBUG for incident investigation (per US-SRE-001). `POWERTOOLS_LOGGER_LOG_EVENT=false` is critical — Powertools' built-in event auto-logging would leak the entire §4.1 payload including `taskToken` (a credential-like value) into CloudWatch logs every invocation. Custom namespace prevents metric collision with other services in the same account.

### Question 6 — Coverage targets for U-3
U-3 has both pure logic (validator, output builder, error mapping) and I/O orchestration. Choose target.

A) **75% branch coverage on `src/application/**` and `src/handler/**`; 80% on `src/adapters/{s3,crypto,step-functions,powertools}/**`** — lower than U-1 (90%) because most paths are exercised by integration tests rather than unit branches. Pure functions (InputValidator, OutputBuilder, mapFailureToErrorCode) effectively get 95%+ from PBT + unit tests.

B) Same 90% as U-1.

C) 60% — loose; relies entirely on integration tests.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: 75% on orchestration code reflects that the bulk of U-3's branches are "send command + map error" — there's a limited number of branches to cover at the unit level. Forcing 90% would push tests into "mock every SDK error variant individually" busywork. Integration tests against LocalStack exercise the actual production paths. Pure functions naturally hit much higher coverage from PBT — that's where the real algorithmic coverage lives. The 80% on adapter directories matches U-2's NFR Requirements.

### Question 7 — IAM scope for U-3's Lambda execution role (handed off to U-4)
Document the exact IAM permissions the Lambda needs. Combines U-2's DDB scope with new S3 + SFN permissions.

A) **Per-resource, per-action least-privilege bundle**:
   - DDB: `GetItem/PutItem/UpdateItem` on `content-hashes`; `GetItem` on `workspace-config` (inherited from U-2)
   - S3: `GetObject` on `${bucketArn}/*` only (no `ListBucket`, no `PutObject`, no `DeleteObject`)
   - SFN: `SendTaskSuccess` + `SendTaskFailure` on the specific State Machine ARN
   - CloudWatch Logs: `CreateLogStream`, `PutLogEvents` on the Lambda's own log group (AWS automatically grants via `AWSLambdaBasicExecutionRole` managed policy — we attach the managed policy by exception)
   - X-Ray: `PutTraceSegments` (AWS automatically grants via `AWSXRayDaemonWriteAccess` managed policy — same exception)

B) Broader: `s3:*` and `states:*` on specific ARNs — simpler but violates SECURITY-06.

C) `AWSLambdaFullAccess` managed policy — fails SECURITY-06 trivially.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: This is the SECURITY-06 least-privilege table. The two AWS-managed policies (`AWSLambdaBasicExecutionRole` + `AWSXRayDaemonWriteAccess`) are conventional exceptions per `cdk-nag` rule guidance — they're narrowly scoped to log emission + X-Ray writes only and using them is more reliable than re-deriving every action. Custom inline policy enumerates exactly U-3's DDB/S3/SFN actions. No wildcards on resources; no broader actions. `cdk-nag` rule `AwsSolutions-IAM4` will warn about the managed policies but with a documented suppression for the two AWS-recommended ones.

---

## B. Generation Checklist (executes after plan approval)

### Phase 1 — NFR Requirements Doc
- [x] B1. Create `aidlc-docs/construction/handler/nfr-requirements/nfr-requirements.md`:
  - Per-NFR applicability for U-3 (NFR-1/2/3 directly apply via the streaming hash path; NFR-7/8/9 directly apply; NFR-4 inherited from U-2)
  - Locked decisions Q1–Q7
  - SECURITY rule applicability — U-3 carries the most SECURITY rules of any unit
  - PBT compliance summary
  - CI quality gates for U-3 surface (including the integration test job)

### Phase 2 — Tech Stack Decisions
- [x] B2. Create `aidlc-docs/construction/handler/nfr-requirements/tech-stack-decisions.md`:
  - New AWS SDK runtime deps: `@aws-sdk/client-s3`, `@aws-sdk/client-sfn` (exact pins matching U-2 era)
  - New Powertools deps: `@aws-lambda-powertools/logger`, `metrics`, `tracer` (caret pins)
  - Zod runtime dep (exact pin)
  - `@types/aws-lambda` dev dep (caret pin)
  - Updated `package.json` excerpt with all U-3 additions
  - Powertools env-var configuration (LOG_LEVEL, METRICS_NAMESPACE, SERVICE_NAME, LOG_EVENT, etc.)
  - Lambda function configuration (memory, timeout, reserved concurrency, env vars) — for U-4 to materialise in CDK
  - Per-environment env-var matrix (dev/staging/prod values for table names, etc.)

### Phase 3 — Wrap-up
- [x] B3. Update `aidlc-state.md` — U-3 NFR Requirements marked Completed.
- [x] B4. Update `aidlc-docs/audit.md`.
- [x] B5. Present the 2-option completion message.

---

## C. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part B executes without further questions until the standardized 2-option completion message.
