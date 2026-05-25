# Deployment Architecture — U-4 `infrastructure`

> Multi-account deployment flow + per-environment checklist + rollback + DR + service tear-down + service-wide cost estimate.

---

## 1. Multi-Account Deployment Diagram

```
                   ┌──────────────────────────────────────┐
                   │  GitHub Repository                    │
                   │  ${org}/classification-service        │
                   └──────────┬───────────────────────────┘
                              │ PR merge to main / workflow_dispatch
                              ▼
                   ┌──────────────────────────────────────┐
                   │  GitHub Actions Workflow              │
                   │  .github/workflows/deploy.yml         │
                   └──────────┬───────────────────────────┘
                              │ OIDC token
       ┌──────────────────────┼──────────────────────┐
       │                      │                       │
       ▼                      ▼                       ▼
  ┌──────────┐          ┌──────────┐           ┌──────────┐
  │   dev    │          │ staging  │           │   prod   │
  │ account  │          │ account  │           │ account  │
  │1111111111│          │2222222222│           │3333333333│
  └────┬─────┘          └────┬─────┘           └────┬─────┘
       │ assumeRole          │ assumeRole           │ assumeRole
       │ (push trigger)      │ (after dev)          │ (manual approval)
       ▼                     ▼                      ▼
  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
  │ cdk deploy     │    │ cdk deploy     │    │ cdk deploy     │
  │ -c env=dev     │    │ -c env=staging │    │ -c env=prod    │
  │ --all          │    │ --all          │    │ --all          │
  └────────────────┘    └────────────────┘    └────────────────┘
       │                     │                      │
       ▼                     ▼                      ▼
  ClassificationData-dev   ...staging-suffixed    ...prod-suffixed
  ClassificationLambda-dev (same 3 stacks)       (same 3 stacks)
  ClassificationObservability-dev               + termination protection ON
```

---

## 2. Per-Environment Deployment Checklist

### 2.1 One-Time Operator Setup (per account)

```bash
# (1) Bootstrap CDK in the account
aws sts assume-role --role-arn <admin-role-in-account> --role-session-name bootstrap
npx cdk bootstrap aws://<account>/us-east-1 --trust <account> \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/PowerUserAccess

# (2) Create the GitHub OIDC provider (if not already present in the account)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list <github-oidc-thumbprint>

# (3) Create the deploy role for the account (trust policy per Pattern P-4-5)
# IAM role: github-actions-deploy
# Trust condition: token.actions.githubusercontent.com:sub matches
#                  "repo:${org}/classification-service:ref:refs/heads/main"  (for dev/staging)
#                  "repo:${org}/classification-service:environment:prod"      (for prod)
# Permission: attached to AWSCloudFormationFullAccess scoped via SCP

# (4) Provision upstream stacks (State Machine, Document Bucket) per their own runbooks
#     OR provide fallback ARNs in infra/config/*.ts

# (5) Provision the alarms SNS topic in the observability stack
#     OR set up SSM parameter manually at /observability/sns-topic-arn/${env}

# (6) Set up GitHub environment protection
#     repo settings -> Environments -> create "prod" environment ->
#     add Required reviewers (operator group)
```

### 2.2 Per-PR Deploy Steps (automated)

1. PR merges to main with `infra/**` or `src/**` changes
2. `deploy-dev` job runs: assumes OIDC role in dev account, runs `cdk deploy --all -c env=dev --require-approval never`
3. On dev success, `deploy-staging` runs same flow against staging
4. On staging success, the workflow stops (prod requires manual)
5. Operator runs `workflow_dispatch` with `env: prod` to trigger the prod deploy job
6. GitHub blocks until manual approval via the prod environment-protection rule
7. On approval, `deploy-prod` runs: assumes OIDC role in prod, runs `cdk deploy --all -c env=prod --require-approval never`
8. Post-deploy: smoke test against deployed Lambda via `aws lambda invoke` with synthetic event

---

## 3. Rollback Procedure

### 3.1 Application Code Rollback (most common)

Per U-3 IaD §3.1 — alias swap to previous version. 5 minutes RTO.

### 3.2 CDK / Infrastructure Rollback

If a CDK change broke a stack:

```bash
# (1) Identify the bad change
git log infra/

# (2) Revert the change
git revert <bad-commit-sha>
git push   # triggers automatic dev/staging deploy of the revert

# (3) For prod, re-run workflow_dispatch with env=prod
#     (the revert commit takes effect)
```

If CloudFormation has already partially deployed and is in `UPDATE_ROLLBACK_FAILED` state:
- Use the AWS Console to manually continue rollback or roll forward
- Document the incident; CFN rollback failures are rare but require human intervention

### 3.3 Catastrophic AWS Account Loss

If a prod account is irrecoverably damaged (rare; AWS regional outage scenario):

