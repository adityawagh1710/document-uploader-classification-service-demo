#!/bin/sh
# Idempotent LocalStack seed: S3 bucket + DDB tables + default workspace row.
# Runs once at compose start (depends_on: bootstrap → service_completed_successfully).
# Safe to re-run; every create is followed by `|| true` because LocalStack
# returns 4xx on re-creation rather than the silent no-op real AWS gives.

set -e

ENDPOINT="${AWS_ENDPOINT_URL:-http://localstack:4566}"
BUCKET="${UI_S3_BUCKET:-classification-ui-bucket}"
CH_TABLE="${CONTENT_HASH_TABLE_NAME:-content-hashes-ui}"
WC_TABLE="${WORKSPACE_CONFIG_TABLE_NAME:-workspace-config-ui}"
CL_TABLE="${CLASSIFICATIONS_TABLE_NAME:-classifications-ui}"
EE_TABLE="${EMAIL_EXTRACTIONS_TABLE_NAME:-email-extractions-ui}"
PF_TABLE="${PIPELINE_FILES_TABLE_NAME:-pipeline_files}"
DEFAULT_WORKSPACE_ID="${DEFAULT_WORKSPACE_ID:-wks-ui-001}"
ZIP_EXTRACTION_QUEUE_NAME="${ZIP_EXTRACTION_QUEUE_NAME:-zip-extraction-queue}"
CONVERT_QUEUE_NAME="${CONVERT_QUEUE_NAME:-classification-convert-queue}"
CONVERT_DLQ_NAME="${CONVERT_DLQ_NAME:-classification-convert-queue-dlq}"

echo "Bootstrapping LocalStack at $ENDPOINT ..."

aws --endpoint-url="$ENDPOINT" s3 mb "s3://$BUCKET" 2>/dev/null || true

# Bucket CORS — required for the browser-direct UI to PUT bytes to presigned
# S3 URLs (the SPA uploads straight to S3; the preflight needs ACAO). On real
# AWS (dev05) the same CORS policy must be set on the staging bucket.
aws --endpoint-url="$ENDPOINT" s3api put-bucket-cors \
  --bucket "$BUCKET" \
  --cors-configuration '{"CORSRules":[{"AllowedOrigins":["*"],"AllowedMethods":["GET","PUT","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3000}]}' \
  2>/dev/null || true

aws --endpoint-url="$ENDPOINT" dynamodb create-table \
  --table-name "$CH_TABLE" \
  --attribute-definitions \
    AttributeName=workspaceId,AttributeType=S \
    AttributeName=contentHash,AttributeType=S \
  --key-schema \
    AttributeName=workspaceId,KeyType=HASH \
    AttributeName=contentHash,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST 2>/dev/null || true

aws --endpoint-url="$ENDPOINT" dynamodb create-table \
  --table-name "$WC_TABLE" \
  --attribute-definitions AttributeName=workspaceId,AttributeType=S \
  --key-schema AttributeName=workspaceId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST 2>/dev/null || true

# classifications — per-upload activity log powering the Recent table.
aws --endpoint-url="$ENDPOINT" dynamodb create-table \
  --table-name "$CL_TABLE" \
  --attribute-definitions \
    AttributeName=workspaceId,AttributeType=S \
    AttributeName=runId,AttributeType=S \
  --key-schema \
    AttributeName=workspaceId,KeyType=HASH \
    AttributeName=runId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST 2>/dev/null || true

# email-extractions — parsed email-extraction payloads, keyed by documentId.
# The router's classifyUploaded writes here on category=email; the UI reads it
# back via emailExtraction (durable replacement for the UI's in-memory cache).
aws --endpoint-url="$ENDPOINT" dynamodb create-table \
  --table-name "$EE_TABLE" \
  --attribute-definitions AttributeName=documentId,AttributeType=S \
  --key-schema AttributeName=documentId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST 2>/dev/null || true

# pipeline_files — the per-file ledger the zip-extraction stage service writes
# (PK pk, SK sk). Created here so `--profile pipeline` works against a fresh stack.
aws --endpoint-url="$ENDPOINT" dynamodb create-table \
  --table-name "$PF_TABLE" \
  --attribute-definitions \
    AttributeName=pk,AttributeType=S \
    AttributeName=sk,AttributeType=S \
  --key-schema \
    AttributeName=pk,KeyType=HASH \
    AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST 2>/dev/null || true

# Seed the default workspace row so the Lambda is invocable without first
# touching the UI (the UI's lazy provisioning will overwrite-equivalent this).
aws --endpoint-url="$ENDPOINT" dynamodb put-item \
  --table-name "$WC_TABLE" \
  --item "{
    \"workspaceId\":     {\"S\": \"$DEFAULT_WORKSPACE_ID\"},
    \"policyVersion\":   {\"S\": \"v1\"},
    \"threshold\":       {\"N\": \"0.5\"},
    \"maxZipDepth\":     {\"N\": \"5\"},
    \"quarantineMacros\":{\"BOOL\": false},
    \"slipsheetRules\":  {\"M\": {}},
    \"hashTtlDays\":     {\"NULL\": true}
  }" 2>/dev/null || true

