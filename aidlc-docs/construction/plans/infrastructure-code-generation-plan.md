# Code Generation Plan — U-4 `infrastructure`

> Per-unit Construction stage 5/5. **The final code generation in the Construction phase.** ~20 files materialising all CDK code, configs, tests, GitHub Actions workflows, and documentation.

---

## 1. Unit Context

### 1.1 Stories Owned by U-4
- **US-SRE-003** — Per-workspace metrics dashboard
- **US-SRE-004** — Security-relevant alarms

### 1.2 Dependencies and Boundary
- New dev deps already locked in U-4 NFR Reqs §2: `aws-cdk-lib@2.158.0`, `aws-cdk@2.158.0`, `constructs@10.4.2`, `cdk-nag@^2.30.0`, `tsx@^4.16.0`
- `infra/` is a separate package boundary; doesn't import from `src/` (CDK only references `src/handler/lambda.ts` as the bundling entry path)
- Test code is in `infra/lib/__snapshots__/` and `infra/lib/*.test.ts` — not under `tests/`

### 1.3 Service Boundaries
- `infra/` may import `aws-cdk-lib`, `cdk-nag`, `constructs` — never application code at runtime
- The only "import" from `src/` is the bundling `entry` path in `NodejsFunction`, which is a build-time path string — not a TypeScript import

---

## 2. Code Generation Steps

> Each step has a `[ ]` checkbox. Mark `[x]` immediately on completion.

### Phase 1 — Project Configuration

- [x] **Step 1.1** Update root `package.json`: add CDK runtime deps + cdk-nag + tsx (per U-4 NFR Reqs §2).
- [x] **Step 1.2** Create `cdk.json` at repo root (per U-4 NFR Design §2.1).
- [x] **Step 1.3** Create `infra/tsconfig.json` (per U-4 NFR Design §2.2).
- [x] **Step 1.4** Create `infra/.eslintrc.cjs` (per U-4 NFR Design §2.3).

### Phase 2 — Per-Environment Configuration

- [x] **Step 2.1** Create `infra/config/types.ts` — `EnvConfig` interface (17 properties).
- [x] **Step 2.2** Create `infra/config/load.ts` — `loadEnvConfig` switch with throw on unknown env.
- [x] **Step 2.3** Create `infra/config/load.test.ts` — verifies all 4 paths (dev / staging / prod / invalid).
- [x] **Step 2.4** Create `infra/config/dev.ts` — dev environment values.
- [x] **Step 2.5** Create `infra/config/staging.ts` — staging environment values.
- [x] **Step 2.6** Create `infra/config/prod.ts` — prod environment values.

### Phase 3 — CDK Stacks

- [x] **Step 3.1** Create `infra/lib/data-stack.ts` — `ClassificationDataStack` per U-2 IaD + U-4 IaD §2.
- [x] **Step 3.2** Create `infra/lib/lambda-stack.ts` — `ClassificationLambdaStack` per U-3 IaD + U-4 IaD §2.
- [x] **Step 3.3** Create `infra/lib/observability-stack.ts` — `ClassificationObservabilityStack` per U-2/U-3 IaD alarms + U-4 IaD §3.

### Phase 4 — CDK App Entry-Point

- [x] **Step 4.1** Create `infra/bin/app.ts` — entry-point with env loading + stack instantiation + tagging + cdk-nag aspect.

### Phase 5 — Test Helper + Stack Tests

- [x] **Step 5.1** Create `infra/lib/_test-helpers.ts` — `buildAppAndTemplate`, `snapshotTemplate` per Pattern P-4-1.
- [x] **Step 5.2** Create `infra/lib/data-stack.test.ts` — snapshot + targeted assertions.
- [x] **Step 5.3** Create `infra/lib/lambda-stack.test.ts` — same pattern.
- [x] **Step 5.4** Create `infra/lib/observability-stack.test.ts` — same pattern.

### Phase 6 — GitHub Actions Workflows

- [x] **Step 6.1** Create `.github/workflows/ci.yml` — 11-job CI workflow per Pattern P-4-6.
- [x] **Step 6.2** Create `.github/workflows/deploy.yml` — 3-job deploy workflow with OIDC + environment protection per Pattern P-4-5.

### Phase 7 — Documentation

- [x] **Step 7.1** Create `aidlc-docs/construction/infrastructure/code/code-summary.md` — file inventory + final service-level summary.

---

## 3. Story Closure on Completion

- ✅ **US-SRE-003** — `ClassificationObservabilityStack` creates the CloudWatch dashboard with per-workspace / per-category widgets
- ✅ **US-SRE-004** — All 10 alarms wired to SNS topic with PagerDuty + Slack subscribers

---

## 4. Scope Estimate

- **~20 source / config / test files** total
- **3 CDK stacks** + **1 entry point** + **3 stack tests** + **1 load test** + **1 test helper**
- **4 config files** + **3 root config files** (cdk.json, tsconfig.json, eslintrc)
- **2 GitHub Actions workflows**
- **1 documentation file**

---

## 5. Approval Gate

After review, the user explicitly approves this plan. Then Part 2 executes the ~20 steps in order. After this stage, only **Build and Test** remains in the Construction phase.
