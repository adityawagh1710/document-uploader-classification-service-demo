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
DEFAULT_WORKSPACE_ID="${DEFAULT_WORKSPACE_ID:-wks-ui-001}"

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

echo "Bootstrap complete: bucket=$BUCKET tables=$CH_TABLE,$WC_TABLE,$CL_TABLE workspace=$DEFAULT_WORKSPACE_ID"
