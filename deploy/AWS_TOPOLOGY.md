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
  --assume-role-policy-document file://trust.json --profile opus2-dev
aws iam put-role-policy --role-name classification-ui-irsa \
  --policy-name classification-ui-access \
  --policy-document file://perms.json --profile opus2-dev
```

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

```bash
helm upgrade --install classification-ui deploy/helm/classification-ui \
  -f deploy/helm/classification-ui/values.yaml \
  -f deploy/helm/classification-ui/values-aws.yaml \
  --namespace classification-service-sandbox --create-namespace \
  --set image.repository=537462380503.dkr.ecr.eu-west-1.amazonaws.com/classification-ui \
  --set image.tag=$(git rev-parse --short HEAD) \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=arn:aws:iam::537462380503:role/classification-ui-irsa
```
(Build + push the image first via the existing `make image-build image-push`,
or wire these flags into `make deploy-dev` with `HELM_EXTRA_ARGS`.)

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
helm uninstall classification-ui -n classification-service-sandbox
# Optional — these persist data; delete only if you want a clean slate:
#   aws dynamodb delete-table --table-name content-hashes-dev  (or `cdk destroy ClassificationData-dev`)
#   aws s3 rb s3://classification-ui-dev05 --force
#   aws iam delete-role-policy / delete-role  for classification-ui-irsa
```

## Local is unaffected

`npm run dev` and `docker compose up` set neither `CLASSIFIER_AWS_MODE` nor a
real role, so they stay on LocalStack exactly as before. The default Helm
profile (no `-f values-aws.yaml`) still deploys the in-cluster LocalStack
sibling.
