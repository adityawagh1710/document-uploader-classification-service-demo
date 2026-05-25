# Infrastructure Design Plan — U-3 `handler`

> Per-unit Construction stage 4/5. U-3 owns the **Lambda function specification + IAM policy + Lambda-level alarms + X-Ray config**. U-4 implements the CDK code; this plan resolves U-3's remaining infrastructure decisions.
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

---

## A. Category Applicability

| Category | Applies to U-3? | Notes |
|---|---|---|
| Deployment Environment | Inherited (AWS) | Service-level |
| **Compute Infrastructure** | **Yes — core** | Lambda function definition; consumed by U-4's CDK |
| Storage Infrastructure | N/A | Owned by U-2 |
| Messaging Infrastructure | N/A | Step Functions State Machine is upstream of this Lambda |
| Networking Infrastructure | **Justified deviation** | Lambda outside VPC per U-1 IaD Q4=B (inherited) |
| **Monitoring Infrastructure** | **Yes — partial** | Lambda-level alarms (Duration, Errors, Throttles) — U-3 specifies; U-4 materialises |
| Shared Infrastructure | Inherited | CI runner from U-1 |

---

## B. Infrastructure Design Questions

### Question 1 — Lambda version + alias strategy
Lambda functions can have published versions + aliases (e.g., `live`, `staging`). Choose strategy:

A) **Single alias `live` pointing to `$LATEST`** — simplest; redeploys atomically update the alias; no blue/green complexity.

B) **`live` alias + canary deployment via CodeDeploy** — `live` points to weighted versions during deploy (10% new, 90% previous; auto-shift over 10 min). Reduces blast radius of bad deploys.

C) Multiple aliases per environment with version pins (`live`, `staging`, `rollback`) — manual rollback target maintained.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Single alias = simplest production posture. Lambda's atomic alias-update semantics give us all-or-nothing deploys without CodeDeploy complexity. CodeDeploy canary (B) is excellent for high-traffic synchronous APIs where a 5% bad-deploy rate is observable; for our back-office classifier with Step Function task retries, a bad deploy that throws on every invocation surfaces immediately in CloudWatch alarms and we roll back manually within minutes. Multiple aliases (C) is overengineering — manual rollback via `cdk deploy` with the previous git commit is simpler and verified by the existing CI pipeline.

### Question 2 — State Machine ARN provisioning
The Lambda needs the State Machine ARN for `SendTaskSuccess` / `SendTaskFailure`. How is it sourced?

A) **Environment variable `STATE_MACHINE_ARN` populated by U-4's CDK from a CloudFormation export** — the State Machine stack exports its ARN; the Lambda stack imports + injects.

B) AWS Systems Manager Parameter Store reference — Lambda reads on cold start. Adds an SSM call at init.

C) Hardcoded in CDK per-environment config — operator updates the file when ARN changes.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: CloudFormation export/import is the canonical AWS pattern for cross-stack references. CDK supports it directly (`Fn.importValue`). The env var is resolved at deploy time (no runtime SSM cost), and changing the State Machine ARN triggers a Lambda redeploy automatically (CloudFormation detects the dependency). Option B adds runtime SSM API calls + a new IAM permission for SSM. Option C breaks the operator's "just `cdk deploy`" workflow.

### Question 3 — CloudWatch alarm SNS topic strategy
Lambda alarms need a destination. Choose how alarms route.

A) **Single SNS topic per environment** (`classification-service-alarms-${env}`), subscribed to:
   - PagerDuty webhook (for prod paging alarms)
   - Slack Lambda subscriber (for prod warning + staging alarms)
   - Email subscription (for dev)
   Alarms in `OK→ALARM` state publish; topic fan-out handles the rest. U-3 doesn't own the topic — references it via SSM Parameter Store `/observability/sns-topic-arn/${env}`.

B) Direct alarm-to-PagerDuty integration (no SNS) — couples each alarm to one destination; harder to fan-out.

C) CloudWatch native PagerDuty integration via AWS Chatbot — newer AWS feature; less documented.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: SNS topic fan-out is the canonical AWS pattern. The topic is owned by an "observability" stack (outside U-3's scope) and referenced via SSM — Lambda doesn't need to know the implementation. PagerDuty / Slack / email subscribers all subscribe to the topic via SNS, providing both reliability (SNS retry) and flexibility (add/remove subscribers without touching alarm code). The SSM reference pattern matches AWS's "discoverability" best practice. Option B couples alarm definitions to destination types — fragile.

### Question 4 — Lambda-level CloudWatch alarms
Which alarms does U-3 specify? (U-4 materialises them.)

A) **Standard set of 5 alarms**:
   - `Duration p99 > budget` (size-class dimensioned via custom metric; pages on-call)
   - `Errors > 0 over 5 min` (pages on-call)
   - `Throttles > 0 over 5 min` (warns; could indicate concurrency exhaustion)
   - `ConcurrentExecutions > 80% reserved` (warns prod; indicates approaching cap)
   - `ColdStart p99 > 3s` (warns; indicates bundle/init regression)

