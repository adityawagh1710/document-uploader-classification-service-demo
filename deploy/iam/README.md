# IAM (IRSA) templates

Out-of-band IAM artifacts the deploy uses — IAM creation is not in CDK
(Option A constraints, see [`deploy/AWS_TOPOLOGY.md`](../AWS_TOPOLOGY.md)).
Templates here are applied with `aws iam create-role` + `put-role-policy`
once per role per account; Helm only annotates the SA with the role ARN.

## Roles

| Role | Files | Used by |
|---|---|---|
| `classification-ui-irsa` | inline in `deploy/AWS_TOPOLOGY.md` §3 | `classification-ui` SA (Option A — UI runs the classifier in-process) |
| `convert-worker-irsa` | `convert-worker-irsa-trust.json` + `convert-worker-irsa-perms.json` | `convert-worker` SA (auto-convert fan-out poller, feat/03+04) |

## Apply `convert-worker-irsa` on dev05 (one-time)

```bash
PROFILE=opus2-dev
AWS_ACCOUNT_ID=537462380503

# 1. Create the role
aws iam create-role \
  --role-name convert-worker-irsa \
  --assume-role-policy-document file://deploy/iam/convert-worker-irsa-trust.json \
  --tags Key=Owner,Value=platform-team Key=CostCenter,Value=tbd \
         Key=Service,Value=classification-service Key=Environment,Value=dev \
         Key=Component,Value=convert-worker Key=ManagedBy,Value=manual-dev05 \
  --profile $PROFILE

# 2. Attach the inline policy
aws iam put-role-policy \
  --role-name convert-worker-irsa \
  --policy-name convert-worker-access \
  --policy-document file://deploy/iam/convert-worker-irsa-perms.json \
  --profile $PROFILE

# 3. Capture the role ARN — needed by helm:
aws iam get-role --role-name convert-worker-irsa \
  --query 'Role.Arn' --output text --profile $PROFILE
# → arn:aws:iam::537462380503:role/convert-worker-irsa
```

The trust policy is **name-scoped** to `system:serviceaccount:classification-service-sandbox:convert-worker`. Changing the namespace or the SA name in `values.yaml` requires editing the trust policy and re-applying.

## What the perms grant + why

- **`PollConvertQueue`** — `sqs:ReceiveMessage` + `DeleteMessage` + `GetQueueAttributes` + `ChangeMessageVisibility` on the convert queue ARN. Scoped to the exact ARN exported by `ClassificationConvertQueueStack` — not wildcarded. `ChangeMessageVisibility` is reserved for future "I'm still working, extend my lease" patterns; harmless to grant now.
- **`UpdateClassificationsRow`** — `dynamodb:UpdateItem` + `DescribeTable` on `classifications-dev`. No `PutItem` (the row already exists when the worker fires — created by `/api/classify` with `convertStatus=queued` in feat/05). No `GetItem`/`Query` (the SQS message carries the runId; no lookup needed).
- **`DecryptSqsKmsManaged`** — SQS queue is `KMS_MANAGED` (`alias/aws/sqs`); the worker needs `kms:Decrypt` to read message bodies. Restricted by the `kms:ViaService` condition so the wildcard resource is scoped to SQS-only KMS calls.

## What's NOT granted (intentional)

- No S3 access — office-convert reads the input + writes the output using its
  own IRSA (`office-convert-dev-s3`), per the cross-service grant in branch 01
  of the office-convert repo. The worker just hands off S3 URIs as form fields.
- No SNS — the DLQ alarm publishes from CloudWatch, not from this role.
- No SQS `SendMessage` — the worker is a consumer; `/api/classify` (with the
  `classification-ui-irsa` role) is the producer.
