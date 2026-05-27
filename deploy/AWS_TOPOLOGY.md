# Real-AWS Topology on dev05 (Option A)

**Goal:** run the Classification UI against **real AWS** DynamoDB + S3 on the
dev05 EKS cluster, while **local stays on LocalStack** with zero changes.

**Option A** = the UI runs the classifier **in-process** (the same code path it
uses locally) but pointed at real AWS data services via **IRSA**. There is **no
Lambda and no Step Functions** — those are the production deployment shape and
are deferred until the real upstream document-ingestion pipeline exists.

```
 LOCAL                                  dev05 (real AWS, Option A)
 ┌───────────────────────────┐          ┌──────────────────────────────┐
 │ npm run dev / docker-      │          │ classification-ui pod         │
 │ compose                    │          │  (CLASSIFIER_AWS_MODE=true)   │
 │  CLASSIFIER_AWS_MODE unset │          │      │ IRSA web-identity      │
 │      │                     │          │      ▼                        │
 │      ▼                     │          │  real DynamoDB + S3           │
 │  LocalStack :4566          │          │  (eu-west-1, 537462380503)    │
 └───────────────────────────┘          └──────────────────────────────┘
```

## How the switch works (no code edits needed to flip it)

| Signal | Local (LocalStack) | dev05 (real AWS) |
|--------|--------------------|------------------|
| `CLASSIFIER_AWS_MODE` | unset / `false` | `true` (set by `values-aws.yaml`) |
| SDK credentials | static `test` / `test` | **none passed** → IRSA web-identity token |
| SDK endpoint | `http://localstack:4566` | regional (SDK-resolved) |
| S3 addressing | path-style + checksum relaxation | virtual-hosted + SDK defaults |
| Auto-provision tables/bucket | yes (on cold start) | **no-op** (CDK / out-of-band own them) |

The pod env in AWS mode **omits** `AWS_ENDPOINT_URL` / `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` entirely (the chart gates `localstackConfig` on
`localstack.enabled`). This is required — the SDK default chain reads those env
vars *before* the IRSA token, so leaving `test` creds in the pod would silently
bypass IRSA.

---

## Prerequisites

- AWS CLI authenticated to the dev05 account `537462380503` (profile `opus2-dev`).
- `kubectl` context pointed at the dev05 cluster.
- The cluster's IAM OIDC provider URL (used in the IRSA trust policy):
  ```bash
  aws eks describe-cluster --name <cluster-name> --profile opus2-dev \
    --query 'cluster.identity.oidc.issuer' --output text
  # e.g. https://oidc.eks.eu-west-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE
  ```
  Strip the `https://` to get `<OIDC_PROVIDER>` used below.

Namespace / ServiceAccount this profile uses: **`classification-service-sandbox`** / **`classification-ui`**.

---

## Step 0 — Pre-flight checks (fail fast before deploying)

These catch the failures that *only* surface on real AWS — none are exercised by
LocalStack or CI.

**0a. Environment (run anytime):**
```bash
kubectl cluster-info                              # cluster reachable
aws sts get-caller-identity --profile opus2-dev   # profile resolves to account 537462380503
# IRSA REQUIRES an IAM OIDC provider associated with the cluster. Confirm one
# exists and matches the cluster issuer (from Prerequisites):
aws iam list-open-id-connect-providers --profile opus2-dev
#   If none matches, IRSA can NEVER work — associate it once:
#     eksctl utils associate-iam-oidc-provider --cluster <name> --region eu-west-1 --approve
```

**0b. IRSA gate — the highest-value check (run after Steps 1 + 3, i.e. tables + role exist):**
Assumes the role as the `classification-ui` ServiceAccount *from inside the
cluster*, lists the tables, and prints node architecture — retiring the
IRSA-trust, pod-egress, table-name, and node-arch risks in one shot **before**
the UI is deployed:
```bash
make irsa-smoketest DEPLOY_IRSA_ROLE_ARN=arn:aws:iam::537462380503:role/classification-ui-irsa
```
Expect: the assumed **role ARN** + the **3 tables** (`content-hashes-dev`,
`workspace-config-dev`, `classifications-dev`) + node arch **amd64** (the UI
image is `linux/amd64`; if nodes are arm64, rebuild for arm64). Only proceed to
Step 5 if this is green. The target uses a throwaway SA that it deletes
afterward, so `make deploy-dev` recreates the Helm-managed SA cleanly.

---

## Step 1 — Create the DynamoDB tables (CDK data-stack only)

`infra/config/dev.ts` already points dev at `eu-west-1` / `537462380503`.

```bash
cd infra
npm ci
npx cdk bootstrap aws://537462380503/eu-west-1 --profile opus2-dev   # once per acct/region
# Deploy ONLY the data-stack — not the Lambda/observability stacks.
npx cdk deploy ClassificationData-dev --profile opus2-dev
```

This creates `content-hashes-dev` and `workspace-config-dev` (PAY_PER_REQUEST,
AWS-managed encryption). Confirm:
```bash
aws dynamodb list-tables --region eu-west-1 --profile opus2-dev
```

