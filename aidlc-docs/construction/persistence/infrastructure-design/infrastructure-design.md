# Infrastructure Design — U-2 `persistence`

> U-2 owns two DynamoDB tables. This document captures the table specifications, IAM scope, VPC topology, and per-table alarms. The actual CDK code lives in U-4's `ClassificationDataStack` (in `infra/lib/data-stack.ts`); this document is the **source of truth U-4 implements against**.

---

## 1. Category Applicability

| Category | U-2 ownership | Owned by |
|---|---|---|
| Deployment Environment | Inherited | Service-level (AWS, single-region) |
| Compute | N/A | U-3 (Lambda) + U-4 (CDK function) |
| **Storage** | **Yes — core** | Two DDB tables defined by U-2's specifications |
| Messaging | N/A | U-3 (Step Functions) |
| Networking | Partial | Q4=B Lambda-outside-VPC; no VPC endpoint |
| Monitoring | Partial | Per-table DDB alarms (U-2); per-function alarms (U-3); other infra alarms (U-4) |
| Shared | Inherited | CI runner from U-1 |

---

## 2. DynamoDB Table: `content-hashes`

### 2.1 Primary Key Schema

| Attribute | Type | Role |
|---|---|---|
| `workspaceId` | S | Partition Key |
| `contentHash` | S | Sort Key (SHA-256 hex, lowercase) |

### 2.2 Configuration (per Q1–Q6)

| Setting | Value | Rationale |
|---|---|---|
| Billing mode | **PAY_PER_REQUEST** (on-demand) | NFR Reqs Q2=A — variable workload, no scale-up latency |
| Server-side encryption | **AWS_MANAGED** | Q1=A — SECURITY-01; no per-request KMS cost |
| Point-in-time recovery | **Enabled** | Q2=A — critical dedup index recoverability |
| TTL attribute | `expiresAt` (numeric, unix seconds) | NFR-10 — per-workspace TTL via `hashTtlDays` |
| Deletion protection | **Enabled in prod, disabled in dev** | Q5=A — env-specific via CDK config |
| Streams | **Disabled** | Q3=C — adapter CloudWatch logs satisfy SECURITY-13 |
| Global Tables / replication | **None** (single region) | Q6=A |
| Contributor Insights | Enabled | Surfaces hot partitions in CloudWatch (zero-cost diagnostic) |

### 2.3 Attribute Inventory

All attributes are managed by U-2's adapter; CDK only declares the schema. Per `business-logic-model.md`:

| Attribute | Type | Cardinality | Set By |
|---|---|---|---|
| `workspaceId` | S | required (PK) | orchestrator |
| `contentHash` | S | required (SK) | orchestrator (SHA-256 hex) |
| `firstSeenAt` | S | required, immutable after first write | adapter (`buildContentHashRecord`) |
| `firstDocumentId` | S | required, immutable | adapter |
| `format` | S | required, immutable | adapter |
| `policyVersion` | S | required, mutable on `replaceOnPolicyMismatch` | adapter |
| `lastSeenAt` | S | required, mutable on `updateOnDuplicateHit` and `replaceOnPolicyMismatch` | adapter |
| `hitCount` | N | required, mutable on `updateOnDuplicateHit` | adapter |
| `expiresAt` | N (TTL) | optional — present iff `hashTtlDays !== null` | adapter |

---

## 3. DynamoDB Table: `workspace-config`

### 3.1 Primary Key Schema

| Attribute | Type | Role |
|---|---|---|
| `workspaceId` | S | Partition Key |

### 3.2 Configuration

| Setting | Value | Rationale |
|---|---|---|
| Billing mode | **PAY_PER_REQUEST** | NFR Reqs Q2=A |
| Server-side encryption | **AWS_MANAGED** | Q1=A |
| Point-in-time recovery | **Disabled** | Q2=A — small table, externally source-managed |
| TTL | **Disabled** | Workspace config doesn't expire |
| Deletion protection | **Enabled in prod, disabled in dev** | Q5=A |
| Streams | **Disabled** | Q3=C |
| Contributor Insights | Enabled | Catches misconfigured workspace IDs |

### 3.3 Attribute Inventory

| Attribute | Type | Cardinality | Note |
|---|---|---|---|
| `workspaceId` | S | required (PK) | |
| `policyVersion` | S | required | Bumped by operator on policy change (FR-7.1) |
| `threshold` | N | required | ∈ [0, 1] |
| `maxZipDepth` | N | required | ≥ 0 |
| `quarantineMacros` | BOOL | required | FR-6.1 |
| `slipsheetRules` | M | required | Map of format → "always-slipsheet" |
| `hashTtlDays` | N \| null | optional | NFR-10 |

---

## 4. IAM Scope (Lambda execution role)

