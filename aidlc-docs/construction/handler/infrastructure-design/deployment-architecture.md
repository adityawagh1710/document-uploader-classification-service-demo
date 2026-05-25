# Deployment Architecture — U-3 `handler`

> Per-environment configuration, deployment flow, rollback procedure, cost estimate, and the U-3 → U-4 handoff list.

---

## 1. Per-Environment Configuration Matrix

U-3 specifications stay constant across environments; only the safety toggles and observability values vary.

| Setting | dev | staging | prod |
|---|---|---|---|
| Memory | 512 MB | 512 MB | 512 MB |
| Timeout | 30 s | 30 s | 30 s |
| Architecture | arm64 | arm64 | arm64 |
| Reserved concurrency | (unset) | (unset) | 100 |
| `LOG_LEVEL` | `DEBUG` | `INFO` | `INFO` |
| `POWERTOOLS_DEV` | `true` | `false` | `false` |
| `POWERTOOLS_LOGGER_SAMPLE_RATE` | `1.0` | `0.1` | `0.01` |
| Function name suffix | `-dev` | `-staging` | `-prod` |
| X-Ray sampling | reservoir=1, rate=0.5 (more traces in dev) | reservoir=1, rate=0.1 | reservoir=1, rate=0.05 |
| Alarm SNS topic | dev Slack only | staging Slack + email | PagerDuty + prod Slack + email |
| CloudWatch Logs retention | 7 days | 30 days | 90 days |
| Lambda Insights | Disabled (cost) | Enabled | Enabled |

**Per-environment differences** are managed by CDK config files (`infra/config/{dev,staging,prod}.ts`); U-3 provides the matrix, U-4 materialises it.

---

## 2. Deployment Flow

```
   ┌─────────────────────────────────────────────────────────────────┐
   │              DEPLOYMENT TRIGGER                                  │
   │  - PR merged to main with src/handler/** or infra/** changes     │
   │  - Manual `cdk deploy` for hotfix                                │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │              CI: BUILD + TEST + BUNDLE                           │
   │                                                                  │
   │  npm run lint                                                    │
   │  npm run typecheck                                               │
   │  npm run test:unit                                               │
   │  npm run test:pbt                                                │
   │  npm run test:integration   (needs Docker; LocalStack)           │
   │  npm run test:smoke         (needs Docker + SAM CLI)             │
   │  npm run test:coverage      (threshold gate)                     │
   │  cdk synth                                                       │
   │  cdk-nag rule checks       (passes or documented suppressions)   │
   │  scripts/verify-bundle.sh  (size ≤ 5MB + handler export)         │
   │                                                                  │
   │  Any failure → block deployment                                  │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │              CHANGE SET REVIEW (cdk diff)                        │
   │                                                                  │
   │  Operator examines:                                              │
   │    - Lambda code changes (esbuild bundle hash diff)              │
   │    - IAM policy changes (cdk-nag re-verification)                │
   │    - Env var changes (especially `STATE_MACHINE_ARN` if upstream │
   │      stack changed; rare)                                        │
   │    - Memory/timeout/concurrency changes (deliberate config)      │
   │                                                                  │
   │  Manual approval gate before prod deploy                         │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │              CDK DEPLOY (per env)                                │
   │                                                                  │
   │  dev → staging → prod (sequential)                               │
   │                                                                  │
   │  CDK behaviour:                                                  │
   │  1. Creates new Lambda version (`$LATEST` increments)            │
   │  2. Atomically updates `live` alias to point to new version      │
   │  3. Step Function task definition (which references the alias)   │
   │     starts invoking new code on the next task                    │
   │                                                                  │
   │  On failure: CloudFormation rollback restores the prior alias    │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │              POST-DEPLOY VALIDATION                              │
   │                                                                  │
   │  - Smoke test against the deployed Lambda (synthetic event       │
   │    via aws lambda invoke with a known-good payload)              │
   │  - CloudWatch alarms verified active (no false-fires)            │
   │  - Sample CloudWatch logs to verify Powertools env vars applied  │
   │                                                                  │
   │  Failure here → manual rollback procedure                        │
   └─────────────────────────────────────────────────────────────────┘
```

---

## 3. Rollback Procedure

U-3's Lambda is stateless and idempotent (BR-3-RT-4). Rollback is fast and safe.

### 3.1 Code Rollback (most common scenario)

**Trigger**: alarm fires post-deploy; new code is misbehaving.

