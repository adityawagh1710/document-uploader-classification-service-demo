#!/bin/sh
# Idempotent LocalStack seed for the ingestion router: staging bucket + the
# workspaces/documents tables (documents has a workspaceId-index GSI) + the
# classify input queue the router dispatches StageRequest:classify to (this is
# the classification <-> ingestion link). Mirrors classification's bootstrap
# pattern; safe to re-run (every create is `|| true`).
set -e

ENDPOINT="${AWS_ENDPOINT_URL:-http://localstack:4566}"
BUCKET="${DOCUPLOADER_STAGING_BUCKET:-classification-ui-bucket}"
WS_TABLE="${WORKSPACES_TABLE_NAME:-workspaces-ui}"
DOC_TABLE="${DOCUMENTS_TABLE_NAME:-documents-ui}"
CLASSIFY_QUEUE_NAME="${CLASSIFY_QUEUE_NAME:-classification-classify-queue}"

echo "Seeding ingestion LocalStack at $ENDPOINT ..."

aws --endpoint-url="$ENDPOINT" s3 mb "s3://$BUCKET" 2>/dev/null || true

aws --endpoint-url="$ENDPOINT" dynamodb create-table \
  --table-name "$WS_TABLE" \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST 2>/dev/null || true

aws --endpoint-url="$ENDPOINT" dynamodb create-table \
  --table-name "$DOC_TABLE" \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=workspaceId,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"workspaceId-index","KeySchema":[{"AttributeName":"workspaceId","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST 2>/dev/null || true

# Classify input queue. classification's classify stage consumes this; the
# router dispatches StageRequest:classify here.
aws --endpoint-url="$ENDPOINT" sqs create-queue --queue-name "$CLASSIFY_QUEUE_NAME" 2>/dev/null || true

echo "Seed complete: bucket=$BUCKET tables=$WS_TABLE,$DOC_TABLE queue=$CLASSIFY_QUEUE_NAME"
