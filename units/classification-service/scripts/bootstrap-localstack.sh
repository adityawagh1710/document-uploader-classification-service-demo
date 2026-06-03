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
DEFAULT_WORKSPACE_ID="${DEFAULT_WORKSPACE_ID:-wks-ui-001}"
ZIP_EXTRACTION_QUEUE_NAME="${ZIP_EXTRACTION_QUEUE_NAME:-zip-extraction-queue}"
CONVERT_QUEUE_NAME="${CONVERT_QUEUE_NAME:-classification-convert-queue}"
CONVERT_DLQ_NAME="${CONVERT_DLQ_NAME:-classification-convert-queue-dlq}"

echo "Bootstrapping LocalStack at $ENDPOINT ..."

aws --endpoint-url="$ENDPOINT" s3 mb "s3://$BUCKET" 2>/dev/null || true

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

# SQS queue for archive fan-out to the zip-extraction service. Classifier
# Lambda publishes a claim-check here when category=archive.
aws --endpoint-url="$ENDPOINT" sqs create-queue \
  --queue-name "$ZIP_EXTRACTION_QUEUE_NAME" 2>/dev/null || true

# SQS queues for the auto-convert fan-out (category=convert). DLQ first so
# the main queue's redrive policy points at a real ARN. Mirrors the dev05
# CDK shape (visibility 30 min, redrive maxReceiveCount=3).
aws --endpoint-url="$ENDPOINT" sqs create-queue \
  --queue-name "$CONVERT_DLQ_NAME" 2>/dev/null || true

DLQ_ARN="arn:aws:sqs:us-east-1:000000000000:$CONVERT_DLQ_NAME"
aws --endpoint-url="$ENDPOINT" sqs create-queue \
  --queue-name "$CONVERT_QUEUE_NAME" \
  --attributes "{
    \"VisibilityTimeout\":\"1800\",
    \"MessageRetentionPeriod\":\"1209600\",
    \"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"
  }" 2>/dev/null || true

echo "Bootstrap complete: bucket=$BUCKET tables=$CH_TABLE,$WC_TABLE,$CL_TABLE,$EE_TABLE workspace=$DEFAULT_WORKSPACE_ID queues=$ZIP_EXTRACTION_QUEUE_NAME,$CONVERT_QUEUE_NAME(+dlq)"
