# ingestion-subgraph (Go)

The Go server of the **ingestion-service** unit — a gqlgen **Apollo Federation v2
subgraph** over the shared wire contract. It mints presigned uploads (S3
claim-check) and dispatches `StageRequest`s into the pipeline. **This subgraph is the
live router the UI talks to directly** — in the running stack/compose it *is* the
`router` service. The sibling **`../wundergraph-router/`** (the pulled WunderGraph
Cosmo gateway) is a **POC** of the intended UI → gateway → subgraph topology; it is
**not** wired into the running stack, CI, or Helm.

> POC scope per `../../../aidlc-docs/operations/wundergraph/WunderGraph_Router_POC_Plan.md`. Resolvers are
> hand-written; this is one subgraph (no `@key` entities yet). The full Go
> ingestion tier is 6 units (router + 3 resolvers + 2 lambdas) — out of scope here.

## GraphQL surface

`workspaces` · `documents(workspaceId)` · `document(id)` · `stats` ·
`createWorkspace` · `createDocument` (→ presigned PUT) ·
`classifyDocument` (→ dispatch `StageRequest:classify`) ·
`documentStatusChanged` subscription (graphql-transport-ws).

## Backends (`BACKEND` env)

- **`memory`** (default): in-memory store + stub presign + logging dispatcher. No AWS.
- **`aws`**: DynamoDB store + S3 presign + SQS dispatch. Endpoint-configurable via
  `AWS_ENDPOINT_URL` — same binary on **LocalStack** (local, static creds) and
  **dev05** (real AWS, IRSA).

## Step Functions dispatch (`PipelineStarter`)

When `STATE_MACHINE_ARN` (convert) and/or `ARCHIVE_STATE_MACHINE_ARN` (archive)
are set, `classifyUploaded` routes the post-classify stage through Step Functions
instead of a raw SQS dispatch: `internal/awsadapters/sfn_starter.go` does
`states:StartExecution` (execution name = `documentId`, idempotent; input = the
`ConvertClaim`/`ArchiveClaim` JSON). The state machine then dispatches to the
convert / zip-extraction queue via `sqs:sendMessage.waitForTaskToken` and owns
retry/timeout/catch (replacing the convert-watchdog). Unset ARN → that branch is
reported `skipped` (`app.ErrPipelineNotConfigured`). Startup logs
`pipeline=sfn convertArn=… archiveArn=…`. See `../../../aidlc-docs/operations/sfn/StepFunctions_Pipeline_Design.md`.

## Local run (LocalStack + classification↔ingestion link)

```bash
docker compose -f deploy/local/docker-compose.yml up -d   # LocalStack + seed
QUEUE_CLASSIFY=$(aws --endpoint-url http://localhost:4566 sqs get-queue-url \
    --queue-name classification-classify-queue --query QueueUrl --output text)
BACKEND=aws AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=eu-west-1 \
  AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  DOCUPLOADER_STAGING_BUCKET=classification-ui-bucket \
  WORKSPACES_TABLE_NAME=workspaces-ui DOCUMENTS_TABLE_NAME=documents-ui \
  QUEUE_CLASSIFY="$QUEUE_CLASSIFY" PORT=8099 \
  go run ./cmd/ingestion-subgraph
```

The subgraph dispatches `StageRequest:classify` to `classification-classify-queue`
— the queue classification's classify stage consumes (the connect point).

## Verified (P4, live against LocalStack)

`createWorkspace`→DynamoDB · `createDocument`→DynamoDB + real signed S3 presigned
URL · `classifyDocument`→a valid `StageRequest` envelope on the classify queue ·
`documents`→DynamoDB GSI query · status `PROCESSING/classify` persisted. All three
AWS services exercised through `BACKEND=aws`.

## Known POC limits

In-memory subscription bus (cross-process status from a stage not wired); no auth;
classification *consuming* the queue is a separate service. Deploy artifacts
(Dockerfile/Helm/IRSA/ECR) are **P6**; dev05 deploy is **P7**.
