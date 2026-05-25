# Infrastructure Design Plan — U-4 `infrastructure`

> Per-unit Construction stage 4/5. U-4's own "Infrastructure Design" is somewhat meta — U-4 IS the infrastructure unit. Most infrastructure decisions are already in U-1/U-2/U-3 IaD docs (which U-4 materialises). This stage covers the **meta-infrastructure**: CDK Bootstrap, stack naming + tagging, AWS account model, cross-stack export mechanisms, and resource lifecycle.
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

---

## A. Category Applicability

| Category | Applies to U-4? | Notes |
|---|---|---|
| Deployment Environment | **Yes — owns** | U-4 defines the AWS account model + region selection |
| Compute Infrastructure | Inherited | Specs from U-3 IaD |
| Storage Infrastructure | Inherited | Specs from U-2 IaD |
| Messaging Infrastructure | N/A | Upstream State Machine |
| **Networking Infrastructure** | **Justified deviation (inherited)** | Lambda outside VPC per U-1 IaD; revisit trigger documented |
| Monitoring Infrastructure | Inherited | Alarms specs from U-2 + U-3 IaD; U-4 wires them via SNS topic |
| **Shared Infrastructure** | **Yes — owns** | CDK Bootstrap, GitHub OIDC, cross-stack export contracts |

---

## B. Infrastructure Design Questions

### Question 1 — CDK Bootstrap strategy
CDK requires a one-time `cdk bootstrap` per AWS account + region pair, which provisions a CDK toolkit stack (S3 bucket for assets, IAM roles, ECR repo). Choose strategy:

A) **Standard `cdk bootstrap` per env account + region**, with the **modern (new-style)** bootstrap that uses CDK execution roles. The bootstrap is a one-time operation per account documented in the deployment-architecture doc; not automated by CI.

B) Bootstrap automated as a CI prerequisite step — runs idempotently on every deploy. Adds CI time; bootstrap rarely changes.

C) Manual bootstrap with custom IAM roles — most control; most overhead.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Standard new-style bootstrap is the AWS-recommended approach for production. It's a one-time operation per account; automating it in CI (B) is wasted compute since `cdk bootstrap` is a no-op when already provisioned. Custom IAM roles (C) are appropriate when you need to tightly scope what CDK can deploy — overkill for our 3-stack service where the deploy role IS the only thing that needs broad CDK perms. Documented as a runbook step in deployment-architecture.md.

### Question 2 — CloudFormation stack naming convention
With per-env stacks, stack names need a convention. Choose:

A) **`Classification{Component}-{env}` format** — e.g., `ClassificationData-prod`, `ClassificationLambda-prod`, `ClassificationObservability-prod`. Per-env suffix makes it visible in AWS console.

B) Name suffix only in non-prod — `ClassificationData` (prod), `ClassificationData-staging`, `ClassificationData-dev`. Prod's canonical name aligns with the service name.

C) Stage-prefixed — `prod-ClassificationData`. Per-env grouping in the console.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: `Classification{Component}-{env}` is unambiguous, sortable by component first then env (useful when scanning the console for "what does this service have?"), and prevents accidents like "deleted ClassificationData in dev but the production stack was actually called the same thing". Per-env suffix in every env (including prod) keeps the convention uniform. Option B's prod-special-case opens the door to mistakes.

### Question 3 — Resource tagging strategy
AWS tags drive cost allocation, ownership lookup, automation policies. Choose:

A) **Apply 6 tags at the CDK app level** so every resource inherits: `Service=classification-service`, `Component={data|lambda|observability}`, `Environment={dev|staging|prod}`, `ManagedBy=cdk`, `Owner=platform-team`, `CostCenter={tbd}`. Via `cdk.Tags.of(app).add(...)`.

B) Component-level tags only (no service-level) — narrower; less searchable.

C) No tags — relies on console grouping by stack. Loses cost-allocation granularity.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: App-level tagging via `Tags.of(app)` propagates to every taggable resource, which is exactly the cost-allocation visibility we want. The 6 tags map cleanly to AWS Cost Explorer dimensions + AWS Config tag policies. `CostCenter` is left as `tbd` since the actual cost center comes from the org's finance taxonomy — Code Generation places `tbd` as a clear placeholder for the operator to fill in. Without tagging (C), per-customer or per-service cost attribution becomes manual.

### Question 4 — AWS account model
Choose AWS account structure:

