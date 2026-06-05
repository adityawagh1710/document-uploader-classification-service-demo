# classification-convert-worker

SQS poller that drives [office-convert](https://github.com/adityawagh1710/document-uploader-aspose-total-demo)'s `POST /v1/convert` for the auto-convert fan-out — i.e. classifications where `category === "convert"`.

```
┌────────────┐  SQS msg  ┌─────────┐  HTTP POST  ┌──────────────┐  S3 PUT  ┌────────────────────────────┐
│  /api/     │──────────▶│ poller  │────────────▶│ office-      │─────────▶│ s3://classification-ui-    │
│  classify  │           │ (loop)  │             │ convert      │          │   dev05/converted/<id>.pdf │
└────────────┘           └─────────┘             └──────────────┘          └────────────────────────────┘
                              │                                                       ▲
                              │  DDB UpdateItem                                       │
                              ▼  on classifications-dev                               │
                       ┌─────────────────┐                                            │
                       │  convertStatus  │                                            │
                       │   converting    │                                            │
                       │   done / failed │  presigned download served by              │
                       │   s3Key, …      │  classification UI (own IRSA)              │
                       └─────────────────┘──────────────────────────────────────────┘
```

## Lifecycle of one message

| Step | What happens |
|------|--------------|
| 1. Receive | Long-poll SQS (20s); pull at most 1 message at a time |
| 2. Parse | Validate body against `ConvertClaimSchema` (zod). Unparseable → delete (no DLQ pollution from poison-pill bodies) |
| 3. DWG short-circuit | `*.dwg` filenames → `markFailed(format_unsupported:dwg)` + delete. Saves a guaranteed 5xx from office-convert (no Aspose.CAD in the vendor path) |
| 4. Mark converting | `UpdateItem` on classifications-dev → `convertStatus=converting`, `convertStartedAt` (preserved on retries via `if_not_exists`), `convertAttempts` (= SQS `ApproximateReceiveCount`) |
| 5. POST office-convert | Multipart form: `s3_input=s3://<sourceBucket>/<sourceKey>` + `s3_output=s3://<sourceBucket>/converted/<documentId>.pdf` |
| 6a. 200 | `markDone` (s3Bucket, s3Key, X-Request-ID) + **`SendTaskSuccess`** (if `taskToken` present) + delete |
| 6b. 4xx | `markFailed(office_convert_<status>:<failure_class>)` + **`SendTaskFailure`** (if `taskToken`) + delete (no retry) |
| 6c. 5xx / network / timeout | Don't delete + **no signal** → SQS visibility-timeout fires → redelivered. After `maxReceiveCount=3` → DLQ + alarm. (When orchestrated by SFN, `TimeoutSeconds` is the backstop.) |

### Step Functions task token (SFN P1)

When this convert stage is driven by the `classification-convert-pipeline` state
machine (`sqs:sendMessage.waitForTaskToken`), each message body carries an
optional `taskToken`. `src/task-signaler.ts` calls `SendTaskSuccess`/`SendTaskFailure`
at the terminal branches above so the execution resumes; it is a **no-op when
`taskToken` is absent** (plain-SQS mode is unchanged). Transient failures
deliberately *don't* signal — SQS redrive + the SFN `TimeoutSeconds` are the
backstop. Uses the LocalStack endpoint via `AWS_ENDPOINT_URL`. See
`../../../aidlc-docs/operations/sfn/StepFunctions_Pipeline_Design.md`.

## Configuration (env vars)

| Required | Var | Meaning |
|---|---|---|
| ✔ | `CONVERT_QUEUE_URL` | Full SQS queue URL (regional). Exported by `ClassificationConvertQueueStack`. |
| ✔ | `OFFICE_CONVERT_BASE_URL` | Office-convert base URL. In-cluster: `http://office-convert.office-convert-dev.svc.cluster.local`. LocalStack-mode: `http://office-convert:8080` (compose link). |
| ✔ | `CLASSIFICATIONS_TABLE_NAME` | DDB table the UI Recent feed reads from. `classifications-dev` on dev05. |
| ✔ | `AWS_REGION` | Or `AWS_DEFAULT_REGION`. SDK uses this for endpoint resolution. |
|   | `AWS_ENDPOINT_URL` | LocalStack-mode override (`http://localstack:4566`). Empty in real-AWS mode. |
|   | `SQS_WAIT_TIME_SECONDS` | Long-poll seconds (default 20, max 20) |
|   | `SQS_MAX_MESSAGES` | Receive batch size (default 1; kept low because each msg = one ~30-min convert) |
|   | `OFFICE_CONVERT_TIMEOUT_MS` | HTTP timeout (default 1,800,000 = 30 min, matches SQS visibility) |
|   | `EXCLUDE_DWG` | Default `true`. Short-circuits `*.dwg` filenames as failed |
|   | `LOG_LEVEL` | debug \| info \| warn \| error (default info) |
|   | `WORKER_VERSION` | Build-time identifier (git SHA preferred); stamped into every log line |

## Local dev

```bash
cd worker
pnpm install
# Point at the LocalStack stack the UI's docker-compose brings up
export CONVERT_QUEUE_URL="http://localhost:4566/000000000000/classification-convert-queue"
export OFFICE_CONVERT_BASE_URL="http://localhost:8080"
export CLASSIFICATIONS_TABLE_NAME="classifications-ui"
export AWS_REGION="us-east-1"
export AWS_ENDPOINT_URL="http://localhost:4566"
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
npm run dev   # tsx src/main.ts
```

## Tests

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run (unit tests only)
```

Unit tests cover: config env-var parsing, message schema validation, every handler outcome branch (success / 4xx / 5xx / network / timeout / DWG short-circuit / DDB row missing). No SDK over the wire — `aws-sdk-client-mock`-style `vi.fn()` stubs on the deps.

## Docker

```bash
# from repo root (build context must see worker/)
docker build -f worker/Dockerfile -t classification-convert-worker:dev .
```

## Wire-up

This branch (`feat/03-convert-worker`) is **code only** — no deploy artifacts yet. The next branches add:

- **feat/04** — Helm chart + IRSA role JSON + Makefile `[deploy]` targets + LocalStack docker-compose link
- **feat/05** — `/api/classify` fan-out that produces convert messages to the queue
- **feat/06** — UI Recent table "Conversion" column + polling
- **feat/07** — Phase 2 observability: progress proxy + DLQ alarm + watchdog