> Stack name: confirm with `npx cdk list`. If it differs from
> `ClassificationData-dev`, use the listed name.

## Step 2 — Create the S3 bucket

No stack owns the bucket (it is imported from the upstream pipeline in prod).
For the sandbox, create it directly:
```bash
aws s3api create-bucket --bucket classification-ui-dev05 \
  --region eu-west-1 --create-bucket-configuration LocationConstraint=eu-west-1 \
  --profile opus2-dev
# Tag to match the CDK schema (or run `make tag-resources` later to reconcile all three):
aws s3api put-bucket-tagging --bucket classification-ui-dev05 --profile opus2-dev \
  --tagging 'TagSet=[{Key=Owner,Value=platform-team},{Key=CostCenter,Value=tbd},{Key=Service,Value=classification-service},{Key=Environment,Value=dev},{Key=Component,Value=ui},{Key=ManagedBy,Value=manual-dev05}]'
```
(Match `UI_S3_BUCKET` in `values-aws.yaml` if you choose a different name.)

## Step 3 — Create the IRSA role

**Trust policy** (`trust.json`) — lets the `classification-ui` SA assume the role:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::537462380503:oidc-provider/<OIDC_PROVIDER>" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": { "StringEquals": {
      "<OIDC_PROVIDER>:sub": "system:serviceaccount:classification-service-sandbox:classification-ui",
      "<OIDC_PROVIDER>:aud": "sts.amazonaws.com"
    }}
  }]
}
```

**Permissions policy** (`perms.json`) — least-priv for Option A:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Tables",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:Query","dynamodb:DescribeTable"],
      "Resource": [
        "arn:aws:dynamodb:eu-west-1:537462380503:table/content-hashes-dev",
        "arn:aws:dynamodb:eu-west-1:537462380503:table/workspace-config-dev",
        "arn:aws:dynamodb:eu-west-1:537462380503:table/classifications-dev"
      ]
    },
    {
      "Sid": "HealthProbe",
      "Effect": "Allow",
      "Action": ["dynamodb:ListTables"],
      "Resource": "*"
    },
    {
      "Sid": "Bucket",
      "Effect": "Allow",
      "Action": ["s3:GetObject","s3:PutObject"],
      "Resource": "arn:aws:s3:::classification-ui-dev05/*"
    }
  ]
}
```