A) **3 separate accounts** (`dev-account`, `staging-account`, `prod-account`) — strongest isolation; standard for production-grade services.

B) Single account with prod-only AWS Organizations SCP — simpler; less safe (mistakes can blast across envs).

C) 2 accounts (non-prod + prod) — moderate isolation; common compromise.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: 3 separate accounts is the production-canonical pattern. Account-level isolation prevents the worst-case "deleted the prod table while testing in dev" failure. AWS Organizations supports this cleanly; the CDK deploys to the appropriate account based on the assumed OIDC role (Pattern P-4-5). Option B's single-account model is cheaper to set up but trades that against catastrophic-blast-radius incidents. Option C is intermediate — fine for smaller orgs but doesn't match the "production-grade" spec context.

### Question 5 — Cross-stack export mechanism
The Lambda stack imports the State Machine ARN + Document bucket ARN from upstream stacks (not owned by this service). Choose import mechanism:

A) **`Fn.importValue` for resources owned by sibling CFN stacks; SSM Parameter Store for centrally-managed values (alarm SNS topic ARN)** — pragmatic mix matching the source of truth.

B) Everything via SSM Parameter Store — uniform; requires SSM permission on the Lambda role.

C) Everything via `Fn.importValue` — uniform; couples deploy order across stacks.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: The mixed approach matches each value's natural source. State Machine + Document bucket are CloudFormation-managed resources; `Fn.importValue` is the canonical pattern (typed in CDK; resolved at deploy time; CFN enforces dependency ordering). Alarm SNS topic is owned by a separate observability stack potentially deployed in a different CDK app; SSM Parameter Store decouples deploy order. The pragmatic mix is documented at U-4 IaD §5 of the U-3 design.

### Question 6 — Termination protection on prod stacks
CloudFormation has `EnableTerminationProtection` (defends against accidental `cdk destroy`).

A) **Enabled on all 3 prod stacks; disabled in dev/staging** — env-conditional in CDK code. Operator can disable explicitly via console for prod tear-down (e.g., end-of-service shutdown).

B) Disabled everywhere — relies on AWS IAM to prevent unauthorised deletes.

C) Enabled everywhere including dev — risk: dev cleanup is harder.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Per-env termination protection adds a second layer beyond `deletionProtection` on the DDB tables (Q5=A of U-2 IaD). Prod stacks should require explicit operator action to delete — `cdk destroy` from CI must fail until protection is disabled. Dev stacks need `cdk destroy` to work for developer workflows (matches U-2 IaD §1 dev deletion-protection-off rule). Option B is the equivalent of B in Q5 of U-2 IaD — same risk profile. Option C makes dev workflows painful.

---

## C. Generation Checklist (executes after plan approval)

### Phase 1 — Infrastructure Design Document
- [x] B1. Create `aidlc-docs/construction/infrastructure/infrastructure-design/infrastructure-design.md`:
  - Category applicability table (per §A)
  - **CDK Bootstrap runbook** (Q1=A) — per-account bootstrap commands + new-style execution roles
  - **CloudFormation stack naming** (Q2=A) — naming convention table with examples
  - **Resource tagging strategy** (Q3=A) — 6-tag schema applied via `Tags.of(app)`
  - **AWS account model** (Q4=A) — 3-account model with Organizations relationships
  - **Cross-stack import contract** (Q5=A) — `Fn.importValue` for sibling-CFN, SSM for centrally-managed
  - **Termination protection** (Q6=A) — per-env CDK setting
  - SECURITY compliance final picture (combined across U-2 + U-3 + U-4)
  - cdk-nag rule status

### Phase 2 — Deployment Architecture
- [x] B2. Create `aidlc-docs/construction/infrastructure/infrastructure-design/deployment-architecture.md`:
  - Multi-account deployment diagram (CI → OIDC → assume role → cdk deploy)
  - Per-environment deployment checklist (one-time + per-deploy)
  - Rollback procedure (per-stack-level)
  - Disaster-recovery procedure (account-level loss scenario)
  - Service tear-down procedure (when retiring the service)
  - Cost estimate (combined across U-1 + U-2 + U-3 + U-4)
  - Final handoff items for Code Generation

### Phase 3 — Wrap-up
- [x] B3. Update `aidlc-state.md` — U-4 Infrastructure Design marked Completed.
- [x] B4. Update `aidlc-docs/audit.md`.
- [x] B5. Present the 2-option completion message.

---

## D. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part C executes without further questions until the standardized 2-option completion message.
