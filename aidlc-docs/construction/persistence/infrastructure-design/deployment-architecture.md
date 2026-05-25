# Deployment Architecture — U-2 `persistence`

> U-2's infrastructure (two DynamoDB tables) is deployed via U-4's CDK stack `ClassificationDataStack`. This document captures per-environment configuration, the deployment flow, backup/recovery procedures, and migration considerations.

---

## 1. Per-Environment Configuration Matrix

U-2's table specifications are constant across environments; only safety toggles vary.

| Property | dev | staging | prod |
|---|---|---|---|
| Billing mode | PAY_PER_REQUEST | PAY_PER_REQUEST | PAY_PER_REQUEST |
| SSE | AWS_MANAGED | AWS_MANAGED | AWS_MANAGED |
| `content-hashes` PITR | Disabled | Enabled | Enabled |
| `workspace-config` PITR | Disabled | Disabled | Disabled |
| `content-hashes` Deletion Protection | Disabled | Enabled | Enabled |
| `workspace-config` Deletion Protection | Disabled | Enabled | Enabled |
| Table name prefix | `dev-` | `staging-` | (none) |
| CloudWatch alarm thresholds | Standard | Standard | Standard |
| Alarm action (SNS topic) | dev-only Slack channel | staging Slack channel | PagerDuty + prod Slack |
| Contributor Insights | Enabled | Enabled | Enabled |

**Rationale for per-environment differences**:
- `dev` keeps deletion protection off because `cdk destroy` must succeed for developer workflows
- `dev` PITR off to save cost on transient dev tables
- Staging matches prod for everything safety-related so deployment validation in staging exercises the prod posture

---

## 2. Deployment Flow

```
   ┌─────────────────────────────────────────────────────────────────┐
   │                       DEPLOYMENT TRIGGER                         │
   │   - PR merge to main with infra/** changes                       │
   │   - Manual `cdk deploy` for hotfix                               │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │              U-4 CDK SYNTHESIS + cdk-nag                         │
   │                                                                  │
   │   cdk synth → CloudFormation templates                           │
   │   cdk-nag rule checks:                                           │
   │     - AwsSolutions-DDB3 (PITR on content-hashes)                 │
   │     - AwsSolutions-IAM5 (no wildcard resources)                  │
   │     - AwsSolutions-IAM4 (no AWS-managed policies)                │
   │   FAIL → block deployment                                        │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │              CHANGE SET REVIEW (cdk diff)                        │
   │                                                                  │
   │   Operator examines:                                             │
   │     - Schema changes (PK/SK changes = full migration; AVOID)     │
   │     - Capacity mode changes (PAY_PER_REQUEST ↔ PROVISIONED)      │
   │     - Deletion protection toggle changes                         │
   │     - TTL attribute changes                                      │
   │                                                                  │
   │   Risky changes require explicit approval                        │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                  CDK DEPLOY (per environment)                    │
   │                                                                  │
   │   dev → staging → prod (sequential; manual gate before prod)     │
   │                                                                  │
   │   On failure: CloudFormation rolls back automatically            │
   │   Tables in transit may briefly show UPDATING state              │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │              POST-DEPLOY VALIDATION                              │
   │                                                                  │
   │   - Integration test suite against the new prod environment      │
   │     (read-only smoke tests; no destructive ops)                  │
   │   - CloudWatch alarms verified active                            │
   │   - Workspace count sanity check (no rows lost)                  │
   └─────────────────────────────────────────────────────────────────┘
```

---

## 3. Single-Region Deployment (Q6=A)

