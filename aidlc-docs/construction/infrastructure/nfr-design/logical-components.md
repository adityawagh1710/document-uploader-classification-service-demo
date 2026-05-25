# Logical Components — U-4 `infrastructure`

> Per-component NFR-role + pattern + satisfaction. U-4 owns the CDK stacks, the test infrastructure for CDK, and the CI/CD workflow files.

---

## 1. Source Components (under `infra/`)

### 1.1 Stack Classes

| Component | Path | Pattern Embodied | NFR Role |
|---|---|---|---|
| `ClassificationDataStack` | `infra/lib/data-stack.ts` | P-4-2 (co-located suppressions), P-4-7 (cdk-nag aspect inherited from app) | Provisions 2 DDB tables (inherits all U-2 IaD decisions) |
| `ClassificationLambdaStack` | `infra/lib/lambda-stack.ts` | P-4-2, P-4-7 | Provisions Lambda function + IAM + X-Ray (inherits all U-3 IaD decisions) |
| `ClassificationObservabilityStack` | `infra/lib/observability-stack.ts` | P-4-7 | Provisions 10 alarms + CloudWatch dashboard |

### 1.2 Entry Point

| Component | Path | Pattern Embodied |
|---|---|---|
| `app.ts` | `infra/bin/app.ts` | P-4-3 (calls `loadEnvConfig`), P-4-7 (applies cdk-nag aspect at app level) |

### 1.3 Configuration

| Component | Path | Purpose |
|---|---|---|
| `EnvConfig` interface | `infra/config/types.ts` | 16-property typed config shape |
| `loadEnvConfig` | `infra/config/load.ts` | Pattern P-4-3 — explicit switch + fail-closed |
| Per-env values | `infra/config/{dev,staging,prod}.ts` | Concrete `EnvConfig` instances |

### 1.4 Test Helper

| Component | Path | Pattern Embodied |
|---|---|---|
| `buildAppAndTemplate`, `snapshotTemplate` | `infra/lib/_test-helpers.ts` | Pattern P-4-1 |

---

## 2. CDK Configuration Files

### 2.1 `cdk.json` (project root)

```json
{
  "app": "node --import tsx infra/bin/app.ts",
  "watch": {
    "include": ["infra/**", "src/**"],
    "exclude": ["**/*.test.ts", "**/__snapshots__/**", "node_modules", "dist", "cdk.out"]
  },
  "output": "cdk.out",
  "context": {
    "@aws-cdk/core:newStyleStackSynthesis": true,
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/aws-iam:standardizedServicePrincipals": true,
    "@aws-cdk/aws-lambda-nodejs:useLatestRuntimeVersion": true
  }
}
```

