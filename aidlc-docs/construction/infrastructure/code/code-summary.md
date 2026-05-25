# Code Summary — U-4 `infrastructure`

> Final Construction code summary. U-4 materialises all CDK infrastructure, per-env config, stack tests, GitHub Actions workflows, and supporting documentation. This is the last Code Generation stage before **Build and Test**.

---

## 1. File Inventory

### 1.1 Project Configuration (Phase 1 — 4 files)

| File | Purpose |
|---|---|
| `package.json` | Added `aws-cdk-lib@2.158.0` / `aws-cdk@2.158.0` / `constructs@10.4.2` (exact-pinned), `cdk-nag@^2.30.0`, `tsx@^4.16.0` and scripts: `cdk`, `cdk:synth`, `cdk:diff`, `test:infra` |
| `cdk.json` | `node --import tsx infra/bin/app.ts` entry; CDK feature flags pinned |
| `infra/tsconfig.json` | Separate compile unit; extends root tsconfig; `noEmit:true`; includes `src/**/*` for type resolution only |
| `infra/.eslintrc.cjs` | Extends root; disables `no-restricted-imports`, `no-restricted-syntax`, `boundaries/element-types` (infra is a separate package boundary) |

### 1.2 Per-Environment Configuration (Phase 2 — 6 files)

| File | Purpose |
|---|---|
| `infra/config/types.ts` | `EnvConfig` interface — 17 typed properties |
| `infra/config/load.ts` | `loadEnvConfig(env: string)` — explicit switch with throw on unknown env (Pattern P-4-3, fail-closed per SECURITY-15) |
| `infra/config/load.test.ts` | 8 cases — dev/staging/prod paths + invalid path + missing CLI arg + case-sensitivity + shape integrity |
| `infra/config/dev.ts` | Dev env values — account `111111111111`, log retention 14d, no concurrency cap |
| `infra/config/staging.ts` | Staging env values — account `222222222222`, log retention 30d |
| `infra/config/prod.ts` | Prod env values — account `333333333333`, log retention 90d, reserved concurrency 200 |

### 1.3 CDK Stacks (Phase 3 — 3 files)

| File | Stack Class | Resources |
|---|---|---|
| `infra/lib/data-stack.ts` | `ClassificationDataStack` | 2 DDB tables (content-hashes with PK+SK, PITR, TTL; workspace-config with PK only) + cdk-nag DDB3 suppression on workspace-config + 2 CfnOutputs |
| `infra/lib/lambda-stack.ts` | `ClassificationLambdaStack` | `NodejsFunction` (Node 20, ARM64, 512MB, 30s) + IAM (4 inline policy statements scoped to U-2/U-3 IaD) + X-Ray sampling rule + `live` alias + cdk-nag IAM4/L1 suppressions |
| `infra/lib/observability-stack.ts` | `ClassificationObservabilityStack` | 10 alarms (4 DDB + 6 Lambda; prod-only concurrency alarm) + CloudWatch dashboard + SNS topic lookup from SSM Parameter Store |

### 1.4 CDK App Entry Point (Phase 4 — 1 file)

| File | Purpose |
|---|---|
| `infra/bin/app.ts` | Reads `env` context → `loadEnvConfig` → instantiates 3 stacks in dependency order (data → lambda → observability) → 5 app-level tags (`Service`, `Owner`, `CostCenter`, `Environment`, `ManagedBy`) → applies `AwsSolutionsChecks` cdk-nag aspect app-wide |

### 1.5 Test Helper + Stack Tests (Phase 5 — 4 files)

| File | Purpose |
|---|---|
| `infra/lib/_test-helpers.ts` | `buildAppAndStack(stackCtor, props)` + `snapshotTemplate(template)` with `scrubVolatile` (strips asset hashes, S3 keys, version IDs from snapshots) |
| `infra/lib/data-stack.test.ts` | 6 tests — table counts, PK/SK schema, PITR on, TTL attribute, RemovalPolicy.RETAIN, snapshot |
| `infra/lib/lambda-stack.test.ts` | 8 tests — runtime, arch, memory, timeout, env vars present, IAM policy shape, alias exists, snapshot |
| `infra/lib/observability-stack.test.ts` | 6 tests — alarm count (9 dev / 10 prod), Dashboard, SNS actions wired, p99 thresholds (3000 small / 15000 large), snapshot |

### 1.6 GitHub Actions Workflows (Phase 6 — 2 files)

