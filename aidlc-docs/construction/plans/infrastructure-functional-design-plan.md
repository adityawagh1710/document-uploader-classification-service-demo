# Functional Design Plan — U-4 `infrastructure`

> Per-unit Construction stage 1/5. U-4 is the **infrastructure-as-code unit** that materialises the AWS resources specified by U-2's `infrastructure-design.md` (DDB tables + alarms + IAM) and U-3's `infrastructure-design.md` (Lambda function + alarms + IAM + X-Ray + SAM template). U-4 doesn't *invent* infrastructure decisions — those are all locked in U-2 + U-3's documents. U-4 writes the CDK code.
>
> All `[Answer]:` tags pre-filled with best-rationale picks. Override by changing the letter.

---

## A. Functional Design Questions

### Question 1 — CDK stack decomposition
The infrastructure has 3 logical groupings per `application-design/components.md` §1.5:
- `ClassificationDataStack` (2 DDB tables)
- `ClassificationLambdaStack` (Lambda + IAM)
- `ClassificationObservabilityStack` (alarms + log group config + X-Ray sampling)

Choose the stack layout:

A) **3 separate CDK stacks** as specified, deployed via a single CDK app entry-point. Lambda stack depends on Data stack via stack references; Observability stack depends on Lambda + Data via stack references.

B) **Single monolithic stack** containing all resources. Simpler dependency model; harder to deploy independently.

C) **5 stacks** — split Lambda IAM into its own stack, and split alarms from observability. Most modular; over-decomposed for this scope.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: 3 stacks match the natural ownership boundaries (data/compute/observability) and let us deploy/rollback each independently when needed. Stack references are first-class in CDK (typed cross-stack references via `Fn.importValue` or direct construct refs in the same app). Option B's monolithic stack would couple data lifecycle (rarely changes) to Lambda lifecycle (changes per PR) — every Lambda deploy would touch the DDB tables' CloudFormation logical IDs unnecessarily. Option C is over-decomposed: alarms naturally belong with the function being alarmed; splitting IAM from Lambda creates orphan IAM resources that are hard to manage.

### Question 2 — CDK construct library choice
CDK has multiple levels of constructs (L1 raw CloudFormation, L2 typed AWS constructs, L3 patterns + AWS Solutions Constructs). Choose primary level:

A) **L2 constructs for everything** — `Function`, `Table`, `Alarm`, `Topic` etc. Most flexibility; matches AWS docs; canonical CDK pattern.

B) **L3 AWS Solutions Constructs** (`@aws-solutions-constructs/aws-lambda-dynamodb`) — pre-validated patterns; opinionated; less flexibility.

C) **Mix**: L2 for the resources we need to configure precisely (Lambda with NodejsFunction, custom alarms); L3 where appropriate. Pragmatic but inconsistent.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: L2 constructs give us exactly the configurability we need without third-party opinions. Every property locked in U-2 + U-3's infrastructure-design docs maps directly to a CDK L2 prop (memory: 512, billing: PAY_PER_REQUEST, TTL attribute: "expiresAt", etc.). AWS Solutions Constructs (B) are excellent patterns but they make decisions for you that we've already deliberately made differently (e.g., Solutions Constructs default to provisioned billing in some templates). L2 + cdk-nag is the production-canonical combo.

### Question 3 — Test approach for CDK code
CDK code testing has 3 levels: snapshot tests, fine-grained assertions, integration tests (real deploy + tear down).

A) **Snapshot tests + fine-grained assertions** — snapshot tests catch unintended drift; targeted assertions verify the key properties (table billing mode, Lambda memory, IAM least-privilege scope, alarm thresholds). No real-deploy integration tests in CI (cost + time prohibitive).

B) Snapshot tests only — simplest; misses semantic regressions (e.g., a typo in alarm threshold that doesn't change snapshot but is wrong).

C) Real-deploy integration tests — deploy to a sandbox account, exercise the resources, tear down. Highest confidence; high cost; ~10 min per PR.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Snapshot tests + targeted assertions is the canonical CDK testing pattern. Snapshots catch "you didn't mean to change this" regressions; targeted assertions encode the spec ("memory MUST be 512", "DDB MUST have TTL on expiresAt"). Real-deploy tests (C) belong in a nightly job, not per-PR (they cost ~$1-5/run and take 10 min). Snapshot-only (B) misses too much — anyone who runs `cdk synth` after a typo sees a different snapshot and just commits the new one without thinking.

### Question 4 — CDK app entry-point and per-environment config
The CDK app entry-point (`infra/bin/app.ts`) instantiates stacks per environment. Choose pattern:

A) **Single app entry-point + per-env config file imports** — `infra/bin/app.ts` reads `infra/config/${env}.ts` (where env comes from `CDK_DEFAULT_ENV` or CLI arg `-c env=prod`); instantiates each stack with env-specific props. Standard CDK pattern.

B) Per-env app entry-points (`infra/bin/app-dev.ts`, etc.) — 3 files; more boilerplate.

C) Hardcoded env per stack at instantiation — fragile; "deploy to prod" is one CLI command different from "deploy to dev".

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: Standard CDK convention. The `-c env=prod` context flag is the canonical way to parameterise the entry-point. Per-env config files (`dev.ts`, `staging.ts`, `prod.ts`) keep the per-environment differences in one place each. The app entry-point reads `process.env.CDK_DEFAULT_ENV` OR `app.node.tryGetContext("env")` for environment selection, defaulting to `dev` for safety.