Per NFR Requirements Q6=A — restated here for U-4 to implement verbatim:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ContentHashesReadWrite",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:aws:dynamodb:${region}:${account}:table/${contentHashTableName}"
    },
    {
      "Sid": "WorkspaceConfigReadOnly",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem"],
      "Resource": "arn:aws:dynamodb:${region}:${account}:table/${workspaceConfigTableName}"
    }
  ]
}
```

**Actions explicitly NOT granted**: `dynamodb:Scan`, `dynamodb:Query`, `dynamodb:BatchGetItem`, `dynamodb:BatchWriteItem`, `dynamodb:DeleteItem`, `dynamodb:DescribeTable`, `dynamodb:UpdateTable`, `dynamodb:CreateTable`, `dynamodb:DeleteTable`. None are used by U-2's contract.

`cdk-nag` rule `AwsSolutions-IAM5` (no wildcard resource) and `AwsSolutions-IAM4` (no managed policies) both pass.

---

## 5. VPC Topology (Q4=B)

**Lambda outside VPC** — no VPC endpoint for DynamoDB.

Rationale: cold-start savings (~1-2s) outweigh the SECURITY-07 ideal of private endpoints for a service that only touches AWS-managed services over the AWS backbone. AWS SDK v3 routes DDB calls via HTTPS over the AWS backbone regardless of VPC attachment, so the security delta is minimal.

**Revisit if**: U-3 ever adds a VPC-private resource (RDS, ElastiCache, on-prem). At that point, Lambda must enter the VPC, and a Gateway VPC endpoint for DynamoDB becomes mandatory (free; eliminates NAT charges).

---

## 6. CloudWatch Alarms (per-table)

These alarms are owned by U-4's `ClassificationObservabilityStack`; U-2 specifies the alarm definitions here.

### 6.1 `content-hashes-throttled-requests`

| Property | Value |
|---|---|
| Metric | `AWS/DynamoDB.ThrottledRequests` (Dimensions: `TableName`) |
| Statistic | Sum |
| Period | 60 s |
| Evaluation periods | 5 |
| Threshold | > 0 |
| Action | Page on-call |
| Why | Even with on-demand billing, throttling can occur during the first ~15 minutes of an extreme burst until DDB scales up. Surfaces real performance issues. |

### 6.2 `content-hashes-system-errors`

| Property | Value |
|---|---|
| Metric | `AWS/DynamoDB.SystemErrors` |
| Statistic | Sum |
| Period | 60 s |
| Evaluation periods | 5 |
| Threshold | > 0 |
| Action | Page on-call |
| Why | AWS-side issues (DDB internal errors); rare but warrants investigation. |

### 6.3 `content-hashes-user-errors`

| Property | Value |
|---|---|
| Metric | `AWS/DynamoDB.UserErrors` |
| Statistic | Sum |
| Period | 60 s |
| Evaluation periods | 15 |
| Threshold | > 1% of request rate |
| Action | Warning (Slack/email; not pager) |
| Why | High UserErrors rate could indicate a code bug (e.g., malformed keys); 1% absorbs the natural rate of conditional-check-failed-by-race outcomes which are legitimately user-induced. |

### 6.4 `workspace-config-not-found`

| Property | Value |
|---|---|
| Metric | Custom metric `WorkspaceConfigStore.NotFound.Count` emitted by U-3's orchestrator via Powertools |
| Statistic | Sum |
| Period | 300 s |
| Evaluation periods | 1 |
| Threshold | > 0 |
| Action | Page on-call |
| Why | A workspace is invoking the service without a config row — alarm-worthy. |

### 6.5 Alarms not duplicated here

- Lambda-level alarms (errors, throttles, duration) — defined in U-3's NFR Design and materialised in U-4
- Step Function alarms (`SendTaskFailure` rate) — defined in U-3's NFR Design

---

## 7. SECURITY Compliance Notes at this Stage

| Rule | Status for U-2 Infrastructure | Note |
|---|---|---|
| SECURITY-01 (encryption at rest & in transit) | **Compliant** | AWS-managed SSE on both tables (Q1=A); TLS for SDK calls by default |
| SECURITY-02 (network access logs) | N/A | No load balancers/API gateways |
| SECURITY-06 (least-privilege IAM) | **Compliant** | §4 — per-table per-action; no wildcards; `cdk-nag` AwsSolutions-IAM5 passes |
| SECURITY-07 (restrictive network) | **Justified deviation** | Q4=B Lambda outside VPC documented; revisit when VPC-private resources added |
| SECURITY-09 (hardening) | **Compliant** | Tables have no resource-based policies allowing cross-account; PublicAccessBlock not applicable to DDB |
| SECURITY-10 (supply chain) | **Inherited** | AWS SDK packages exact-pinned (NFR Reqs §2) |
| SECURITY-13 (data integrity) | **Compliant** | All writes use ConditionExpression where appropriate; CloudWatch Logs serve as audit trail (Q3=C) |
| SECURITY-14 (alerting + monitoring) | **Compliant** | 4 alarms defined (§6); log retention ≥ 90 days inherited from U-4 settings |

**Blocking findings**: none. The Q4=B deviation from SECURITY-07's ideal is documented with explicit rationale (cold-start savings) and a clear revisit trigger.

---

## 8. cdk-nag Rule Status

To be enforced when U-4 implements the CDK stack:

| cdk-nag rule | Status | Action if violated |
|---|---|---|
| `AwsSolutions-DDB3` (PITR on tables) | Pass on `content-hashes`; suppress on `workspace-config` with documented reason (Q2=A) | Document suppression in CDK code |
| `AwsSolutions-IAM5` (no wildcards) | Pass | — |
| `AwsSolutions-IAM4` (no AWS managed policies) | Pass — custom inline policy | — |

---

## 9. Open Items for Subsequent Stages

| Item | Stage |
|---|---|
| Region selection (e.g., us-east-1 vs eu-west-1) | U-4 Infrastructure Design |
| Per-environment CDK config for deletion protection toggle | U-4 |
| Concrete `cdk-nag` suppression block for `AwsSolutions-DDB3` on workspace-config | U-4 |
| CloudWatch alarm SNS topic / PagerDuty integration | U-4 |
| Whether to enable AWS Backup vault (additional retention beyond PITR) | U-4 (optional) |
