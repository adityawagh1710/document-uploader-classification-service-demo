# Infrastructure Design Plan — U-2 `persistence`

> Per-unit Construction stage 4/5. **Unlike U-1, U-2 owns real AWS infrastructure** — two DynamoDB tables with TTL, SSE, IAM scope, and observability. This plan resolves the remaining infrastructure decisions; CDK code is generated in Code Generation.
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

---

## A. Category Applicability

| Category | Applies to U-2? | Notes |
|---|---|---|
| Deployment Environment | Inherited (AWS) | Service-level (Requirements Q7=A) |
| Compute Infrastructure | **N/A** | Compute is U-3's Lambda; U-2 ships compiled adapter code into that bundle |
| **Storage Infrastructure** | **Yes — core** | Two DynamoDB tables owned by U-2 |
| Messaging Infrastructure | **N/A** | No queues/events |
| Networking Infrastructure | **Partial** | VPC endpoint for DDB (Q4 below) |
| Monitoring Infrastructure | **Partial** | DDB-specific CloudWatch alarms; the rest inherited from U-4 |
| Shared Infrastructure | Inherited | CI runner from U-1 |

---

## B. Infrastructure Design Questions

### Question 1 — KMS key strategy for DDB SSE
DynamoDB SSE supports three encryption options. Choose for both tables:

A) **AWS-managed key (`AWS_MANAGED`)** — automatically managed by AWS; zero operational overhead; sufficient for most compliance regimes. SECURITY-01 satisfied.

B) **AWS-owned key (`AWS_OWNED`)** — DDB's default; encryption still enforced but no separate key in your account. Cheapest but limited audit visibility.

C) **Customer-managed CMK (`CUSTOMER_MANAGED`)** — full control + KMS audit logs; needed for HIPAA/PCI/some FedRAMP profiles; ~$1/month per key + per-request KMS charges.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: AWS-managed (`AWS_MANAGED`) is the standard production choice — encrypted at rest, key rotation handled by AWS, no per-request KMS cost (the AWS-managed key is bundled with DDB). It satisfies SECURITY-01 cleanly. Option B (`AWS_OWNED`, the DDB default) doesn't show up in your KMS console — fails some auditors' inspection checks. Option C (CMK) is the right answer for HIPAA / PCI but adds ~$1/month/key plus per-request charges — the spec doesn't mention regulated-data status. We can upgrade to CMK later by setting `tableEncryption: CUSTOMER_MANAGED` and providing a key ARN; existing data re-encrypts via TableEncryption update.

### Question 2 — Point-in-time recovery (PITR)
PITR enables continuous backups with 35-day retention, restorable to any second. Adds ~20% to base table cost.

A) **PITR enabled on `content-hashes` only** — this is the operationally critical dedup index; losing recent writes means re-ingesting (acceptable). `workspace-config` is small + manually managed (re-creating from source-of-truth config is fast).

B) **PITR enabled on both tables** — uniform safety; ~20% extra cost on `workspace-config` for marginal benefit.

C) **PITR enabled on `workspace-config` only** — operator-facing data takes priority; dedup is rebuildable from source documents.

D) **No PITR** — cheapest; relies on AWS's built-in 35-day retention via on-demand backups (manual).

E) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: `content-hashes` holds operationally critical state — losing it forces re-classification of millions of documents (expensive, slow, customer-visible). PITR's ~20% cost overhead is trivial compared to a "we lost the dedup index" incident. `workspace-config` (option B) is small (~hundreds of rows max) and the source of truth lives elsewhere (operator-managed); rebuilding from source is fast. Option C inverts the importance — the dedup index is the larger risk surface. Option D leaks all recovery responsibility to manual on-demand backups, which experience shows are unreliable.

### Question 3 — DynamoDB Streams for content-hashes audit
DDB Streams expose a 24-hour log of table changes (for downstream consumers, audit, replication). SECURITY-13 calls for "critical data modifications must be auditable (who changed what, when)".

A) **Streams enabled on `content-hashes` with `NEW_AND_OLD_IMAGES`** — every PutItem/UpdateItem produces a stream record with the before-and-after row state. CloudWatch Logs subscription (via Lambda or Kinesis Firehose, scoped to U-4) ingests the stream and writes to S3 for long-term audit. **+$0.02/100K stream-read requests.**

B) **Streams enabled with `KEYS_ONLY`** — only PK/SK exposed; loses content but cheaper. Sufficient if audit only needs "what row changed when".

C) **Streams disabled** — SECURITY-13's audit requirement met by CloudWatch Logs of the adapter (Pattern P-2-4); no separate stream needed.

D) Other (please describe after [Answer]: tag below)

[Answer]: C — Rationale: The adapter logs (Pattern P-2-4) ALREADY emit structured audit entries for every write: workspaceId, contentHash, operation, outcome, errorCode. CloudWatch Logs retention is configurable (≥90 days per SECURITY-14). DDB Streams (A or B) duplicate this signal at ~$3-30/month extra depending on volume, and require an extra Lambda or Firehose pipeline to actually consume the stream. SECURITY-13's "auditable changes" requirement is satisfied by CloudWatch Logs as the single audit trail. We can enable Streams later if a downstream consumer (e.g., a search index) needs them — for now, the simpler answer wins.

### Question 4 — VPC endpoint for DynamoDB
DDB supports a Gateway VPC endpoint (free; routes DDB traffic via the AWS backbone instead of the public internet).

A) **Gateway VPC endpoint** for DynamoDB in the Lambda's VPC — free; eliminates NAT Gateway charges for DDB traffic; SECURITY-07 ("use private endpoints where available") satisfied.

B) **Lambda outside VPC (no VPC endpoint needed)** — Lambda calls DDB over the public internet via the AWS SDK. Faster cold starts (~100ms vs 1-2s for VPC-attached Lambda). Acceptable if no other VPC-private resources needed.