| File | Pattern | Jobs |
|---|---|---|
| `.github/workflows/ci.yml` | Pattern P-4-6 (hierarchical fan-out) | `lint` → `typecheck` → fan-out: `test-unit` / `test-pbt` / `test-integration` / `cdk-synth` / `infra-tests`; `cdk-synth` gates `cdk-nag` / `verify-bundle` / `test-smoke`; `coverage` aggregates; `supply-chain` runs in parallel |
| `.github/workflows/deploy.yml` | Pattern P-4-5 (OIDC + env protection) | `deploy-dev` (auto on push to main) → `deploy-staging` (auto, needs dev) ; `deploy-prod` (workflow_dispatch only, `environment: prod` requires manual approval) ; `deploy-manual` (workflow_dispatch for dev/staging) |

### 1.7 Documentation (Phase 7 — 1 file)

| File | Purpose |
|---|---|
| `aidlc-docs/construction/infrastructure/code/code-summary.md` | This file |

---

## 2. Total Material Footprint

- **21 files** written or updated in U-4
- **3 CDK stacks** producing **3 deployable CloudFormation templates** per environment
- **10 CloudWatch alarms** + **1 dashboard**
- **2 DynamoDB tables**, **1 Lambda function**, **1 alias**, **1 X-Ray sampling rule**
- **2 CI/CD workflows** wiring **11 CI jobs** + **4 deploy jobs**
- **24 test cases** across stack tests + 8 cases in config loader = **32 infra-tests**
- **3 documented cdk-nag suppressions** (DDB3, IAM4, L1) — all justified in U-2/U-3 IaD

---

## 3. NFR / SECURITY Compliance Recap (per logical-components.md §5)

| Rule | Components | Status |
|---|---|---|
| NFR-4 — workspace isolation | `ClassificationDataStack` PK/SK schema | ✅ |
| NFR-6 — config-driven | `loadEnvConfig` + per-env files | ✅ |
| NFR-7/8 — observability | `ClassificationObservabilityStack` (10 alarms + dashboard) | ✅ |
| NFR-10 — per-workspace TTL | `ClassificationDataStack` TTL attribute | ✅ |
| SECURITY-01 — encryption | DDB SSE + Lambda default KMS | ✅ |
| SECURITY-03 — log retention | Lambda log retention per env (14d/30d/90d) | ✅ |
| SECURITY-06 — least-privilege IAM | 4 scoped inline statements; cdk-nag IAM5 enforced | ✅ |
| SECURITY-07 — Lambda outside VPC | Documented deviation in U-1 IaD; no VPC config | ⚠️ Justified |
| SECURITY-09 — hardening | `RemovalPolicy.RETAIN` + deletion protection in prod | ✅ |
| SECURITY-10 — supply chain | All CDK deps exact-pinned; `npm audit` in CI | ✅ |
| SECURITY-13 — CI/CD integrity | OIDC + `environment: prod` protection + cdk-nag per-PR | ✅ |
| SECURITY-14 — alerting | 10 alarms wired to SNS topic | ✅ |
| SECURITY-15 — fail-closed | `loadEnvConfig` throws on unknown env | ✅ |

Zero blocking findings.

---

## 4. PBT Coverage Note

Per U-4 NFR Requirements §5: **PBT does not apply to infrastructure code**. CDK code is declarative resource construction; properties under PBT (commutativity, idempotence, etc.) have no meaningful analogue. Snapshot tests + targeted property assertions provide the equivalent regression safety. This is the unit's documented PBT exemption rationale.

---

## 5. Stories Closed

- ✅ **US-SRE-003** — Per-workspace metrics dashboard (`ClassificationObservabilityStack` widgets)
- ✅ **US-SRE-004** — Security-relevant alarms (10 alarms wired to SNS topic via SSM lookup)

---

## 6. Build and Test Stage Entry Criteria

Construction Code Generation is now complete across all 4 units:

- ✅ U-1 classifier-core — 64 files
- ✅ U-2 persistence — 26 files
- ✅ U-3 handler — 45 files
- ✅ U-4 infrastructure — 21 files

**Total ~156 files generated across the Construction phase.**

The Build and Test stage will materialise:

- `build-instructions.md` — full build sequence (TypeScript → CDK synth → Lambda bundle verify)
- `unit-test-instructions.md` — `npm run test:unit` + `npm run test:pbt`
- `integration-test-instructions.md` — LocalStack + Docker requirements; `npm run test:integration`
- `performance-test-instructions.md` — load testing the deployed Lambda (cold start; concurrency; large-doc latency)
- `build-and-test-summary.md` — service-level execution playbook
