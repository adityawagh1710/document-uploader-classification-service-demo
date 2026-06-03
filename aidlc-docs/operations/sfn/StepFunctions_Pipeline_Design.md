# Step Functions for the Document Pipeline — Design & Recommendation

**Status:** P1 (convert) + P2 (archive/zip) **BUILT & verified locally**. dev05 CDK/IRSA still deferred.
**Date:** 2026-06-03. **Branch context:** `feat/extract-ui-unit` (post full-BFF-sever).

---

## 1. TL;DR recommendation

**Yes, introduce Step Functions — but phase it, and orchestrate _over SQS_ (not direct Lambda invokes).**

- Use **`.waitForTaskToken` against the existing SQS queues** so the integration boundary with downstream workers stays the `StageRequest` contract + SQS. Workers remain SQS consumers; they just call `SendTaskSuccess(taskToken)` when done (classify already does this; the convert worker is a tiny addition).
- Use a **Standard** state machine (long-running; `waitForTaskToken` requires Standard, not Express).
- **Keep `classifyUploaded` synchronous** in the router for the UI's immediate result. SFN orchestrates the **post-classify async pipeline** (convert/archive/email/ocr → output-assembly). The UI polls **execution status** instead of the single `convertProgress` row — richer, and it **retires the convert-watchdog reaper** (SFN timeouts/catch replace it).
- **Don't big-bang it.** We only own 2 of ~6+ stages today (classify + office-convert). Start there to prove the pattern + kill the watchdog, then fold stages in as they come in-house.

**Why not now / caveat:** the immediate ROI is modest because most downstream stages are external services we don't control (they'd each need to participate in the task-token protocol). The real payoff lands when output-assembly (the fan-in/aggregation step) and recursive archive extraction (`maxZipDepth`) are in-house — both are textbook SFN strengths.

---

## 2. Current state (what we'd be changing)

**Today = choreography.** `router.classifyUploaded` → sync `/classify` → fire-and-forget **SQS fan-out** (archive/convert/email queues) → independent workers. No central state, no per-document pipeline view, stuck `converting` rows reaped by a 5-min **convert-watchdog CronJob**.

**SFN foundation already present (~60%):**
- `classification-service/src/handler/lambda.ts` — classify handler is already shaped as an SFN `.waitForTaskToken` task (reads `taskToken`, signals back).
- `src/adapters/step-functions/StepFunctionAdapter.ts` + `src/ports/TaskSignaler.ts` — `SendTaskSuccess`/`SendTaskFailure` port+adapter.
- `taskToken` is first-class in the `TaskPayload` contract; `InputValidator` requires it.
- `docker-compose.yml` LocalStack already enables `stepfunctions`; `lambda:invoke.waitForTaskToken` verified on LocalStack 3.7.

**Missing = the orchestrator itself.** No ASL, no `StateMachine` in CDK (`infra/` has zero SFN constructs).

**Stage ownership reality (decisive):**
| Stage | Owned in this repo? |
|-------|---------------------|
| classify | ✅ classification-service (Lambda + http) |
| office-convert | ✅ classification-service/worker (bridges to the external office-convert service) — **on SFN (P1)** |
| zip-extraction | 🟡 external service (`zip-extraction-service-demo`) — **now on SFN (P2)**: it grew a `taskToken` field + `SendTaskSuccess/Failure` signaler, interop by contract (no code copied in) |
| email-extraction | ❌ external (App Runner) |
| OCR, output-assembly, slipsheet, … | ❌ not built / future |

---

## 3. Target architecture

```
ingestion/upload ──► classifyUploaded (router, SYNC: result to UI immediately)
                         │  (after recording the run)
                         └─► states:StartExecution  ──►  ┌──────────────────────────┐
                                                         │  PipelineStateMachine     │
                                                         │  (Standard)               │
                                                         │                           │
                                                         │  Choice(category)         │
                                                         │   ├─ archive → ZipExtract* │ (Map for maxZipDepth recursion)
                                                         │   ├─ convert → OfficeConv* │
                                                         │   ├─ email   → EmailExtr*  │
                                                         │   └─ (other) → passthrough │
                                                         │        │                   │
                                                         │   OCR* (if needed)         │
                                                         │        │                   │
                                                         │   OutputAssembly* (fan-in) │
                                                         │        │                   │
                                                         │   Succeed / Catch→Fail     │
                                                         └──────────────────────────┘
   (* = SQS .waitForTaskToken task: SFN sends StageRequest+token to the stage queue;
        the worker does its job then calls SendTaskSuccess(token). Retry/Catch/Timeout
        are declared per-state — this replaces the convert-watchdog.)
```

