#!/usr/bin/env bash
# Apply the standard resource-tag set to the dev05 out-of-band resources that
# are created outside CDK — the S3 bucket, the IRSA role, and the ECR repo — so
# they match the tag schema CDK already stamps on the DynamoDB tables + CFN
# stack (Owner / CostCenter / Service / Environment / Component / ManagedBy).
#
# Idempotent, additive, no data/security impact (tagging only). Run after the
# resources exist (Stages 2/3 + first image push). Defaults target dev05.
#
#   make tag-resources                 # uses the Makefile DEPLOY_* defaults
#   bash deploy/scripts/tag-resources.sh   # uses env vars / the defaults below
set -euo pipefail

AWS_PROFILE="${DEPLOY_AWS_PROFILE:-opus2-dev}"
REGION="${DEPLOY_AWS_REGION:-eu-west-1}"
ACCOUNT="${DEPLOY_AWS_ACCOUNT_ID:-537462380503}"
BUCKET="${DEPLOY_S3_BUCKET:-classification-ui-dev05}"
ROLE="${DEPLOY_IRSA_ROLE_NAME:-classification-ui-irsa}"
ECR_REPO="${DEPLOY_ECR_REPO:-classification-service-sandbox/classification-service-ui}"
export AWS_PROFILE

# Standard tag set — mirrors the CDK schema (infra/bin/app.ts + data-stack).
# Component=ui distinguishes the UI tier from the CDK data tier (Component=data);
# ManagedBy=manual-dev05 is honest — these are created out-of-band, not by CDK.
OWNER="${DEPLOY_TAG_OWNER:-platform-team}"
COSTCENTER="${DEPLOY_TAG_COSTCENTER:-tbd}"
SERVICE="${DEPLOY_TAG_SERVICE:-classification-service}"
ENVIRONMENT="${DEPLOY_TAG_ENV:-dev}"
COMPONENT="${DEPLOY_TAG_COMPONENT:-ui}"
MANAGEDBY="${DEPLOY_TAG_MANAGEDBY:-manual-dev05}"

# IAM / ECR shorthand: space-separated Key=,Value= pairs
PAIRS="Key=Owner,Value=$OWNER Key=CostCenter,Value=$COSTCENTER Key=Service,Value=$SERVICE Key=Environment,Value=$ENVIRONMENT Key=Component,Value=$COMPONENT Key=ManagedBy,Value=$MANAGEDBY"
# S3 TagSet shorthand: single bracketed list, no spaces
S3_TAGSET="TagSet=[{Key=Owner,Value=$OWNER},{Key=CostCenter,Value=$COSTCENTER},{Key=Service,Value=$SERVICE},{Key=Environment,Value=$ENVIRONMENT},{Key=Component,Value=$COMPONENT},{Key=ManagedBy,Value=$MANAGEDBY}]"

echo "Tagging dev05 out-of-band resources (Service=$SERVICE Environment=$ENVIRONMENT Component=$COMPONENT ManagedBy=$MANAGEDBY)"

aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging "$S3_TAGSET"
echo "  ok  S3   $BUCKET"

# shellcheck disable=SC2086
aws iam tag-role --role-name "$ROLE" --tags $PAIRS
echo "  ok  IAM  role/$ROLE"

# shellcheck disable=SC2086
aws ecr tag-resource --resource-arn "arn:aws:ecr:$REGION:$ACCOUNT:repository/$ECR_REPO" --tags $PAIRS
echo "  ok  ECR  $ECR_REPO"

echo "Done. Verify:"
echo "  aws s3api get-bucket-tagging --bucket $BUCKET --profile $AWS_PROFILE"
echo "  aws iam list-role-tags --role-name $ROLE --profile $AWS_PROFILE"
echo "  aws ecr list-tags-for-resource --resource-arn arn:aws:ecr:$REGION:$ACCOUNT:repository/$ECR_REPO --region $REGION --profile $AWS_PROFILE"
