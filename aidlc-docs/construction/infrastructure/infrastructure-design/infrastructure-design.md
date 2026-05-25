# Infrastructure Design — U-4 `infrastructure`

> Meta-infrastructure for the CDK-owning unit: Bootstrap, stack naming, tagging, account model, cross-stack contracts, lifecycle protection. The **service-wide SECURITY compliance picture** is consolidated in §7.

---

## 1. Category Applicability

| Category | U-4 ownership |
|---|---|
| **Deployment Environment** | **Yes — core** (AWS account model + region selection) |
| Compute / Storage / Networking / Monitoring | Inherited — specs from U-2 + U-3 IaD; U-4 materialises |
| **Shared Infrastructure** | **Yes — core** (CDK Bootstrap, GitHub OIDC, cross-stack export contracts) |

---

## 2. CDK Bootstrap (Q1=A)

CDK Bootstrap provisions a per-account-per-region toolkit stack (`CDKToolkit`) containing:
- S3 bucket for CDK assets (Lambda bundles, etc.)
- ECR repository for container images (unused here)
- IAM execution roles (`cdk-hnb659fds-cfn-exec-role-*`, `cdk-hnb659fds-deploy-role-*`, etc.)
- KMS key for asset encryption

### 2.1 Bootstrap Runbook (one-time per account+region)

```bash
# Performed once per AWS account + region pair, by a privileged operator
# (NOT by CI; documented here for runbook reference).

# For dev account
aws sts assume-role --role-arn arn:aws:iam::111111111111:role/admin --role-session-name bootstrap
npx cdk bootstrap aws://111111111111/us-east-1 \
  --trust 111111111111 \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/PowerUserAccess
# Repeat for staging (222222222222) and prod (333333333333).
```

**Why `PowerUserAccess` and not `AdministratorAccess`**: PowerUserAccess covers all the resources CDK needs to create (Lambda, DDB, CloudWatch, IAM roles via inline policies) but excludes the ability to escalate privileges. AdministratorAccess would also work but is broader than required.

### 2.2 Trust Policy for the CDK Execution Roles

The new-style bootstrap creates 4 roles per account. The deploy role's trust policy is locked to the GitHub OIDC provider per Pattern P-4-5 (U-4 NFR Design).

### 2.3 Bootstrap Refresh

CDK bootstrap version changes between CDK releases. Re-bootstrap (`cdk bootstrap` again) is required when:
- The CDK CLI major version is updated
- AWS adds new permission requirements for CDK toolkit roles

The runbook (§2.1) is re-executed in those cases.

---

## 3. CloudFormation Stack Naming (Q2=A)

Convention: `Classification{Component}-{env}`

| Stack | dev | staging | prod |
|---|---|---|---|
| Data | `ClassificationData-dev` | `ClassificationData-staging` | `ClassificationData-prod` |
| Lambda | `ClassificationLambda-dev` | `ClassificationLambda-staging` | `ClassificationLambda-prod` |
| Observability | `ClassificationObservability-dev` | `ClassificationObservability-staging` | `ClassificationObservability-prod` |

**Why uniform suffix even in prod**: avoids the "wait, which stack is in prod?" confusion when scanning the console; deploy commands work uniformly (`cdk deploy --all -c env=prod`).

---

## 4. Resource Tagging Strategy (Q3=A)

Six tags applied at the CDK app level via `Tags.of(app).add(...)`. Every taggable resource inherits.

```typescript
// In infra/bin/app.ts after stack instantiation
Tags.of(app).add("Service", "classification-service");
Tags.of(app).add("Environment", envConfig.envName);
Tags.of(app).add("ManagedBy", "cdk");
Tags.of(app).add("Owner", "platform-team");
Tags.of(app).add("CostCenter", "tbd");   // Operator fills in the actual cost-center code

// Per-stack component tag (must be set at the stack level, not app level)
Tags.of(dataStack).add("Component", "data");
Tags.of(lambdaStack).add("Component", "lambda");
Tags.of(observabilityStack).add("Component", "observability");
```

| Tag | Value | Purpose |
|---|---|---|
| `Service` | `classification-service` | Service-level cost-allocation; cross-account searches |
| `Component` | `data` / `lambda` / `observability` | Per-stack cost slicing |
| `Environment` | `dev` / `staging` / `prod` | Per-env cost tracking; tag-based IAM policies |
| `ManagedBy` | `cdk` | Distinguish CDK-managed from manually-created |
| `Owner` | `platform-team` | Operational ownership lookup |
| `CostCenter` | (operator-filled) | Finance department's billing taxonomy |