**ASL sketch (illustrative, Standard):**
```
StartAt: Branch
States:
  Branch:
    Type: Choice
    Choices:
      - Variable: $.classification.category, StringEquals: convert, Next: OfficeConvert
      - Variable: $.classification.category, StringEquals: archive, Next: ZipExtract
      - Variable: $.classification.category, StringEquals: email,   Next: EmailExtract
    Default: OutputAssembly
  OfficeConvert:
    Type: Task
    Resource: arn:aws:states:::sqs:sendMessage.waitForTaskToken
    Parameters: { QueueUrl: <convert-queue>, MessageBody: { ...StageRequest, taskToken.$: $$.Task.Token } }
    TimeoutSeconds: 1800          # replaces the 35-min watchdog cutoff
    Retry:  [{ ErrorEquals: [States.Timeout], MaxAttempts: 1 }]
    Catch:  [{ ErrorEquals: [States.ALL], Next: MarkFailed }]
    Next: OutputAssembly
  ZipExtract:   { ... Map over entries, maxZipDepth recursion ... }
  EmailExtract: { ... }
  OutputAssembly: { Type: Task, Resource: ...waitForTaskToken, Next: Done }
  MarkFailed: { Type: Task, ... update classifications row convertStatus=failed ... End: true }
  Done: { Type: Succeed }
```

Per-document **execution name = documentId** (idempotent; one execution per upload). Execution input = the claim-check + classification result the router already has.

---

## 4. What changes

- **Router (`classifyUploaded`):** after `RecordRun`, replace the archive/convert/email SQS fan-out with **one `states:StartExecution`** (input = claim-check + category + runId). Keep the sync classify result + run recording. New port `app.PipelineStarter` + an `awsadapters/sfn_starter.go` (SFN client) — and a memory stub. `Pipeline` (the raw SQS dispatcher) becomes internal to SFN, not called by the resolver.
- **Convert worker (`classification-service/worker`):** it already reads the convert claim from SQS; add reading `taskToken` from the message and calling `SendTaskSuccess/Failure` (reuse the existing `StepFunctionAdapter`/`TaskSignaler` pattern from the Lambda). ~30 lines.
- **convert-watchdog:** **retired** — SFN `TimeoutSeconds` + `Catch` handle stuck conversions natively. (Remove the CronJob + the `reapStuckConverts` mutation, or leave them dormant.)
- **UI progress:** `convertProgress` (and a new `pipelineStatus`) reads the **SFN execution status/history** (`DescribeExecution` / `GetExecutionHistory`) — far richer than the single DDB row. The router exposes it; the UI's existing poll just points at it.
- **External stages (zip/email/ocr/output-assembly):** out of scope until in-house. Until then the state machine either skips them (Choice → passthrough) or keeps using plain SQS `sendMessage` (fire-and-forget) for the external ones and only `waitForTaskToken` for stages we own.

---

## 5. Local design (LocalStack)

- LocalStack Community runs **Step Functions (Standard)** + `sqs:sendMessage.waitForTaskToken` (already proven on 3.7). `stepfunctions` is already in the compose `SERVICES` list.
- **Bootstrap:** `scripts/bootstrap-localstack.sh` gains a `aws stepfunctions create-state-machine` (ASL from a file under `infra/asl/pipeline.asl.json`, a stub execution role ARN). Export `PIPELINE_STATE_MACHINE_ARN` to the router env.
- **Compose:** router gets `PIPELINE_STATE_MACHINE_ARN` + (LocalStack) the SFN endpoint via the existing `AWS_ENDPOINT_URL`. The convert worker gains the SFN endpoint to call `SendTaskSuccess`.
- **Verify:** upload a `.docx` → `classifyUploaded` starts an execution → LocalStack SFN sends to the convert queue with a token → (worker stubbed to succeed) → execution `SUCCEEDED`; `aws stepfunctions describe-execution` shows the path. No watchdog needed.
- **LocalStack caveats:** `.sync` service integrations + some intrinsics are partial; stick to `sqs:sendMessage.waitForTaskToken` + `lambda:invoke.waitForTaskToken` + Choice/Map/Retry/Catch (all supported).