```bash
# 1. Identify the previous good Lambda version
aws lambda list-versions-by-function --function-name classification-service-prod

# 2. Update the `live` alias to point to the previous version
aws lambda update-alias \
  --function-name classification-service-prod \
  --name live \
  --function-version 42   # previous good version number

# 3. Verify alarms clear
# 4. Open a hotfix PR reverting the bad change
# 5. cdk deploy applies the revert; alias swings to the new good version
```

**RTO**: 5 minutes (alias swap is instant; verification is the bottleneck).

### 3.2 IAM / Config Rollback

**Trigger**: deploy added a broken IAM permission or env var.

```bash
# Revert the offending commit; cdk deploy.
git revert <commit-sha>
cdk deploy ClassificationLambdaStack
```

CloudFormation handles the reverse-direction change.

**RTO**: 10 minutes (full CDK deploy cycle).

### 3.3 Lambda + Upstream Coupling

If U-3's Lambda fails to deploy because of an upstream change (e.g., `STATE_MACHINE_ARN` export from upstream stack is missing), the CFN deploy fails fast. The fix is upstream — coordinate with the State Machine stack owner.

---

## 4. Cost Estimate (per environment, illustrative)

| Resource | dev | staging | prod (low) | prod (high) |
|---|---|---|---|---|
| Lambda invocations (1M req/mo) | <$1 | <$1 | ~$20 | ~$200 |
| Lambda duration (512 MB × 2s avg × 1M req) | <$1 | <$1 | ~$15 | ~$150 |
| X-Ray traces (5% sample × 1M req) | <$0.50 | <$1 | ~$10 | ~$100 |
| CloudWatch Logs (1KB/req × 1M req × retention) | <$1 | <$2 | ~$20 | ~$200 |
| CloudWatch alarms (6 alarms × $0.10) | $0.60 | $0.60 | $0.60 | $0.60 |
| Custom EMF metrics | <$1 | <$1 | ~$5 | ~$50 |
| Lambda Insights | $0 | ~$10 | ~$30 | ~$300 |
| **Total** | <$5 | ~$15 | ~$100 | ~$1000 |

Sub-totals are rough; numbers scale with actual document volume. U-4 will refine these in its cost model.

---

## 5. Single-Region Deployment

U-3 inherits the single-region decision from U-2 IaD Q6=A. Region selection deferred to U-4 (typically the region nearest the S3 document bucket).

**Cross-region considerations**: if the bucket lives in another region than the Lambda (rare but possible for legacy reasons), S3 ranged GETs traverse inter-region network — adds ~100-500ms latency per call. The orchestrator's per-step latency budgets accommodate this but ideally Lambda is in the same region as the bucket.

---

## 6. Handoff to U-4

U-4's Infrastructure Design + Code Generation must materialise:

1. **`infra/lib/lambda-stack.ts`** — the `ClassificationLambdaStack` CDK class with:
   - `NodejsFunction` per §2.1–§2.3
   - Inline IAM policy + 2 managed policies per §2.4
   - X-Ray sampling rule per §2.6
   - 6 CloudWatch alarms per §3
   - `Fn.importValue` for State Machine ARN + DDB table ARNs + S3 bucket ARN

2. **`infra/config/{dev,staging,prod}.ts`** — per-env config values per §1

3. **`cdk-nag` suppressions** for `AwsSolutions-IAM4` (managed policies) and `AwsSolutions-L2` (no DLQ — using SFN retry instead)

4. **`.github/workflows/ci.yml`** with:
   - `aws-actions/setup-sam@v2.0.0` for the smoke-test job
   - Docker-availability check for testcontainers + SAM
   - `scripts/verify-bundle.sh` step after `cdk synth`

5. **CloudFormation cross-stack export contract** — U-4 must ensure the upstream State Machine stack exports `DocumentIngestionStateMachineArn` and the upstream S3 bucket stack exports `DocumentBucketArn`; if those stacks aren't yet defined, U-4 documents the contract and stubs the values for testing

---

## 7. Summary

U-3's deployment architecture is **one Lambda + 6 alarms + 1 IAM role + 1 X-Ray rule** — modest but covers the operational core of the service. The single-alias strategy keeps deploys atomic; the SFN task-retry layer is our DLQ-equivalent; the per-env matrix isolates dev verbosity from prod cost. The whole rollback story compresses to "swap alias to previous version" — 5 minutes RTO in the common case.

CDK code lives in U-4 by ownership convention. U-3 here defines the contract U-4 implements.
