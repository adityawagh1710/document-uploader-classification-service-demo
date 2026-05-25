# NFR Requirements — U-4 `infrastructure`

> Per-NFR applicability for the CDK / infrastructure-as-code unit + locked decisions + SECURITY/PBT compliance + CI quality gates.

---

## 1. Per-NFR Applicability for U-4

U-4 owns **build-time** infrastructure quality. Runtime NFRs (NFR-1..10) belong to the units producing runtime behaviour (U-1/U-2/U-3); U-4 ensures those decisions are correctly materialised in AWS resources.

| NFR | Applies to U-4? | Concrete meaning for U-4 |
|---|---|---|
| NFR-1..3 (S3 ranged GET, streaming hash, window size) | N/A — owned by U-3 | U-4 just provisions the Lambda |
| NFR-4 (workspace isolation) | Inherited | DDB partition key schema in `ClassificationDataStack` matches U-2 spec |
| NFR-5 (determinism) | N/A | Runtime concern |
| NFR-6 (config-driven) | Indirect | Per-env config files (`infra/config/{dev,staging,prod}.ts`) provide configurability |
| NFR-7..8 (observability) | Inherited | Lambda Tracing.ACTIVE + alarms wired per U-3 IaD |
| NFR-9 (one invocation per task) | N/A | Lambda concurrency model owned by U-3 |
| NFR-10 (per-workspace TTL) | Inherited | DDB TTL attribute config |

**Summary**: U-4's NFR concerns are derived from the **build-time + deploy-time** quality of the IaC code, not the runtime characteristics of the deployed infrastructure.

---

## 2. Locked NFR Decisions for U-4

### 2.1 CDK Version Pinning — Q1=A
All three CDK packages exact-pinned:
- `aws-cdk-lib@2.158.0` (or current stable at codegen time)
- `aws-cdk@2.158.0` (CLI; same major.minor as the library)
- `constructs@10.4.2`

**Enforcement**: `package-lock.json` committed; CI verifies via `npm ci --frozen-lockfile`.

### 2.2 cdk-nag Version Pinning — Q2=A
- `cdk-nag@^2.x` (caret-pin) — accepts patch + minor updates from AWS guidance

**Reaction process**: when cdk-nag adds a new rule that surfaces a warning on our infrastructure, either:
- Fix the underlying issue, or
- Document a suppression with a reason

### 2.3 Deployment Automation — Q3=A
- **Dev / staging**: auto-deploy on merge to `main` via GitHub Actions
- **Prod**: manual `workflow_dispatch` approval; runs the same `cdk deploy` command
- The `aws-actions/configure-aws-credentials@v4` action authenticates via OIDC (no long-lived secrets)

### 2.4 Snapshot Test Stability — Q4=A
Use `cdk-lib/assertions` `Match.anyValue()` (and `Match.absent()`, `Match.objectLike()`) for known-unstable fields:
- CDK-generated asset hashes (e.g., `S3Bucket`, `S3Key` of Lambda code asset)
- Auto-generated logical IDs (CDK appends hashes for deduplication)
- Regional placeholders (`Aws::Region`, `Aws::Partition`)

Snapshots committed to `infra/lib/__snapshots__/`; re-snapshotting is a deliberate `--update` action that produces a reviewable diff.

### 2.5 Coverage Targets — Q5=A
**No coverage threshold on `infra/**`.** The test guarantees come from:
- Snapshot diff (catches unintended drift)
- `Template.hasResourceProperties` fine-grained assertions (encodes the spec)
- `cdk-nag` aspect (validates AWS best-practice rules)

This is the canonical CDK test strategy; branch coverage is a category error for declarative code.

### 2.6 CI Gates — Q6=A
Three new jobs added by U-4 on top of existing U-1/U-2/U-3 gates:

| Job | Tool | Pass criterion |
|---|---|---|
| `cdk-synth` | `cdk synth -c env=dev` | Synth succeeds (exits 0) |
| `cdk-nag` | `cdk synth -c env=dev` (with `Aspects.of(app).add(new AwsSolutionsChecks())`) | Zero non-suppressed violations |
| `infra-tests` | `vitest run infra/lib/**/*.test.ts` | All snapshot + assertion tests pass |

Plus inherited gates from U-3: `verify-bundle` (Bundle smoke check).

Plus U-3's `test-smoke` (SAM Local) gate runs after `cdk synth` because SAM Local needs the synthesised template.

---

## 3. SECURITY Compliance for U-4

| Rule | Status for U-4 | Notes |
|---|---|---|
| SECURITY-01 (encryption) | **Yes — U-4 materialises** | CDK code instantiates DDB SSE + Lambda KMS encryption (default) |
| SECURITY-03 (app logging) | **Yes — U-4 materialises** | CDK code sets log retention (per env: 7/30/90 days) |
| SECURITY-06 (least-privilege IAM) | **Yes — U-4 materialises** | CDK code instantiates the 4 inline IAM statements + 2 managed policies + suppressions |
| SECURITY-07 (network) | **Justified deviation (inherited)** | Lambda outside VPC documented |
| SECURITY-09 (hardening) | **Yes — U-4 materialises** | DDB tables with deletion protection + RemovalPolicy.RETAIN in prod; no public access |
| SECURITY-10 (supply chain) | **Yes** | CDK packages exact-pinned; `package-lock.json` committed; npm audit gate |
| SECURITY-13 (data + CI/CD integrity) | **Yes — U-4 enforces** | GitHub Actions workflow files are PR-reviewable; cdk-nag prevents accidental IAM regressions; branch protection on `main` |
| SECURITY-14 (alerting + monitoring) | **Yes — U-4 materialises** | 10 alarms wired in `ClassificationObservabilityStack` |
| SECURITY-15 (fail-safe) | Indirect | CDK deploys fail closed (CFN rollback on error) |

All other SECURITY rules either N/A for infrastructure (SECURITY-02, 04, 05, 08, 11, 12) or inherited at the runtime level.

**Blocking findings**: none.

---

## 4. PBT Compliance for U-4

**N/A with rationale** — inherited from Functional Design Q6=A.

CDK code is declarative AWS resource specification, not algorithmic logic. PBT-01's verification criteria explicitly accept N/A: *"Components with no identifiable properties are explicitly marked as 'No PBT properties identified' with a brief rationale"*. Equivalent coverage from snapshot tests + `Template.hasResourceProperties` assertions + `cdk-nag` aspect.

---

## 5. CI Quality Gates for U-4

Gates that must pass for any PR touching `infra/**`:

| Gate | Tool | Threshold |
|---|---|---|
| Lint | ESLint | Zero errors (separate `infra/.eslintrc.cjs` may apply or extend root) |
| Type check | `tsc --noEmit` against `infra/tsconfig.json` | Zero errors |
| `cdk-synth` | `cdk synth -c env=dev` | Synth succeeds |
| `cdk-nag` | `cdk synth` with AwsSolutionsChecks aspect | Zero non-suppressed violations |
| `infra-tests` | Vitest on `infra/lib/**/*.test.ts` | All pass |
| Supply chain | `npm audit --omit=dev` | Zero high/critical |

---

## 6. Open Items for Subsequent Stages

| Item | Stage |
|---|---|
| Concrete GitHub Actions workflow YAML files | NFR Design |
| AWS account IDs per environment + region selection | Infrastructure Design |
| Concrete `infra/tsconfig.json` excluded from root `src/` compile | NFR Design (logical) + Code Generation (concrete) |
| GitHub OIDC role configuration for credential-less deploys | Infrastructure Design |
| `cdk.json` content with feature flags + custom synth output dir | Code Generation |
