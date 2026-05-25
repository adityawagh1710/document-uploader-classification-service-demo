# Tech Stack Decisions — U-4 `infrastructure`

> New dev dependencies + CDK configuration + per-environment deploy matrix + CI workflow files introduced by U-4. Inherits everything from U-1/U-2/U-3.

---

## 1. Service-Level Decisions Inherited

| Concern | Choice | Source |
|---|---|---|
| Runtime | Node.js 20.x LTS | U-1 |
| Language | TypeScript strict-plus | U-1 |
| Test framework | Vitest | U-1 |
| Project layout | Single `package.json` at root (with separate `infra/tsconfig.json`) | U-1 + Application Design Q8=A |
| IaC tool | AWS CDK (TypeScript) | Application Design Q7=A |
| cdk-nag rule pack | `AwsSolutionsChecks` + 2 documented suppressions | U-4 FD Q5=A |

---

## 2. U-4 Dev Dependencies

CDK is a build-time + deploy-time concern; everything goes under `devDependencies`.

| Package | Version | Pin Strategy | Rationale |
|---|---|---|---|
| `aws-cdk-lib` | `2.158.0` | **Exact** | Per Q1=A — CDK minors bring template-shape changes |
| `aws-cdk` (CLI) | `2.158.0` | **Exact** | Same major.minor as library; CDK validates version skew |
| `constructs` | `10.4.2` | **Exact** | Required peer dep of `aws-cdk-lib`; exact-pin for snapshot determinism |
| `cdk-nag` | `^2.30.0` | Caret | Per Q2=A — new AWS-guidance rules surface as warnings |

Total new dev deps for U-4: 4 packages.

---

## 3. CDK Configuration Files

### 3.1 `cdk.json` (project root)

```json
{
  "app": "node --import tsx infra/bin/app.ts",
  "watch": {
    "include": ["infra/**", "src/**"],
    "exclude": ["**/*.test.ts", "**/__snapshots__/**", "node_modules", "dist", "cdk.out"]
  },
  "output": "cdk.out",
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk/core:target-partitions": ["aws"],
    "@aws-cdk-containers/ecs-service-extensions:enableDefaultLogDriver": true,
    "@aws-cdk/aws-iam:standardizedServicePrincipals": true,
    "@aws-cdk/core:newStyleStackSynthesis": true,
    "@aws-cdk/aws-lambda:checkInternetConnectivity": true,
    "@aws-cdk/aws-lambda-nodejs:useLatestRuntimeVersion": true
  }
}
```

Notable settings:
- `app`: uses `tsx` (TypeScript executor) to run `app.ts` without a pre-build step — fast iteration
- `output`: standard `cdk.out` for CFN templates + bundles
- Feature flags align with current CDK recommendations

### 3.2 `infra/tsconfig.json`

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["./**/*", "../src/**/*"],
  "exclude": ["../node_modules", "../dist", "../coverage", "**/*.test.ts"]
}
```

The `infra/tsconfig.json` is a separate compile unit that may import from `../src/handler/lambda.ts` (via the NodejsFunction `entry` prop) but never the other way around.

---

## 4. Lambda Bundling Configuration (handed off from U-3)

Already specified in U-3 IaD §2.2 and U-3 tech-stack-decisions §5. Restated for U-4 reference:

```typescript
bundling: {
  target: "node20",
  minify: true,
  sourceMap: true,
  externalModules: ["@aws-sdk/*"],   // Provided by Lambda runtime
  format: OutputFormat.ESM,
}
```

---

## 5. Per-Environment Deploy Matrix

Per Q3=A. The deploy workflow runs `cdk deploy` with appropriate context. AWS credentials provided via GitHub OIDC.

| Environment | AWS Account | Region | Auto-deploy trigger | Approval required |
|---|---|---|---|---|
| `dev` | `111111111111` (TBD; placeholder) | `us-east-1` | On merge to `main` (infra/** or src/handler/** changed) | None |
| `staging` | `222222222222` (TBD) | `us-east-1` | On merge to `main` (same paths) | None |
| `prod` | `333333333333` (TBD) | `us-east-1` | `workflow_dispatch` only | Manual approval (GitHub environment protection rule) |

The actual account IDs and per-env CFN export names will be locked at U-4's Infrastructure Design stage when AWS account provisioning is confirmed.

---

## 6. CI Workflow Files

### 6.1 `.github/workflows/ci.yml` (PR + push to main)

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: actions/cache@v4
        with:
          path: ~/.npm
          key: ${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}
      - run: npm ci
      - run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    needs: lint
    steps: [/* checkout, setup-node, cache, npm ci */, run: npm run typecheck]

  test-unit:
    runs-on: ubuntu-latest
    steps: [..., run: npm run test:unit]

  test-pbt:
    runs-on: ubuntu-latest
    steps: [..., run: npm run test:pbt]

  test-integration:
    runs-on: ubuntu-latest
    steps: [..., run: npm run test:integration]   # Docker available on ubuntu-latest

  test-smoke:
    runs-on: ubuntu-latest
    if: contains(github.event.pull_request.changed_files, 'src/handler/')
    steps:
      - /* checkout, setup-node, cache, npm ci */
      - uses: aws-actions/setup-sam@v2.0.0
      - run: npm run build
      - run: npm run test:smoke

  coverage:
    runs-on: ubuntu-latest
    steps: [..., run: npm run test:coverage]

  cdk-synth:
    runs-on: ubuntu-latest
    steps: [..., run: npx cdk synth -c env=dev]

  cdk-nag:
    runs-on: ubuntu-latest
    needs: cdk-synth
    steps: [..., run: npx cdk synth -c env=dev]   # cdk-nag aspect runs during synth

  infra-tests:
    runs-on: ubuntu-latest
    steps: [..., run: npx vitest run infra/lib]

  verify-bundle:
    runs-on: ubuntu-latest
    needs: cdk-synth
    steps: [..., run: bash scripts/verify-bundle.sh cdk.out]

  supply-chain:
    runs-on: ubuntu-latest
    steps: [..., run: npm audit --omit=dev --audit-level=high]
```