B) Just Duration + Errors — minimal.

C) Comprehensive — 10+ alarms including memory utilisation, init duration breakdown, etc.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: 5 alarms cover the operationally meaningful failure modes without alert fatigue. The Duration alarm dimensioned by size class (small/large) catches regressions specific to one document profile. ColdStart alarm catches bundle bloat or init-time regressions before they become latency budget violations. Throttles + ConcurrentExecutions alarms cover Q2=A's prod concurrency cap. Option B misses too much; option C invites alarm fatigue (every alarm = pager noise that desensitizes responders).

### Question 5 — X-Ray sampling rule
X-Ray sampling controls how many traces are collected (cost-vs-visibility tradeoff). Choose default rule.

A) **`reservoirSize: 1, fixedRate: 0.05`** — at least 1 trace/second guaranteed; 5% of additional traffic sampled. Standard production posture.

B) `fixedRate: 1.0` — trace everything. Best visibility, highest cost.

C) `fixedRate: 0.01` — 1% sample rate; lowest cost, sparser data.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: AWS's recommended default. The reservoir guarantees that even low-traffic periods have at least 1 trace/sec (so we always see incidents); 5% additional sampling caps cost during bursts. For a back-office classifier with moderate traffic (a few thousand documents/day per workspace), this gives plenty of trace data for US-SRE-001 reconstruction without unbounded X-Ray costs. Option B is fine for the first few weeks of production then unsustainable; option C misses the long-tail anomalies SRE wants to investigate.

### Question 6 — SAM CLI installation in CI
The smoke test job needs the SAM CLI installed in the GitHub Actions runner.

A) **`aws-actions/setup-sam` GitHub Action pinned at a specific version** — official AWS-maintained action; installs SAM CLI + Docker availability check. Single line in workflow YAML.

B) Manual install via `pip install aws-sam-cli` — flexibility; one more step.

C) Use a custom Docker image with SAM pre-installed — fastest startup; more maintenance.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: `aws-actions/setup-sam` is AWS-maintained, kept up-to-date with SAM releases, and integrates cleanly with `ubuntu-latest` runners. Pinning to a specific version (e.g., `aws-actions/setup-sam@v2.0.0`) matches our supply-chain hygiene (SECURITY-10). Option B works but you'd then need to manage Python + pip versions yourself. Option C is overengineering for a CI step that runs in ~30 seconds.

---

## C. Generation Checklist (executes after plan approval)

### Phase 1 — Infrastructure Design Document
- [x] B1. Create `aidlc-docs/construction/handler/infrastructure-design/infrastructure-design.md`:
  - Category applicability table (per §A)
  - **Lambda function specification** (consolidating NFR Reqs §2.1, §2.5 + Q1=A version/alias + Q5=A X-Ray sampling):
    - Runtime, memory, timeout, architecture, reserved concurrency
    - Bundling configuration
    - Environment variables (with State Machine ARN from Q2=A)
    - IAM policy (per NFR Reqs §2.5 verbatim)
    - X-Ray tracing config (`Tracing.ACTIVE` + sampling rule per Q5=A)
    - Alias strategy per Q1=A
  - **State Machine ARN cross-stack import** (Q2=A) — `Fn.importValue` pattern documented for U-4
  - **CloudWatch alarms** (Q4=A — 5 alarms with concrete thresholds + Q3=A SNS topic reference via SSM)
  - VPC topology — explicit "Lambda outside VPC" inheritance from U-1 IaD with revisit trigger
  - SECURITY compliance summary

### Phase 2 — Deployment Architecture
- [x] B2. Create `aidlc-docs/construction/handler/infrastructure-design/deployment-architecture.md`:
  - Per-environment configuration matrix (dev/staging/prod for memory, concurrency, env vars, alarm SNS topic ARN)
  - Deployment flow: PR merge → cdk synth → verify-bundle → cdk deploy → post-deploy validation (smoke test against the deployed Lambda)
  - Rollback procedure: revert git commit → cdk deploy → Lambda alias atomically points to previous version
  - Cost estimate per environment
  - Handoff list to U-4 (concrete CDK files to materialise + the SNS topic reference + the SAM setup in GitHub Actions)

### Phase 3 — Wrap-up
- [x] B3. Update `aidlc-state.md` — U-3 Infrastructure Design marked Completed.
- [x] B4. Update `aidlc-docs/audit.md`.
- [x] B5. Present the 2-option completion message.

---

## D. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part C executes without further questions until the standardized 2-option completion message.