C) **Lambda in VPC with NAT Gateway** for DDB — works but pays for NAT Gateway egress (~$0.045/GB) on DDB traffic; defeats the point.

D) Other (please describe after [Answer]: tag below)

[Answer]: B — Rationale: This is the cold-start question more than the security question. SECURITY-07 says "use private endpoints **where available**" — for a service that ONLY talks to DDB + S3 + Step Functions + CloudWatch (all AWS services with VPC-endpoint or public-IP-via-AWS-backbone support), keeping Lambda outside the VPC saves 1-2 seconds on cold starts (a real customer-visible latency hit) and the AWS SDK already routes through AWS's backbone via TLS. Lambda-outside-VPC is the canonical AWS recommendation when no on-prem or VPC-private resources are touched. If U-4 later decides to add VPC-private resources, we revisit: at that point Gateway VPC endpoint for DDB (option A) becomes the right answer.

### Question 5 — Deletion protection
DDB's `deletionProtectionEnabled` prevents accidental table deletion via API.

A) **Enabled on both tables in production**; disabled in dev/test (via per-environment CDK config). Removing protection requires a deliberate UpdateTable call.

B) Disabled everywhere — relies on CDK stack policies (`RETAIN` deletion policy) for protection.

C) Enabled everywhere including dev — risk: dev environment becomes harder to tear down for the CDK developer.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Per-environment is the right answer. Production deletion protection prevents catastrophic "oops, dropped the table" incidents (which happen even to mature teams). Dev/test environments need to be freely destroyable (`cdk destroy` should work without manual intervention). The per-environment toggle lives in the CDK config (env-specific construct prop). Option B's CDK `RemovalPolicy.RETAIN` is good but only protects against CloudFormation removal — it doesn't stop someone with DynamoDB IAM perms from `DeleteTable` directly via the console. Belt-and-braces wins.

### Question 6 — Multi-region replication strategy
DDB Global Tables let you replicate across regions for cross-region read availability + disaster recovery.

A) **Single-region (no Global Tables)** — simplest; matches single-region Lambda; relies on AWS regional SLA + PITR for recovery.

B) **Global Tables with 2 active-active regions** (e.g., us-east-1 + us-west-2) — sub-second cross-region replication; better RPO; ~5× cost (double writes + 2× storage + replication bandwidth).

C) **Global Tables with passive replica in another region** (read-only) — disaster recovery posture; lower cost than B.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The spec doesn't call out multi-region availability requirements; the service is a back-office document classifier (not a real-time consumer-facing API where sub-region failover matters). Single-region with PITR (Q2=A) gives a 35-day RPO for unintentional data loss; an AWS regional failure of an entire region is extraordinarily rare (~once per 3 years) and would be handled at the service-level DR plan rather than per-table replication. Option B doubles cost and complicates conditional writes (Global Tables use eventually-consistent cross-region replication that breaks our `policyVersion` race-safety in cross-region scenarios). Revisit if SLA requirements change.

---

## C. Generation Checklist (executes after plan approval)

### Phase 1 — Infrastructure Design Document
- [x] B1. Create `aidlc-docs/construction/persistence/infrastructure-design/infrastructure-design.md`:
  - Category applicability table (per §A above)
  - **DynamoDB table specifications** for `content-hashes`:
    - Partition key: `workspaceId` (S); Sort key: `contentHash` (S)
    - Billing: PAY_PER_REQUEST (on-demand)
    - SSE: AWS-managed (Q1=A)
    - PITR: enabled (Q2=A)
    - TTL attribute: `expiresAt` (numeric, unix seconds)
    - Deletion protection: env-specific (Q5=A)
    - DDB Streams: disabled (Q3=C)
  - **DynamoDB table specifications** for `workspace-config`:
    - Partition key: `workspaceId` (S)
    - Billing: PAY_PER_REQUEST
    - SSE: AWS-managed
    - PITR: disabled (Q2=A)
    - TTL: disabled (no expiry on workspace policy)
    - Deletion protection: env-specific
    - DDB Streams: disabled
  - **IAM scope** restated from NFR Requirements Q6=A (the lambda execution role)
  - **VPC topology**: Lambda outside VPC (Q4=B); no VPC endpoint needed
  - **Per-table CloudWatch alarms**:
    - `ThrottledRequests` rate > 0 over 5 min → page (indicates capacity issue despite on-demand)
    - `SystemErrors` rate > 0 → page (AWS-side DDB issues)
    - `UserErrors` rate > 1% over 15 min → warning (could indicate code bug)
  - SECURITY rule compliance summary at this stage

### Phase 2 — Deployment Architecture
- [x] B2. Create `aidlc-docs/construction/persistence/infrastructure-design/deployment-architecture.md`:
  - Per-environment configuration matrix (dev/staging/prod): PITR, deletion protection toggle
  - Single-region deployment (Q6=A) — region selection deferred to U-4
  - CloudFormation/CDK construct ownership: U-4's `ClassificationDataStack` defines both tables; U-2 contributes the schema specifications
  - Deployment workflow: `cdk deploy` provisions; `cdk diff` shows changes; deletion guard via Q5=A
  - Backup/recovery procedure: PITR-restore documented; manual on-demand backup recommended before major schema migrations
  - Migration considerations: adding new attributes is safe (DDB schemaless); changing PK requires table rename + data migration

### Phase 3 — Wrap-up
- [x] B3. Update `aidlc-docs/aidlc-state.md` — U-2 Infrastructure Design marked Completed.
- [x] B4. Update `aidlc-docs/audit.md`.
- [x] B5. Present the 2-option completion message.

---

## D. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part C executes without further questions until the standardized 2-option completion message.