# Stage queues + Step Functions state machines are generated from the single
# source of truth, stages.registry.json, by scripts/gen-stages.mjs. Each stage
# (whether a monorepo `unit` or an `external` own-repo service — see the
# registry's `source.type`) becomes a queue + a Standard state machine whose
# single task is sqs:sendMessage.waitForTaskToken; the stage worker signals the
# task token back. To add a stage: edit stages.registry.json, then run
#   node scripts/gen-stages.mjs
# >>> BEGIN generated: stage queues + state machines (scripts/gen-stages.mjs from stages.registry.json) >>>
# AUTO-GENERATED — do not edit by hand. Edit stages.registry.json then run:
#   node scripts/gen-stages.mjs

# ---- stage: convert (category=convert, source=unit) ----
aws --endpoint-url="$ENDPOINT" sqs create-queue --queue-name "classification-convert-queue-dlq" 2>/dev/null || true
__DLQ_ARN_convert="arn:aws:sqs:eu-west-1:000000000000:classification-convert-queue-dlq"
aws --endpoint-url="$ENDPOINT" sqs create-queue --queue-name "classification-convert-queue" --attributes "{\"VisibilityTimeout\":\"1800\",\"MessageRetentionPeriod\":\"1209600\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$__DLQ_ARN_convert\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}" 2>/dev/null || true
cat > /tmp/stage-convert.asl.json <<JSON
{ "Comment":"convert stage via sqs waitForTaskToken (generated from stages.registry.json)", "StartAt":"Convert",
  "States":{
    "Convert":{ "Type":"Task",
      "Resource":"arn:aws:states:::sqs:sendMessage.waitForTaskToken",
      "Parameters":{ "QueueUrl":"$ENDPOINT/000000000000/classification-convert-queue",
        "MessageBody":{
          "pipelineExecutionId.\$":"\$.pipelineExecutionId",
          "tenantId.\$":"\$.tenantId",
          "documentId.\$":"\$.documentId",
          "runId.\$":"\$.runId",
          "sourceBucket.\$":"\$.sourceBucket",
          "sourceKey.\$":"\$.sourceKey",
          "filename.\$":"\$.filename",
          "subCategory.\$":"\$.subCategory",
          "correlationId.\$":"\$.correlationId",
          "taskToken.\$":"\$\$.Task.Token" } },
      "TimeoutSeconds":1800,
      "Catch":[{ "ErrorEquals":["States.ALL"], "Next":"Failed" }], "End":true },
    "Failed":{ "Type":"Fail", "Error":"ConvertFailed" } } }
JSON
aws --endpoint-url="$ENDPOINT" stepfunctions create-state-machine \
  --name "classification-convert-pipeline" \
  --role-arn "arn:aws:iam::000000000000:role/sfn-exec" \
  --definition file:///tmp/stage-convert.asl.json 2>/dev/null || true

# ---- stage: archive (category=archive, source=external) ----
aws --endpoint-url="$ENDPOINT" sqs create-queue --queue-name "zip-extraction-queue" 2>/dev/null || true
cat > /tmp/stage-archive.asl.json <<JSON
{ "Comment":"archive stage via sqs waitForTaskToken (generated from stages.registry.json)", "StartAt":"Extract",
  "States":{
    "Extract":{ "Type":"Task",
      "Resource":"arn:aws:states:::sqs:sendMessage.waitForTaskToken",
      "Parameters":{ "QueueUrl":"$ENDPOINT/000000000000/zip-extraction-queue",
        "MessageBody":{
          "pipelineExecutionId.\$":"\$.pipelineExecutionId",
          "tenantId.\$":"\$.tenantId",
          "documentId.\$":"\$.documentId",
          "sourceBucket.\$":"\$.sourceBucket",
          "sourceKey.\$":"\$.sourceKey",
          "correlationId.\$":"\$.correlationId",
          "taskToken.\$":"\$\$.Task.Token" } },
      "TimeoutSeconds":1800,
      "Catch":[{ "ErrorEquals":["States.ALL"], "Next":"Failed" }], "End":true },
    "Failed":{ "Type":"Fail", "Error":"ZipExtractionFailed" } } }
JSON
aws --endpoint-url="$ENDPOINT" stepfunctions create-state-machine \
  --name "classification-zip-pipeline" \
  --role-arn "arn:aws:iam::000000000000:role/sfn-exec" \
  --definition file:///tmp/stage-archive.asl.json 2>/dev/null || true
# <<< END generated <<<

echo "Bootstrap complete: bucket=$BUCKET tables=$CH_TABLE,$WC_TABLE,$CL_TABLE,$EE_TABLE,$PF_TABLE workspace=$DEFAULT_WORKSPACE_ID (stage queues + state machines generated from stages.registry.json)"