> **Optional — archive fan-out to zip-extraction.** The UI publishes a
> claim-check to the sibling zip-extraction service's SQS queue when
> classification returns `category=archive`. `values-aws.yaml` now points
> `ZIP_EXTRACTION_QUEUE_URL` at the **live** queue the zip-extraction service
> already runs on dev05 — `https://sqs.eu-west-1.amazonaws.com/537462380503/zip-extraction-dev05`
> (owned by that service; do NOT create or delete it). If the URL is blanked,
> the UI silently skips the dispatch and classification still succeeds.
>
> **Verified 2026-05-27 with a live test claim-check:** the consumer accepts
> our message schema (`{pipelineExecutionId, tenantId, documentId,
> sourceBucket, sourceKey, correlationId}`) and fetches the object from the
> **message's** `sourceBucket`/`sourceKey` (not its own configured uploads
> bucket). The message was consumed without ever hitting the DLQ. The only
> gap is IAM — two grants are required:
>
> 1. **This IRSA role → `sqs:SendMessage`** on the queue (add the statement
>    below to `perms.json` before creating the role, or attach it after):
> ```json
> {
>   "Sid": "ZipExtractionFanOut",
>   "Effect": "Allow",
>   "Action": ["sqs:SendMessage"],
>   "Resource": "arn:aws:sqs:eu-west-1:537462380503:zip-extraction-dev05"
> }
> ```
> 2. **The `zip-extraction-dev05` role → `s3:GetObject`** on our bucket, else
>    the consumer 403s on download (observed in its logs:
>    `AccessDenied … s3:GetObject on classification-ui-dev05/…`). Grant it on
>    OUR side via a bucket policy on `classification-ui-dev05` (keeps the
>    change off the other service's role):
> ```json
> {
>   "Sid": "AllowZipExtractionRead",
>   "Effect": "Allow",
>   "Principal": { "AWS": "arn:aws:iam::537462380503:role/zip-extraction-dev05" },
>   "Action": "s3:GetObject",
>   "Resource": "arn:aws:s3:::classification-ui-dev05/ui/*"
> }
> ```
> `classifications-dev` backs the Recent-classifications feed (one row per upload,
> with the S3 object reference). `s3:GetObject` above also covers the **presigned
> download** the Result panel mints on row-click (the URL is signed with the
> pod's IRSA credentials, valid ~5 min). The CDK data-stack creates
> `classifications-dev` alongside the other two tables in Step 1.
> `dynamodb:ListTables` (resource `*`, account-level) backs `/api/health`,
> which the pod readiness/liveness probes call. Drop it only if you also switch
> the health check to `DescribeTable`.

```bash
aws iam create-role --role-name classification-ui-irsa \
  --assume-role-policy-document file://trust.json --profile opus2-dev \
  --tags Key=Owner,Value=platform-team Key=CostCenter,Value=tbd Key=Service,Value=classification-service Key=Environment,Value=dev Key=Component,Value=ui Key=ManagedBy,Value=manual-dev05
aws iam put-role-policy --role-name classification-ui-irsa \
  --policy-name classification-ui-access \
  --policy-document file://perms.json --profile opus2-dev
```

> **Consistent tagging:** the bucket, role, and ECR repo are created outside CDK,
> so tag them to match the CDK schema (`Owner / CostCenter / Service / Environment
> / Component=ui / ManagedBy=manual-dev05`). The create commands above bake the
> tags in; to reconcile existing resources in one shot run **`make tag-resources`**
> (`deploy/scripts/tag-resources.sh`). The CDK-managed DynamoDB tables + CFN stack
> already carry the schema (`Component=data`, `ManagedBy=cdk`).

## Step 4 — Seed the default workspace row (one-time)

Auto-seeding is disabled in AWS mode, so seed `wks-ui-001` once:
```bash
aws dynamodb put-item --table-name workspace-config-dev --region eu-west-1 --profile opus2-dev \
  --item '{
    "workspaceId": {"S": "wks-ui-001"},
    "policyVersion": {"S": "v1"},
    "threshold": {"N": "0.5"},
    "maxZipDepth": {"N": "5"},
    "quarantineMacros": {"BOOL": false},
    "slipsheetRules": {"M": {}},
    "hashTtlDays": {"NULL": true}
  }'
```

## Step 5 — Deploy the UI with the aws profile

**Gate:** only run this once `make irsa-smoketest` (Step 0b) is green.

The `make deploy-dev` pipeline builds + pushes the image, then `helm upgrade`
with the aws profile (`DEPLOY_BACKEND=aws` layers `values-aws.yaml` + the SA
role-arn annotation), waits for readiness, and prints a summary:
```bash
make deploy-dev DEPLOY_BACKEND=aws \
  DEPLOY_IRSA_ROLE_ARN=arn:aws:iam::537462380503:role/classification-ui-irsa \
  DEPLOY_IMAGE_TAG=$(git rev-parse --short HEAD)
```
Equivalent raw Helm (if you prefer to drive it by hand):
```bash
helm upgrade --install classification-ui deploy/helm/classification-ui \
  -f deploy/helm/classification-ui/values.yaml \
  -f deploy/helm/classification-ui/values-aws.yaml \
  --namespace classification-service-sandbox --create-namespace \
  --set image.repository=537462380503.dkr.ecr.eu-west-1.amazonaws.com/classification-service-sandbox/classification-service-ui \
  --set image.tag=$(git rev-parse --short HEAD) \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=arn:aws:iam::537462380503:role/classification-ui-irsa \
  --wait --timeout=5m
```

## Step 6 — Verify

```bash
kubectl -n classification-service-sandbox rollout status deploy/classification-ui
kubectl -n classification-service-sandbox port-forward svc/classification-ui 3000:80 &
curl -s localhost:3000/api/health | jq        # ready:true, tables include content-hashes-dev
curl -s localhost:3000/api/target | jq         # backend:"real-aws", endpoint:"aws:eu-west-1"
```
Then classify a document in the dashboard and confirm the row lands in real
`content-hashes-dev` (`aws dynamodb scan --table-name content-hashes-dev ...`).

---

## Teardown

```bash
# App only (KEEPS data — route53 + helm + namespace; tables/bucket/role retained):
make undeploy-dev DEPLOY_INGRESS_HOST=classification-ui-dev-sandbox-v1.dev05.k8s.opus2dev.com DEPLOY_ROUTE53_ZONE_ID=Z045669519R5D9D8CKC79

# Full clean slate INCL. DATA — undeploy-dev + destroy DDB stack + S3 bucket + IRSA role.
# Gated: refuses unless DEPLOY_NUKE_DATA=true (irreversible — deletes all rows + uploads):
make undeploy-all DEPLOY_NUKE_DATA=true \
  DEPLOY_INGRESS_HOST=classification-ui-dev-sandbox-v1.dev05.k8s.opus2dev.com \
  DEPLOY_ROUTE53_ZONE_ID=Z045669519R5D9D8CKC79

# Archive fan-out (if enabled): the zip-extraction SQS queue is SEPARATE infra and is
# NOT touched by undeploy-all — delete it manually if you provisioned one:
#   aws sqs delete-queue --queue-url <queue-url> --profile opus2-dev
```
> `make undeploy-dev` never touches the DynamoDB tables, S3 bucket, or IRSA role —
> those are kept by design. Only `make undeploy-all DEPLOY_NUKE_DATA=true` destroys
> them (DDB via `cdk destroy`, bucket via `aws s3 rb --force`, role via `aws iam`).
> The equivalent raw commands: `cdk destroy ClassificationData-dev`,
> `aws s3 rb s3://classification-ui-dev05 --force`, `aws iam delete-role-policy/delete-role`.

## Local is unaffected

`npm run dev` and `docker compose up` set neither `CLASSIFIER_AWS_MODE` nor a
real role, so they stay on LocalStack exactly as before. The default Helm
profile (no `-f values-aws.yaml`) still deploys the in-cluster LocalStack
sibling.