### 2.2 `infra/tsconfig.json`

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["./**/*", "../src/**/*"],
  "exclude": ["../node_modules", "../dist", "../coverage", "**/*.test.ts", "**/__snapshots__/**"]
}
```

### 2.3 `infra/.eslintrc.cjs` (or extend root with additional rules)

```javascript
// infra/.eslintrc.cjs (extends root)
module.exports = {
  extends: ["../.eslintrc.cjs"],
  parserOptions: { project: "./tsconfig.json", tsconfigRootDir: __dirname },
  rules: {
    // infra/ is a separate package boundary — fewer restrictions than src/
    "no-restricted-imports": "off",
    "no-restricted-syntax": "off",
    "no-restricted-properties": "off",
    "no-restricted-globals": "off",
    "boundaries/element-types": "off",
  },
};
```

---

## 3. Test Infrastructure Components

### 3.1 Stack Test Files

```
infra/lib/data-stack.test.ts
infra/lib/lambda-stack.test.ts
infra/lib/observability-stack.test.ts
```

Each test file:
- Uses `buildAppAndTemplate(StackCtor)` from `_test-helpers.ts`
- Includes 1 snapshot test (`toMatchSnapshot`)
- Includes 3-5 fine-grained `template.hasResourceProperties` assertions encoding the spec

### 3.2 Snapshot Directory

```
infra/lib/__snapshots__/
├── data-stack.test.ts.snap
├── lambda-stack.test.ts.snap
└── observability-stack.test.ts.snap
```

Snapshots are committed to git; updates require `vitest run --update` and produce a reviewable diff.

### 3.3 Load Test

```
infra/config/load.test.ts
```

Tests:
- `loadEnvConfig("dev")` returns dev config
- `loadEnvConfig("staging")` returns staging config
- `loadEnvConfig("prod")` returns prod config
- `loadEnvConfig("invalid")` throws with descriptive message

---

## 4. CI Workflow Components

### 4.1 `.github/workflows/ci.yml`

11 jobs with hierarchical dependencies (Pattern P-4-6):

| Job | Needs | Tool | Gate |
|---|---|---|---|
| `lint` | — | ESLint | Zero errors |
| `typecheck` | `lint` | `tsc --noEmit` + `tsc -p infra/tsconfig.json --noEmit` | Zero errors |
| `test-unit` | `typecheck` | `vitest run tests/unit` | All pass |
| `test-pbt` | `typecheck` | `vitest run tests/pbt tests/regression` | All pass |
| `test-integration` | `typecheck` | `vitest run tests/integration` (needs Docker) | All pass |
| `test-smoke` | `cdk-synth` | `vitest run tests/smoke` (needs SAM CLI) | All pass |
| `coverage` | `test-unit`, `test-pbt`, `test-integration` | `vitest run --coverage` | Thresholds met |
| `cdk-synth` | `typecheck` | `npx cdk synth -c env=dev` | Synth succeeds |
| `cdk-nag` | `cdk-synth` | (cdk-nag aspect runs during synth) | No non-suppressed violations |
| `infra-tests` | `typecheck` | `npx vitest run infra/lib infra/config` | All pass |
| `verify-bundle` | `cdk-synth` | `bash scripts/verify-bundle.sh cdk.out` | ≤5MB + handler export |
| `supply-chain` | — | `npm audit --omit=dev --audit-level=high` | Zero high/critical |

### 4.2 `.github/workflows/deploy.yml`

Per Pattern P-4-5 with OIDC + environment protection:

| Job | Trigger | AWS Account | Approval |
|---|---|---|---|
| `deploy-dev` | push to main | dev account | None |
| `deploy-staging` | push to main; `needs: deploy-dev` | staging account | None |
| `deploy-prod` | `workflow_dispatch` only; `environment: prod` | prod account | Manual approval via GitHub environment-protection rules |

---

## 5. NFR ↔ Component Coverage Matrix

| Rule | Components that satisfy |
|---|---|
| NFR-4 (workspace isolation) | `ClassificationDataStack` (PK/SK schema) |
| NFR-6 (config-driven) | `loadEnvConfig` + per-env config files |
| NFR-7 / NFR-8 (observability) | `ClassificationObservabilityStack` (10 alarms + dashboard) |
| NFR-10 (per-workspace TTL) | `ClassificationDataStack` (TTL attribute on content-hashes) |
| SECURITY-01 (encryption) | `ClassificationDataStack` (DDB SSE), Lambda function (default KMS) |
| SECURITY-03 (logging) | Lambda log retention setting + Powertools env vars |
| SECURITY-06 (least-privilege IAM) | `ClassificationLambdaStack` IAM policy + cdk-nag IAM5 check |
| SECURITY-07 (justified deviation) | Documented in U-1 IaD; no VPC config in `ClassificationLambdaStack` |
| SECURITY-09 (hardening) | `RemovalPolicy.RETAIN` in prod + deletion protection |
| SECURITY-10 (supply chain) | CDK exact-pinned in `package.json` + `package-lock.json` |
| SECURITY-13 (CI/CD integrity) | GitHub Actions OIDC + `environment: prod` protection (Pattern P-4-5) + `cdk-nag` per-PR gate (Pattern P-4-7) |
| SECURITY-14 (alerting) | 10 alarms in `ClassificationObservabilityStack` |
| SECURITY-15 (fail-closed) | `loadEnvConfig` throws on unknown env (Pattern P-4-3) |

Every applicable rule has a named component. No gaps.

---

## 6. Open Items for Subsequent Stages

| Item | Stage |
|---|---|
| Concrete AWS account IDs in per-env config files | Infrastructure Design |
| GitHub OIDC role ARNs per env | Infrastructure Design |
| State Machine ARN cross-stack export contract finalisation | Infrastructure Design |
| SSM parameter for alarms SNS topic — provisioning contract | Infrastructure Design (operational) |
| `cdk.json` final content with all feature flags | Code Generation |
| Concrete `_test-helpers.ts` implementation | Code Generation |
| Concrete `.github/workflows/{ci,deploy}.yml` YAML | Code Generation |