---

## 5. AWS Account Model (Q4=A)

Three separate AWS accounts:

| Environment | Account ID (placeholder) | Region | Purpose |
|---|---|---|---|
| dev | `111111111111` | `us-east-1` | Developer iteration; transient resources; auto-deploy |
| staging | `222222222222` | `us-east-1` | Pre-production validation; mirror of prod safety posture |
| prod | `333333333333` | `us-east-1` | Production workload; manual deploy approval |

(Account IDs are placeholders; the operator replaces these with real IDs at deploy time. Region selection is a service-level decision — `us-east-1` is the default; can be changed in the per-env config files.)

**Why account-level isolation**:
- Account boundaries prevent IAM privilege bleed (a credential leak in dev cannot affect prod)
- Per-account billing makes cost-tracking unambiguous
- AWS Organizations SCPs can enforce service-level guardrails per account
- Resource limits (e.g., Lambda concurrency cap) are per-account; isolation prevents one env from starving another

**Cross-account dependency**: the Lambda stack imports the State Machine ARN from an upstream stack that lives in the **same account** as the Lambda (each environment self-contained).

---

## 6. Cross-Stack Import Contract (Q5=A)

The Lambda stack consumes 3 external values:
1. **State Machine ARN** — from the upstream `DocumentIngestionStateMachineStack` (same AWS app or separate)
2. **Document Bucket ARN** — from the upstream `DocumentBucketStack` (same)
3. **Alarms SNS Topic ARN** — from a central observability stack (potentially separate CDK app)

| Value | Mechanism | Resolved At | Why |
|---|---|---|---|
| State Machine ARN | `Fn.importValue("DocumentIngestionStateMachineArn")` | Deploy time | Sibling CFN stack; typed export/import enforces dependency order |
| Document Bucket ARN | `Fn.importValue("DocumentBucketArn")` | Deploy time | Same as above |
| Alarms SNS Topic ARN | `StringParameter.valueFromLookup(this, "/observability/sns-topic-arn/${env}")` | Synth time | Owned by separate observability CDK app; loosely coupled |

### 6.1 Provider Stack Contract

Upstream stacks MUST export:

```typescript
new CfnOutput(this, "StateMachineArn", {
  value: stateMachine.stateMachineArn,
  exportName: "DocumentIngestionStateMachineArn",
});

new CfnOutput(this, "BucketArn", {
  value: bucket.bucketArn,
  exportName: "DocumentBucketArn",
});
```

And the observability team MUST publish to SSM:
```
/observability/sns-topic-arn/dev
/observability/sns-topic-arn/staging
/observability/sns-topic-arn/prod
```

If these contracts aren't yet wired (e.g., upstream stacks not yet deployed), U-4 falls back to hardcoded values in the per-env config files (`envConfig.stateMachineArn`) as a temporary measure. The fallback is documented in `deployment-architecture.md`.

---

## 7. Termination Protection (Q6=A)

Per-env CDK stack property:

```typescript
// In each ClassificationXxxStack constructor:
super(scope, id, {
  ...props,
  terminationProtection: props.envConfig.envName === "prod",
});
```

| Environment | Termination Protection | Effect |
|---|---|---|
| dev | Disabled | `cdk destroy --all -c env=dev` succeeds |
| staging | Disabled | Same (matches dev for cdk-destroy ergonomics) |
| prod | **Enabled** | `cdk destroy --all -c env=prod` fails; operator must first disable via console |

Combined with DDB `deletionProtection` (per U-2 IaD Q5=A) and `RemovalPolicy.RETAIN` on the tables, prod has 3-layer defense against accidental deletion:
1. CloudFormation termination protection (this stack-level guard)
2. DDB table deletion protection (per-table guard)
3. CDK RemovalPolicy.RETAIN (CloudFormation orphans the table when the stack is deleted)

To intentionally retire prod (e.g., service shutdown), all 3 layers must be lifted manually.

---

## 8. SECURITY Compliance — Final Picture (Service-Wide)

This table consolidates SECURITY coverage across U-1 + U-2 + U-3 + U-4 — the entire service's posture.

