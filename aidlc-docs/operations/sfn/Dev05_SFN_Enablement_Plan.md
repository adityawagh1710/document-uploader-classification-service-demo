# dev05 SFN Enablement Plan — Workstream 7

**Status:** scoping / code-on-branch. NOT executed. **Date:** 2026-06-03.
**Branch:** `feat/sfn-pipeline-orchestration`.
**Relates to:** `StepFunctions_Pipeline_Design.md` §6 (dev05 design) and the BFF dev05
deployment plan (agent memory `dev05-bff-deployment-plan`). This is the **7th
workstream** that sits *on top of* the BFF six.

---

## 0. TL;DR + the hard dependency

The P1/P2 state machines today exist **only** in `scripts/bootstrap-localstack.sh`
(LocalStack, account `000000000000`, role `…/sfn-exec`). To run them on dev05 we
need: a CDK stack that provisions the two state machines + their execution role,
three IRSA grants (router · convert-worker · zip-extraction), and the router Helm
env that hands it the ARNs.

> **HARD DEPENDENCY — sequence this *after* the BFF deployment.** The SFN model is
> *router `StartExecution` → SQS waitForTaskToken → worker `SendTaskSuccess`*. On
> dev05 today **the router was never deployed**, and the UI talks to AWS directly
> (no router, no `/classify` pod). So WS-7 cannot be verified until BFF
> workstreams 3 (router Helm+image), 4 (classification-service-http), and 6
> (orchestrate) are live. **WS-7 code can be written now on this branch; WS-7
> execution waits on the BFF rollout.**

**Self-contained vs gated:** **P1 (convert)** is fully ours (router + convert
worker are both in this repo) → deployable end-to-end once BFF is up. **P2
(archive)** depends on the *external* `zip-extraction-service-demo` deploying its
token-protocol build (taskToken + signaler). Until it does, the zip state machine
will run to `TimeoutSeconds` (1800s) → `Catch → Failed` (no orphan, but no success
either). So **P2-on-dev05 is gated on the sibling repo's deploy**; do P1 first.

---

## 1. Target on dev05

Two **Standard** state machines, per-env names (mirrors the queue naming in
`convert-queue-stack.ts`):

| | dev/staging | prod |
|---|---|---|
| convert (P1) | `classification-convert-pipeline-dev` | `classification-convert-pipeline` |
| archive (P2) | `classification-zip-pipeline-dev` | `classification-zip-pipeline` |

Each = a single `sqs:sendMessage.waitForTaskToken` task to its stage queue
(`classification-convert-queue-dev` / `zip-extraction-dev05`), `TimeoutSeconds
1800`, `Catch States.ALL → Fail`. CloudWatch logging `ALL` + X-Ray tracing on.
Deterministic ARN (no cross-stack plumbing into Helm needed):
`arn:aws:states:eu-west-1:537462380503:stateMachine:<name>`.

**Not to be confused with** the placeholder `document-ingestion-dev` state machine
referenced by `infra/config/dev.ts` + `lambda-stack.ts` — that's a *different*,
undeployed, upstream-ingestion model (classify-Lambda-as-task). WS-7 leaves it
alone and provisions our own two pipelines.

---

## 2. Workstream items (code — all doable on this branch now)

### 2.1 CDK — new `ClassificationPipelineStack`
- **New** `infra/lib/pipeline-stack.ts`, mirroring `convert-queue-stack.ts`
  (own stack so it can be deployed/destroyed independently; `terminationProtection`
  on prod; `Component=pipeline` tag).
- Build each machine with the L2 tasks construct
  `aws-stepfunctions-tasks.SqsSendMessage` + `integrationPattern:
  WAIT_FOR_TASK_TOKEN`, `messageBody` = the same claim fields + `JsonPath.taskToken`
  the inline ASL uses (parity check against `bootstrap-localstack.sh`), wrapped in a
  `sfn.StateMachine` (`stateMachineType: STANDARD`, `timeout: Duration.minutes(30)`,
  `logs: { destination: new LogGroup(...), level: ALL }`, `tracingEnabled: true`),
  with a `.addCatch(failState)`.
- **Queues are imported, not created here:** convert queue via
  `Queue.fromQueueArn(Fn.importValue('ClassificationConvertQueueArn-${env}'))`
  (exported by `ConvertQueueStack`); zip queue via
  `Queue.fromQueueArn(envConfig.zipExtractionQueueArn)`. The L2 task auto-grants the
  **execution role** `sqs:SendMessage` on the target queue (`grantSendMessages`).
