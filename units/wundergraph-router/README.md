# wundergraph-router (Go)

Document-uploader **ingestion front door** (POC) — a Go GraphQL gateway (gqlgen)
over the shared wire contract. The UI talks GraphQL to this; it mints presigned
uploads (S3 claim-check) and dispatches `StageRequest`s into the pipeline.

> POC scope per `../../WunderGraph_Router_POC_Plan.md`. gqlgen stands in for the
> Cosmo router; resolvers are hand-written. Real Go ingestion tier is 6 units
> (router + 3 resolvers + 2 lambdas) — out of scope here.

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
  go run ./cmd/wundergraph-router
```

The router dispatches `StageRequest:classify` to `classification-classify-queue`
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