---

## 6. dev05 design (CDK + IRSA) — separate from local, per the deploy plan

- **New CDK stack `ClassificationPipelineStack`** (`infra/lib/pipeline-stack.ts`): a `StateMachine` (Standard) built from the ASL (or L2 constructs), CloudWatch logging ON, X-Ray tracing ON. Per-env name `classification-pipeline-{env}`. Export `StateMachineArn-{env}`.
- **IRSA deltas** (managed-AWS, no new pods — SFN is a service):
  - **Router role** (`ingestion-subgraph`): + `states:StartExecution` + `states:DescribeExecution`/`GetExecutionHistory` on the state-machine ARN (for `pipelineStatus`).
  - **State-machine execution role:** + `sqs:SendMessage` on each stage queue it dispatches to.
  - **Worker roles** (convert-worker, and future stage workers): + `states:SendTaskSuccess` / `states:SendTaskFailure` (resource `*` — task tokens aren't ARN-scopable).
- **Observability:** SFN execution history + CloudWatch Logs give per-document trace for free; add a CloudWatch alarm on `ExecutionsFailed` / `ExecutionsTimedOut` (replaces the DLQ-depth-based convert alarms).
- **Cost:** Standard SFN bills per state transition (~$25 / 1M transitions). At sandbox volume, negligible.
- Slots into the existing **6-workstream dev05 plan** ([[dev05-bff-deployment-plan]]) as a 7th workstream; nothing here becomes a pod.

---

## 7. Phased adoption

- **P0 — this doc.** Decide target + scope.
- **P1 — classify→office-convert over SFN (the slice we own). ✅ DONE.** State machine with the convert branch only; convert worker sends task tokens; retire the watchdog; UI progress = execution status. Local (LocalStack); dev05 CDK artifacts deferred. Proved the pattern end-to-end. See §9.
- **P2 — archive (zip-extraction) over SFN. ✅ DONE.** Second state machine `classification-zip-pipeline` (same `sqs:sendMessage.waitForTaskToken` shape); the external `zip-extraction-service-demo` opted into the token protocol (a `taskToken` field + an SFN signaler) without copying its code in-repo. The router now starts an execution per `category=archive`. `maxZipDepth` recursion (Map) is still a future enhancement — P2 is the single-level extract round-trip. See §10.
- **P3+ — fold in remaining stages as they come in-house.** email, OCR, then **output-assembly** (the fan-in that most justifies SFN), and archive `maxZipDepth` recursion via Map. External-only stages stay plain-SQS until their owners opt into the token protocol.

---

## 8. Trade-offs / when it's worth it

**For:** per-document visibility + audit trail; native retries/timeouts/catch (kills the watchdog); clean home for fan-in (output-assembly) and recursion (zip `maxZipDepth`); the classify handler + token plumbing already exist.

**Against / cost:** re-architects the SQS fan-out we just shipped; most stages are external (can't make them tasks without their cooperation); adds an orchestration layer to learn/operate; another CDK stack + IRSA surface.

**Verdict:** worth doing **incrementally now** (P1) to retire the fragile watchdog + set the architecture, with the big win deferred to when output-assembly/archive are in-house. Not worth a big-bang rewrite today.

---

## 9. AS-BUILT — P1 convert flow (implemented + verified locally, June 3 2026)

P1 shipped exactly as designed, **local end-to-end**: `StartExecution` replaces the convert SQS dispatch; the state machine dispatches to the convert queue via `sqs:sendMessage.waitForTaskToken`; the worker signals the token back. (archive is now also on SFN — see §10; email still dispatches directly.) dev05 CDK + IRSA (§6) are deferred.

### 9.1 Components touched
- **ASL + state machine** — created at bootstrap (`scripts/bootstrap-localstack.sh`, inline ASL): `classification-convert-pipeline` (Standard). ARN deterministic on LocalStack: `arn:aws:states:eu-west-1:000000000000:stateMachine:classification-convert-pipeline`, handed to the router via env `STATE_MACHINE_ARN`.
- **Router (Go)** — `app.PipelineStarter` port + `internal/awsadapters/sfn_starter.go` (StartExecution, `Name=documentId`, `Input=ConvertClaim JSON`). `classifyUploaded` convert branch calls `StartConvert` instead of `Pipeline.DispatchConvert`. `ErrPipelineNotConfigured`→"skipped".
- **Worker (TS, `units/classification-service/worker`)** — `message.ts` accepts optional `taskToken`; `task-signaler.ts` (`SendTaskSuccess`/`SendTaskFailure`, no-op without token); `handler.ts` signals at terminal branches. `@aws-sdk/client-sfn` added.

### 9.2 Flowchart (as-built)

```
 Browser ──upload .docx──► UI /api/classify (:3000)
                              │ 1. presignUpload (→ router)
                              │ 2. PUT bytes → S3  classification-ui-bucket/ui/<doc>/<name>
                              │ 3. classifyUploaded (→ router)
                              ▼
                    ROUTER classifyUploaded
                      • POST /classify (engine) → category = convert
                      • RecordRun → DDB classifications  convertStatus = queued
                      • category==convert → PipelineStarter.StartConvert
                              │  states:StartExecution
                              │  Name = documentId   Input = ConvertClaim JSON
                              ▼
        ┌──────────────────────────────────────────────────────────┐
        │ STEP FUNCTIONS (Standard)  classification-convert-pipeline │  execution: RUNNING
        │   State "Convert":                                         │
        │     Resource = arn:aws:states:::sqs:sendMessage            │── ConvertClaim + $$.Task.Token
        │                .waitForTaskToken                           │        │
        │     TimeoutSeconds = 1800                                  │        ▼
        │     Catch States.ALL → Failed                              │   SQS convert-queue
        │     ⏸  PAUSES — waiting for the task token                 │        │ poll
        └───────▲───────────────────────────────┬──────────────────┘        ▼
                │                                │                    CONVERT WORKER
   SendTaskSuccess │              SendTaskFailure │                     • parse taskToken
   (→ SUCCEEDED)   │              (→ Catch→FAILED) │                     • markConverting (DDB)
                │                                │                     • POST /v1/convert ──► office-convert (Aspose)
                └────────────────────────────────┴── markDone (DDB) ◄── PDF → S3 converted/<doc>.pdf
                                                      then SendTaskSuccess(token)
                                                      (transient fail: NO signal → SQS redrive / SFN timeout)
                              │
 Browser ◄── documentRun / convertProgress ── convertStatus = done + presigned PDF URL  (UI :3000)
```

### 9.3 Step-by-step
1. **Upload** → UI `/api/classify` (multipart).
2. **presignUpload** (router) → presigned PUT → UI **streams bytes to S3** `ui/<documentId>/<name>` (no SDK in the UI).
3. **classifyUploaded** (router): `POST /classify` engine → `category=convert`; `RecordRun` → DDB `convertStatus=queued`.
4. **StartExecution** (router `PipelineStarter`, since `category==convert` and not `.dwg`): `Name=documentId` (idempotent), `Input=ConvertClaim` (`pipelineExecutionId,tenantId,documentId,runId,sourceBucket,sourceKey,filename,subCategory,correlationId`). UI gets `convertDispatch=ok`.
5. **Convert state** (`sqs:sendMessage.waitForTaskToken`): sends `ConvertClaim + taskToken` to the convert queue, then **pauses** (`RUNNING`), bounded by `TimeoutSeconds=1800`.
6. **Worker receives** off the queue; `parseConvertClaim` reads the body incl. `taskToken`.
7. **Convert**: `markConverting` (DDB `converting`) → `office-convert POST /v1/convert` (`s3_input`/`s3_output`) → PDF written to `converted/<doc>.pdf` in the shared bucket.
8. **Signal**: success → `markDone` (DDB `done`,`convertS3Key`) + **`SendTaskSuccess`**; terminal (`.dwg`/4xx) → `markFailed` + **`SendTaskFailure`**; transient (5xx/network/timeout) → **no signal** → SQS redrive (SFN timeout is the backstop).
9. **Execution ends**: `SendTaskSuccess` → **`SUCCEEDED`**; `SendTaskFailure` or 1800s timeout → **`Catch → Failed`** → **`FAILED`** (no orphaned `converting` row — replaces the watchdog).
10. **UI** reads `convertStatus=done` + serves the PDF via `convertedDownloadUrl` (presigned GET).

### 9.4 Verified
Upload → `convertDispatch=ok` → execution (named `documentId`) **SUCCEEDED in ~2s** → `converted/<doc>.pdf` produced → worker logged `sfn.send_task_success.ok`. LocalStack 3.7 `sqs:sendMessage.waitForTaskToken` round-trip de-risked first. Router `go build/vet` clean; worker typecheck + 22 tests; full compose e2e green.

### 9.5 What it replaced
Before: router fire-and-forget `DispatchConvert` → SQS, plus a **convert-watchdog CronJob** scanning DDB for stuck `converting` rows. Now: SFN owns dispatch + retry/timeout/catch + a per-document execution (`describe-execution`), making the watchdog redundant (the `reapStuckConverts` mutation + CronJob are now dormant).

---

## 10. AS-BUILT — P2 archive (zip-extraction) flow (implemented + verified locally, June 3 2026)

P2 mirrors P1 for the **archive** category. A second Standard state machine `classification-zip-pipeline` dispatches the `ArchiveClaim` to the zip-extraction queue via `sqs:sendMessage.waitForTaskToken`; the **external** `zip-extraction-service-demo` participates in the token protocol (it gained a `taskToken` field + an SFN signaler) **without its code being copied into this repo** — interop stays by contract (`ArchiveClaim` + SQS + task token). The router now routes `category=archive` through `StartArchive` instead of the direct `DispatchArchive`.

### 10.1 Components touched
- **ASL + state machine** — added to `scripts/bootstrap-localstack.sh` (inline ASL): `classification-zip-pipeline` (Standard). ARN: `arn:aws:states:eu-west-1:000000000000:stateMachine:classification-zip-pipeline`, handed to the router via env `ARCHIVE_STATE_MACHINE_ARN`. Single `Extract` task = `sqs:sendMessage.waitForTaskToken` → `zip-extraction-queue` (MessageBody = the 6 `ArchiveClaim` fields + `$$.Task.Token`), `TimeoutSeconds:1800`, `Catch States.ALL → Failed`.
- **Router (Go)** — `app.PipelineStarter` gained `StartArchive(ctx, ArchiveClaim)`; `awsadapters/sfn_starter.go` now holds **both** ARNs (`convertARN`,`archiveARN`) sharing one `start()` helper. `classifyUploaded`'s archive branch calls `r.PipelineStarter.StartArchive` (was `r.Pipeline.DispatchArchive`), gated on `PipelineStarter != nil`, `ErrPipelineNotConfigured`→"skipped". `main.go` constructs the starter from both env ARNs and logs `pipeline=sfn convertArn=… archiveArn=…`.
- **zip-extraction service (Go, external repo `zip-extraction-service-demo`)** — `ClaimCheck` gained `TaskToken string`; new `internal/tasksignal/signaler.go` (`SFNSignaler`: `Success`→`SendTaskSuccess` with JSON output, `Failure`→`SendTaskFailure`, no-op when token==""); `app.go` wires a `TaskSignaler` and, after a terminal `Process`, calls `Success({status,entryCount})` or `Failure("ZipExtractionFailed",reason)`. Transient errors do **not** signal (SFN timeout is the backstop). `awsclients` gained an `*sfn.Client` (LocalStack `BaseEndpoint`); `main.go` injects the signaler.

### 10.2 Flowchart (as-built)

```
 Browser ──upload .zip──► UI /api/classify (:3000)
                              │ 1. presignUpload (→ router)
                              │ 2. PUT bytes → S3  classification-ui-bucket/ui/<doc>/<name>
                              │ 3. classifyUploaded (→ router)
                              ▼
                    ROUTER classifyUploaded
                      • POST /classify (engine) → category = archive  (tier = zip-marker)
                      • RecordRun → DDB classifications
                      • category==archive → PipelineStarter.StartArchive
                              │  states:StartExecution
                              │  Name = documentId   Input = ArchiveClaim JSON
                              ▼
        ┌──────────────────────────────────────────────────────────┐
        │ STEP FUNCTIONS (Standard)  classification-zip-pipeline     │  execution: RUNNING
        │   State "Extract":                                         │
        │     Resource = arn:aws:states:::sqs:sendMessage            │── ArchiveClaim + $$.Task.Token
        │                .waitForTaskToken                           │        │
        │     TimeoutSeconds = 1800                                  │        ▼
        │     Catch States.ALL → Failed                              │   SQS zip-extraction-queue
        │     ⏸  PAUSES — waiting for the task token                 │        │ poll
        └───────▲───────────────────────────────┬──────────────────┘        ▼
                │                                │                  ZIP-EXTRACTION SERVICE (external)
   SendTaskSuccess │              SendTaskFailure │                   • read taskToken from msg
   (→ SUCCEEDED)   │              (→ Catch→FAILED) │                   • download zip from S3, extract entries
   {entryCount,    │              ZipExtractionFailed                 • write per-file ledger → DDB pipeline_files
    status:SUCCESS}│                              │                   • Process → outcome{status,entryCount}
                └────────────────────────────────┴──── signal token ◄┘ (transient fail: NO signal → SFN timeout)
                              │
 Browser ◄── documentRun / stats ── archive outcome  (UI :3000)
```

### 10.3 Step-by-step
1. **Upload** `.zip` → UI `/api/classify` (multipart).
2. **presignUpload** (router) → presigned PUT → UI **streams bytes to S3** `ui/<documentId>/<name>`.
3. **classifyUploaded** (router): `POST /classify` engine → `category=archive` (`detectionTier=zip-marker`, `format=zip`); `RecordRun` → DDB.
4. **StartExecution** (router `PipelineStarter.StartArchive`): `Name=documentId` (idempotent), `Input=ArchiveClaim` (`pipelineExecutionId,tenantId,documentId,sourceBucket,sourceKey,correlationId`). UI gets `archiveDispatch=ok`.
5. **Extract state** (`sqs:sendMessage.waitForTaskToken`): sends `ArchiveClaim + taskToken` to `zip-extraction-queue`, then **pauses** (`RUNNING`), bounded by `TimeoutSeconds=1800`.
6. **zip-extraction receives** off the queue; the claim body carries `taskToken`.
7. **Extract**: download the archive from S3, expand entries, write the per-file ledger to DDB `pipeline_files`; build `outcome{status,entryCount,failureCount}`.
8. **Signal**: terminal SUCCESS/PARTIAL → **`SendTaskSuccess`** with `{entryCount,status}`; terminal FAILED → **`SendTaskFailure("ZipExtractionFailed",reason)`**; transient → **no signal** → SFN `TimeoutSeconds` backstop.
9. **Execution ends**: `SendTaskSuccess` → **`SUCCEEDED`** (output = the signaler payload); `SendTaskFailure`/timeout → **`Catch → Failed`** → **`FAILED`**.
10. **UI** surfaces the archive outcome via `documentRun`/`stats`.

### 10.4 Verified
Upload `solar-bundle.zip` → `archiveDispatch=ok` → execution (named `documentId`) **SUCCEEDED in <2s**; `describe-execution` `output = {"entryCount":2,"status":"SUCCESS"}` (the exact `SendTaskSuccess` payload); zip-extraction logged `message processed status SUCCESS entryCount 2`. Router logs `pipeline=sfn` with both convert + archive ARNs. **Gotcha encountered:** the first run silently used a stale router image (the `go mod download` Docker step had hit a transient corp-DNS timeout to `proxy.golang.org`, so `compose up` fell back to the old P1 image whose archive branch still did direct `DispatchArchive`) — symptom was `archiveDispatch=ok` + extraction success but **zero executions on the zip state machine**. Rebuilding the router with DNS restored fixed it; the `pipeline=sfn …archiveArn=…` log line is the confirmation the new wiring is live.

### 10.5 What it replaced
Before: router fire-and-forget `DispatchArchive` → `zip-extraction-queue`, no per-document state. Now: SFN owns the archive dispatch + a per-document execution with timeout/catch, and the external zip-extraction service reports terminal outcome back through the task token — same orchestration contract as convert (P1).