1. Provision a new AWS account (or pre-provision a recovery account in another region)
2. Bootstrap CDK in the new account
3. Restore DDB content-hashes table from PITR backup (U-2 IaD §4.1) — RTO ~30 min, RPO ~5 min
4. Re-deploy via `cdk deploy --all -c env=prod` pointing at the new account
5. Update upstream State Machine to invoke the new Lambda ARN

**Combined service RTO**: ~60 minutes for account-loss recovery (mostly DDB PITR restore + verification).

---

## 4. Service Tear-Down Procedure (end of life)

If the service is retired (e.g., replaced or sunset):

1. **Disable termination protection** on prod stacks via console (per Pattern §7 of U-4 IaD)
2. **Disable DDB deletion protection** on both tables in prod
3. **Export DDB tables** to S3 if data retention is required (separate operation)
4. **Run `cdk destroy --all -c env=prod`** with manual confirmation
5. Repeat for staging and dev
6. **De-bootstrap** the accounts: `cdk bootstrap --show-template` to see remaining toolkit resources; delete manually if no other CDK apps in the account

CloudWatch logs and S3 assets persist after stack destruction (intentional — for post-mortem). Clean up separately when retention requirements are met.

---

## 5. Combined Service Cost Estimate (illustrative)

Per environment, summing across U-1 (no runtime), U-2 (DDB), U-3 (Lambda), U-4 (CloudWatch + KMS).

| Resource | dev | staging | prod (low) | prod (high) |
|---|---|---|---|---|
| Lambda (invocations + duration) | <$1 | <$2 | ~$50 | ~$500 |
| DynamoDB content-hashes (storage + ops + PITR) | <$1 | <$5 | ~$100 | ~$1000 |
| DynamoDB workspace-config | <$1 | <$1 | <$5 | <$5 |
| S3 (document storage — owned upstream, not in this estimate) | — | — | — | — |
| CloudWatch Logs (retention varies) | <$1 | ~$5 | ~$30 | ~$200 |
| CloudWatch metrics + custom metrics | <$1 | ~$2 | ~$10 | ~$100 |
| CloudWatch alarms (10 × $0.10) | $1 | $1 | $1 | $1 |
| X-Ray traces (5% sample) | <$1 | <$2 | ~$10 | ~$100 |
| Lambda Insights (staging+prod only) | $0 | ~$10 | ~$30 | ~$300 |
| KMS (AWS-managed; minimal) | <$1 | <$1 | <$1 | <$1 |
| **Total per env** | **<$10** | **<$30** | **~$240** | **~$2200** |

(Rough; real costs scale with document volume + workspace count. Largest variables: Lambda invocation count and DDB record count.)

---

## 6. Handoff to Code Generation (Phase 5/5)

U-4's Code Generation will materialise:

1. `infra/bin/app.ts` — CDK app entry-point with stack instantiation, tagging, cdk-nag aspect
2. `infra/lib/data-stack.ts` — `ClassificationDataStack` with DDB tables
3. `infra/lib/lambda-stack.ts` — `ClassificationLambdaStack` with Lambda + IAM + X-Ray sampling
4. `infra/lib/observability-stack.ts` — `ClassificationObservabilityStack` with 10 alarms + dashboard
5. `infra/lib/_test-helpers.ts` — Test helper from Pattern P-4-1
6. `infra/lib/data-stack.test.ts` + `lambda-stack.test.ts` + `observability-stack.test.ts` — Stack tests
7. `infra/config/types.ts` — `EnvConfig` interface
8. `infra/config/load.ts` + `load.test.ts` — Loader (Pattern P-4-3)
9. `infra/config/{dev,staging,prod}.ts` — Per-env values (with placeholder account IDs)
10. `cdk.json` — CDK config
11. `infra/tsconfig.json` — Separate compile unit
12. `infra/.eslintrc.cjs` — Extended config
13. `.github/workflows/ci.yml` — Full CI workflow (11 jobs)
14. `.github/workflows/deploy.yml` — Deploy workflow (3 deploy jobs)
15. `code-summary.md` — Documentation

Approximately **15-20 new files**.

---

## 7. Final Summary

U-4 closes out the Construction phase. The service has:
- **4 units of work**, each complete with its 5-stage Construction loop
- **~135 source + test files** across U-1 + U-2 + U-3
- **3 CDK stacks** in U-4 materialising all upstream decisions
- **11 CI gates** + **3 deploy jobs** with OIDC + environment-protection
- **15 SECURITY rules** evaluated, all compliant or N/A or with documented deviation
- **3 cdk-nag suppressions**, all documented with reasons

After U-4's Code Generation completes, the service moves to **Build and Test** — the final Construction-phase stage where everything is wired together for the first end-to-end verification.