U-2 deploys to one AWS region. The region selection is deferred to U-4 (typically the region nearest the customer's other AWS resources, e.g., S3 buckets containing the source documents).

**Cross-region considerations**:
- If a region-wide DDB outage occurs (extraordinarily rare), the service is unavailable in that window. RPO is bounded by PITR (35 days) for any post-incident recovery.
- A future Global Tables migration (Q6 option B) is feasible without data loss but requires careful handling of `policyVersion` race-safety semantics (cross-region replication is eventually consistent and breaks ConditionExpression atomicity across regions).

---

## 4. Backup and Recovery Procedures

### 4.1 `content-hashes` Recovery (PITR enabled)

**Scenario**: accidental data corruption, ransomware on the AWS account, or an application bug that mutated rows incorrectly.

**Procedure**:
1. Identify the corruption window from CloudWatch Logs (which records were affected, when did the bug start)
2. AWS Console → DynamoDB → `content-hashes` → Backups → "Restore to point in time"
3. Select target timestamp (just before corruption)
4. AWS creates a new table `content-hashes-restored-<timestamp>` with the data at that point
5. Operator:
   - Renames current table to `content-hashes-corrupted-<timestamp>`
   - Renames restored table to `content-hashes`
   - Updates Lambda environment variable `CONTENT_HASH_TABLE_NAME` (or, preferred, blue-green via a CDK deploy that points the alias)
6. Validate via the integration test suite against the new table
7. Once confirmed, schedule deletion of the `-corrupted-` table after a 90-day audit hold

**RPO**: ~5 minutes (DDB PITR continuous backup granularity)
**RTO**: 30 minutes (CDK deploy + integration validation)

### 4.2 `workspace-config` Recovery (PITR disabled)

Since PITR is off (Q2=A), recovery relies on the externally-managed source of truth.

**Procedure**:
1. Operator's workspace-config management tool (out of scope here) has the authoritative source
2. CDK deploy creates a fresh `workspace-config` table
3. Operator's bulk-load tool re-populates rows

**RPO**: bounded by the operator's source-of-truth freshness (typically 0; a Git repo or operator dashboard holds the canonical record)
**RTO**: 15 minutes (CDK deploy + bulk-load)

### 4.3 Optional AWS Backup vault

For additional retention beyond PITR's 35-day window (e.g., legal hold requirements), U-4 may attach the `content-hashes` table to an AWS Backup vault with a longer retention plan. This is **not currently required by the spec** but is documented as a known extension path.

---

## 5. Migration Considerations

### 5.1 Safe Migrations (no downtime)

DynamoDB is schemaless beyond the PK/SK. The following changes are safe:

| Change | How |
|---|---|
| Add a new attribute | `cdk deploy` is a no-op; new rows can carry the attribute; old rows remain unaffected |
| Add a new sub-key in `slipsheetRules` (workspace-config) | Operator updates workspace-config rows; adapter handles missing key gracefully |
| Adjust TTL behaviour (`hashTtlDays`) | Updating a workspace's `hashTtlDays` triggers TTL recomputation on the next write to that workspace's records; existing rows keep their original `expiresAt` |
| Change CloudWatch alarm thresholds | `cdk deploy` updates the alarms; no data impact |

### 5.2 Risky Migrations (require planning)

| Change | Why risky | Procedure |
|---|---|---|
| Change PK or SK | DDB doesn't support PK/SK changes; requires new table + data migration | Create new table; dual-write window via U-2 adapter code change; backfill via DDB Streams or AWS Data Pipeline; cut over reads; decommission old table |
| Change capacity mode (e.g., on-demand → provisioned) | One-way conversion per 24 hours; mistakes are slow to undo | Test in staging first; do during low-traffic window |
| Enable Streams retroactively | Free, but enables a new consumer surface; coordinate with U-4 | `cdk deploy` + enable any consumers |
| Disable PITR | Loses recovery posture; document operator approval | Update CDK stack with explicit decision rationale |

### 5.3 NEVER Migrations

These are explicitly NOT supported by U-2's design:

- **Deleting either table** — protected by deletion protection in prod; CDK `RemovalPolicy.RETAIN` provides a second layer
- **Cross-workspace data movement** — NFR-4 forbids; would require a separate auditable operation outside U-2's contract
- **Removing the `expiresAt` attribute** from existing rows in bulk — would orphan records that depended on TTL for cleanup

---

## 6. Cost Estimate (rough, per environment)

| Resource | dev | staging | prod (low traffic) | prod (high traffic) |
|---|---|---|---|---|
| `content-hashes` storage (1M records × 200 B avg) | ~$0.05/mo | ~$0.05/mo | ~$50/mo | ~$500/mo |
| `content-hashes` PITR overhead (~20%) | N/A | ~$0.01/mo | ~$10/mo | ~$100/mo |
| `content-hashes` requests | minimal | minimal | ~$30/mo | ~$300/mo |
| `workspace-config` storage + requests | minimal | minimal | <$1/mo | <$1/mo |
| CloudWatch alarms (4 alarms × ~$0.10/mo) | $0.40 | $0.40 | $0.40 | $0.40 |
| **Total per environment** | <$1 | <$1 | ~$100 | ~$900 |

(Numbers are illustrative; real costs depend on workspace count, document volume, and request rate. PITR scales with table size.)

---

## 7. Handoff to U-4

U-4's Infrastructure Design + Code Generation must materialise:

1. `infra/lib/data-stack.ts` — the `ClassificationDataStack` CDK class with both tables per §2 and §3
2. `infra/lib/alarms-stack.ts` (or merged into observability-stack.ts) — the 4 alarms in §6
3. `infra/lib/iam-policy.ts` — the IAM policy excerpt from §4
4. Per-environment CDK config (`infra/config/{dev,staging,prod}.ts`) for the toggles in §1
5. `cdk-nag` suppressions for the documented justifications (§8 of `infrastructure-design.md`)

U-2's source code is unchanged by this stage — only the adapter code consumes the table names via environment variables (set by U-3's Lambda config in U-4).

---

## 8. Summary

U-2's infrastructure footprint is **two DynamoDB tables + four CloudWatch alarms + one IAM policy** — modest but materially safety-critical (the dedup index holds operational state that's expensive to lose). The design favors PITR + deletion protection in prod, lean cost in dev, and a documented Q4=B deviation from SECURITY-07 with explicit rationale.

The CDK code lives in U-4 by ownership convention (CDK is U-4's domain); this document is the contract U-4 implements against.