### 6.2 `.github/workflows/deploy.yml` (auto-deploy + manual prod)

```yaml
name: Deploy
on:
  push:
    branches: [main]
    paths: ['infra/**', 'src/**']
  workflow_dispatch:
    inputs:
      env:
        description: 'Environment'
        required: true
        type: choice
        options: [dev, staging, prod]

permissions:
  id-token: write     # for OIDC
  contents: read

jobs:
  deploy-dev:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    environment: dev
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::111111111111:role/github-actions-deploy
          aws-region: us-east-1
      - run: npx cdk deploy --all -c env=dev --require-approval never

  deploy-staging:
    if: github.event_name == 'push'
    needs: deploy-dev
    runs-on: ubuntu-latest
    environment: staging
    steps: [/* same pattern with staging account + -c env=staging */]

  deploy-prod:
    if: github.event_name == 'workflow_dispatch' && github.event.inputs.env == 'prod'
    runs-on: ubuntu-latest
    environment: prod   # GitHub environment-protection requires manual approval
    steps: [/* same pattern with prod account + -c env=prod */]
```

The GitHub environment named `prod` has a protection rule requiring manual approval from a designated reviewer (configured outside Code Generation — at the GitHub repo settings level).

---

## 7. Package.json Excerpt (after U-4 Code Generation)

```jsonc
{
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit && tsc -p infra/tsconfig.json --noEmit",
    "test:unit": "vitest run tests/unit",
    "test:pbt": "vitest run tests/pbt tests/regression",
    "test:integration": "vitest run tests/integration",
    "test:smoke": "vitest run tests/smoke",
    "test:coverage": "vitest run --coverage tests/unit tests/pbt",
    "bench": "vitest bench --run",
    "build": "tsc -p tsconfig.json",
    "verify-bundle": "bash scripts/verify-bundle.sh",
    "cdk": "cdk"
  },
  "devDependencies": {
    // … existing
    "aws-cdk-lib": "2.158.0",
    "aws-cdk": "2.158.0",
    "constructs": "10.4.2",
    "cdk-nag": "^2.30.0",
    "tsx": "^4.16.0"
  }
}
```

`tsx` is a small dev dep used by `cdk.json` to execute TypeScript directly (faster iteration than `tsc + node`).

---

## 8. Supply Chain Hygiene (SECURITY-10)

| Practice | Configuration |
|---|---|
| Lockfile committed | `package-lock.json` |
| Exact-pinned CDK | `aws-cdk-lib@2.158.0`, `aws-cdk@2.158.0`, `constructs@10.4.2` |
| Caret-pinned cdk-nag | `^2.30.0` (patch + minor accepted) |
| Vulnerability scan | `npm audit --omit=dev` (existing) |
| GitHub Actions pinned | All `uses:` directives pinned to specific version (e.g., `actions/checkout@v4`, `aws-actions/setup-sam@v2.0.0`) |

---

## 9. Open Items for Subsequent Stages

| Item | Stage |
|---|---|
| Concrete AWS account IDs per env (replace `111111111111` placeholders) | Infrastructure Design |
| GitHub OIDC role ARNs per env | Infrastructure Design |
| GitHub environment protection rules (manual approval reviewers) | Infrastructure Design (operational config; not CDK) |
| Concrete State Machine + Document Bucket ARN values per env | Infrastructure Design |
| SNS topic SSM parameter paths | Infrastructure Design |