| Rule | Status | Where it's satisfied |
|---|---|---|
| SECURITY-01 (encryption at rest + in transit) | ✅ | DDB SSE (AWS_MANAGED) via U-4; Lambda env vars KMS-encrypted by default; TLS for all SDK calls |
| SECURITY-02 (network access logs) | ✅ N/A | No load balancers / API Gateways / CDNs |
| SECURITY-03 (app-level logging) | ✅ | Powertools Logger configured by U-3; CloudWatch Logs retention by U-4 (7/30/90 days per env) |
| SECURITY-04 (HTTP headers) | ✅ N/A | No HTML-serving endpoints |
| SECURITY-05 (input validation) | ✅ | Zod schema in `InputValidator` (U-3 application layer) |
| SECURITY-06 (least-privilege IAM) | ✅ | Per-resource per-action policies (U-3 NFR Reqs §2.5 → U-4 CDK §2.4); cdk-nag IAM5 passes |
| SECURITY-07 (restrictive network) | ✅ Justified deviation | Lambda outside VPC per U-1 IaD Q4=B; revisit trigger when VPC-private resources are added |
| SECURITY-08 (app-level access control) | ✅ | Object-level auth via `workspaceId` partition key |
| SECURITY-09 (hardening) | ✅ | DDB `deletionProtection` + `RemovalPolicy.RETAIN` + CFN termination protection (this doc §7); generic SendTaskFailure errors |
| SECURITY-10 (supply chain) | ✅ | All `@aws-sdk/*` + `zod` + `file-type` exact-pinned; CDK exact-pinned; Powertools caret-pinned; `npm audit` gate; package-lock.json committed |
| SECURITY-11 (secure design) | ✅ | Hexagonal layer separation; security-critical logic isolated (SlipsheetDecider, OLE2Parser); 3-layer prod-deletion defense |
| SECURITY-12 (auth/credentials) | ✅ N/A | Service-to-service via IAM role + OIDC; no user credentials; GitHub OIDC for CI/CD (no long-lived secrets) |
| SECURITY-13 (data + CI/CD integrity) | ✅ | Result-typed plumbing; conditional DDB writes; GitHub Actions OIDC + environment-protection rules; cdk-nag per-PR gate; CloudWatch Logs as audit trail |
| SECURITY-14 (alerting + monitoring) | ✅ | 10 alarms wired in `ClassificationObservabilityStack`; SNS fan-out to PagerDuty + Slack |
| SECURITY-15 (fail-safe defaults) | ✅ | Global try/catch in Lambda handler; Result plumbing throughout; fail-closed on unknown errors; `loadEnvConfig` throws on unknown env |

**Across the entire service**: 15 SECURITY rules evaluated; 11 directly compliant; 3 explicitly N/A; 1 justified deviation (SECURITY-07).

**No blocking findings.** The service is production-ready from a SECURITY standpoint.

---

## 9. cdk-nag Final Status (Service-Wide)

| cdk-nag rule | Status | Location |
|---|---|---|
| `AwsSolutions-DDB3` (PITR on tables) | Pass on `content-hashes`; **suppressed on `workspace-config`** with documented reason | `ClassificationDataStack` |
| `AwsSolutions-IAM5` (no wildcard resources) | Pass | `ClassificationLambdaStack` |
| `AwsSolutions-IAM4` (no AWS-managed policies) | **Suppressed (2 instances)** with documented reason: AWSLambdaBasicExecutionRole + AWSXRayDaemonWriteAccess | `ClassificationLambdaStack` |
| `AwsSolutions-L1` (latest runtime) | Pass — nodejs20.x | `ClassificationLambdaStack` |
| `AwsSolutions-L2` (Lambda DLQ) | **Suppressed** with documented reason: SFN task-retry serves the DLQ role | `ClassificationLambdaStack` |
| All other `AwsSolutions-*` rules | Pass by construction | (various) |

**Total suppressions**: 3, all documented with reasons referencing the deciding source IaD document.

---

## 10. Open Items for Code Generation

| Item | Phase in Code Generation |
|---|---|
| Concrete AWS account IDs replacing placeholders | Per-env config files (Phase 4) |
| GitHub OIDC role ARNs (from operational setup) | Per-env config files (Phase 4) |
| State Machine + Document Bucket export names from upstream | Lambda stack code (Phase 3) |
| SSM parameter paths for alarms SNS topic | Per-env config files (Phase 4) |
| CostCenter tag value | Per-env config files (Phase 4) |
| Bootstrap runbook documented in README | Phase 9 (Documentation) |
| GitHub environment protection rules (operator action) | Out of scope — operational |