### Question 5 — cdk-nag rule set
cdk-nag has several rule packs (`AwsSolutions`, `HIPAA-Security`, `NIST-800-53`, etc.). Choose:

A) **`AwsSolutionsChecks` (default pack)** — covers ~80 rules covering IAM, encryption, monitoring, logging. Standard for production. Plus our 2 documented suppressions for `IAM4` (managed policies) + `L2` (no DLQ).

B) `AwsSolutionsChecks` + `HIPAA-Security` — more rules; appropriate if compliance requires HIPAA.

C) Custom narrow rule set — only the rules we care about. Loses general guidance.

D) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: `AwsSolutionsChecks` is the canonical production-grade rule pack. Each of our infrastructure design documents already addressed specific `AwsSolutions-*` rules (IAM5, IAM4, L1, L2, DDB3). HIPAA-Security (B) is the right answer if the spec calls out HIPAA compliance — `technical_input.md` doesn't, so we don't pre-emptively add the overhead. The 2 documented suppressions (IAM4 for AWS-managed Lambda logging + X-Ray policies; L2 for no DLQ since SFN task-retry serves that role) are the only deviations.

### Question 6 — PBT applicability to CDK code
PBT-01 requires every unit to enumerate testable properties during Functional Design. Does U-4 (declarative CDK code) have meaningful PBT properties?

A) **N/A for U-4** — CDK code is declarative AWS resource specification, not algorithmic. PBT applies to logic with input/output relationships; "the table has the right billing mode" is verified by targeted assertions, not by property tests across an input space.

B) Add 1-2 trivial properties (e.g., "every stack synthesises without error" — basically a smoke test).

C) Other (please describe after [Answer]: tag below)

[Answer]: A — Rationale: PBT rule definitions explicitly say to mark N/A when no meaningful properties exist (PBT-01 verification criteria: *"Components with no identifiable properties are explicitly marked as 'No PBT properties identified' with a brief rationale"*). U-4's snapshot-test + fine-grained-assertion strategy gives equivalent coverage. Forcing PBT here would be busywork. The PBT extension's `PBT-01` rule compliance for U-4 is "N/A with rationale".

---

## B. Generation Checklist (executes after plan approval)

### Phase 1 — Domain Entities
- [x] B1. Create `aidlc-docs/construction/infrastructure/functional-design/domain-entities.md`:
  - U-4 entity index (most entities live in U-2 + U-3 docs; this lists U-4's CDK construct surfaces)
  - Stack class hierarchy (`ClassificationDataStack`, `ClassificationLambdaStack`, `ClassificationObservabilityStack`) with their props interfaces
  - Per-environment config interface (`EnvConfig`)
  - CDK app entry-point contract
  - Cross-stack reference contract (Fn.importValue / direct refs)

### Phase 2 — Business Logic Model
- [x] B2. Create `aidlc-docs/construction/infrastructure/functional-design/business-logic-model.md`:
  - **`ClassificationDataStack.constructor`** — instantiates 2 DynamoDB tables with the exact U-2 specs
  - **`ClassificationLambdaStack.constructor`** — instantiates the Lambda function with U-3's specs + injects IAM + env vars
  - **`ClassificationObservabilityStack.constructor`** — defines 9 alarms (2 from U-2 (content-hashes-throttled, system-errors, user-errors-warn) wait — that's 3 actually; plus the workspace-config-not-found custom-metric alarm = 4 DDB alarms; plus 6 Lambda alarms from U-3 = 10 total. Recount: 4 (U-2) + 6 (U-3) = 10 alarms)
  - **`infra/bin/app.ts`** — entry-point reading env context, instantiating stacks
  - **`infra/config/{dev,staging,prod}.ts`** — per-env value records
  - **cdk-nag wiring** — applied at app level via `Aspects.of(app).add(new AwsSolutionsChecks())`

### Phase 3 — Business Rules
- [x] B3. Create `aidlc-docs/construction/infrastructure/functional-design/business-rules.md`:
  - Universal rules (declarative CDK; no app logic in CDK code; per-env via config files only)
  - DDB table rules (per U-2 IaD §2 + §3)
  - Lambda function rules (per U-3 IaD §2)
  - IAM scope rules (per U-3 IaD §2.4)
  - Alarm rules (per U-2 + U-3)
  - cdk-nag rules (suppressions enumerated)
  - PBT compliance: N/A with rationale (Q6=A)
  - SECURITY compliance map (final picture combining U-2 + U-3 + U-4-specific)

### Phase 4 — Validation
- [x] B4. Verify every infrastructure resource specified in U-2 + U-3 IaD docs has a corresponding CDK construct planned in U-4.
- [x] B5. Verify cdk-nag rule status documented for every rule that fires (pass or suppressed-with-reason).

### Phase 5 — Wrap-up
- [x] B6. Update `aidlc-state.md` — U-4 Functional Design marked Completed.
- [x] B7. Update `aidlc-docs/audit.md`.
- [x] B8. Present the 2-option completion message.

---

## C. Approval Gate

After all `[Answer]:` tags are filled (or accepted as pre-filled) and any follow-ups resolved, the user explicitly approves this plan. Then Part B executes without further questions until the standardized 2-option completion message.