- `CfnOutput` `ConvertPipelineArn-${env}` / `ZipPipelineArn-${env}` (+ `exportName`).
- One CloudWatch alarm per machine on `metricFailed()` + `metricTimedOut()`
  (replaces the convert-watchdog's DLQ-depth alarm role over time).
- Wire in `bin/app.ts`: `new ClassificationPipelineStack(app,
  \`ClassificationPipeline-${env}\`, { env, envConfig })` with
  `.addDependency(convertQueueStack)` (needs the convert-queue export).
- **cdk-nag:** `StateMachine` logging + X-Ray on satisfy SF1/SF2; add targeted
  `NagSuppressions` only if the L2 exec role trips IAM5 on the queue grant.

### 2.2 EnvConfig — minimal
ARNs are **deterministic from name+account+region**, so no new cross-stack wiring
into Helm is required. Add nothing to `config/types.ts` unless we want the alarm
thresholds configurable. (Router Helm hardcodes the per-env ARN — see 2.4.)

### 2.3 Router IRSA — `states:StartExecution` (+ Describe)
- `units/ingestion-service/ingestion-subgraph/deploy/iam/ingestion-subgraph-irsa-perms.json`:
  add a statement `StepFunctionStart` —
  `states:StartExecution` + `states:DescribeExecution` + `states:GetExecutionHistory`
  on the two state-machine ARNs (and `…:execution:<name>:*` for Describe/History).
- **Coordinate with BFF WS-2**, which already rewrites this same file (tables/bucket/
  queues). The SFN statement is additive; land both in one rewrite.
- Note: with SFN active the router no longer needs to `sqs:SendMessage` to the stage
  queues itself (the exec role does) — keep the SQS grant for the non-SFN fallback
  path, or drop it once SFN is the only mode.

### 2.4 Router Helm — set the two ARN envs
- `deploy/helm/ingestion-subgraph/` ConfigMap: add
  `STATE_MACHINE_ARN=arn:aws:states:eu-west-1:537462380503:stateMachine:classification-convert-pipeline-dev`
  and `ARCHIVE_STATE_MACHINE_ARN=…:classification-zip-pipeline-dev`.
- With **both** set the router logs `pipeline=sfn` and routes convert+archive through
  `StartExecution`. **Leaving `ARCHIVE_STATE_MACHINE_ARN` unset** keeps archive on
  the direct-dispatch fallback — the clean lever to ship **P1 first, P2 later**
  (when the sibling service is ready). `ErrPipelineNotConfigured → "skipped"`.

### 2.5 Convert-worker IRSA — `states:SendTaskSuccess/Failure`
- The worker runs as a pod with role `convert-worker-irsa` (per the BFF facts);
  its policy is **not in this repo** (out-of-band / under a deploy dir to locate).
- Add `StepFunctionSignal`: `states:SendTaskSuccess` + `states:SendTaskFailure`,
  `Resource: "*"` (task tokens are not ARN-scopable — same as `lambda-stack.ts`'s
  Lambda grant pattern, except resource `*`).
- Worker needs no new env (the `taskToken` arrives in the SQS message; it already
  uses the real SFN endpoint when `AWS_ENDPOINT_URL` is empty, region `eu-west-1`).

### 2.6 External `zip-extraction-service-demo` (separate repo — flagged, not WS-7 code)
- Build/push its token-protocol image (the `taskToken` field + the SFN signaler) and
  deploy to its dev05 deployment; grant **its** IRSA role `states:SendTaskSuccess/Failure`.
- Confirm the `zip-extraction-dev05` queue ARN (the P2 machine's target).
- **Until this lands, do not set `ARCHIVE_STATE_MACHINE_ARN` on the router** (2.4) —
  otherwise every archive upload waits 30 min then fails.

### 2.7 Watchdog retirement (deferred, after P1 verified)
- `deploy/k8s/convert-watchdog-cronjob.yaml` + the `reapStuckConverts` path stay
  **as-is** until P1-on-dev05 is verified; then disable the CronJob (SFN
  `TimeoutSeconds`+`Catch`+the new alarms replace it). Don't delete in WS-7.

### 2.8 Makefile / orchestration
- New target to `cdk deploy ClassificationPipeline-${ENV}` (after Data + ConvertQueue).
- Deploy order: ConvertQueue (+ confirm zip queue) → **PipelineStack** → router Helm
  (with ARNs) + worker IRSA → (P2) external zip-extraction deploy.
- Reuse the existing image-build/push targets (router + worker images already carry
  the SFN code on this branch — just rebuild+push to ECR).

---

## 3. Operator-gated execution (needs dev05 creds I don't have)
1. `cdk deploy ClassificationPipeline-dev` (creates 2 SMs + exec role + log groups + alarms).
2. Create/extend IRSA roles: **router** (+`states:StartExecution`/Describe),
   **convert-worker** (+`states:SendTask*`), **zip-extraction** (+`states:SendTask*`, separate repo).
3. Build + push `ingestion-subgraph` and `classification-convert-worker` images
   (this branch's SFN code) to ECR.
4. `helm upgrade` the router with the two ARN envs (P1 first → archive ARN later).
5. (P2) deploy the external zip-extraction signaled build + grant its IRSA.
6. Confirm dev05 facts: account `537462380503`, region `eu-west-1`, cluster
   `DEV05-EKS-CLUSTER`, ns `classification-service-sandbox`, queue `zip-extraction-dev05`.

## 4. Verification on dev05
- **P1:** upload `.docx` → router logs `pipeline=sfn` → `aws stepfunctions
  describe-execution` (name = documentId) `SUCCEEDED` → PDF in `classification-ui-dev05`.
- **P2:** upload `.zip` → zip execution `SUCCEEDED` once the sibling signals; if
  `TIMED_OUT` after 30 min, the external service isn't deployed/granted yet.
- Alarms green; then disable the convert-watchdog CronJob.

## 5. Risks / watch-items
- **Sequencing:** WS-7 is meaningless without BFF WS-3/4/6 (router+worker pods) live.
- **P2 cross-repo gate:** archive succeeds only after the external service deploys.
- **ASL ↔ CDK parity:** the L2 `SqsSendMessage.messageBody` must reproduce the inline
  ASL's field map + `$$.Task.Token` exactly — diff against `bootstrap-localstack.sh`.
- **cdk-nag** on the new `StateMachine` (logging/X-Ray handled; possible IAM5 on the
  auto-granted queue send — suppress with rationale if it fires).

## 6. Effort
WS-7 **code** = 1 new CDK stack file + 1 `bin/app.ts` wire-up + 1 router-IRSA JSON
edit + 1 convert-worker-IRSA JSON (author) + router Helm ConfigMap env + 1 Makefile
target. All doable on this branch now. **Execution** is operator-gated and should
follow the BFF dev05 rollout.
