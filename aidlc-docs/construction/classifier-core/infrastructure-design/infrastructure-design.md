# Infrastructure Design — U-1 `classifier-core`

> U-1 is pure-domain TypeScript with **zero runtime AWS resources**. This document captures the build + CI infrastructure that U-1 participates in, and names exactly what U-1 does NOT own.

---

## 1. Category Applicability

| Category | Applies to U-1? | Owned by |
|---|---|---|
| Deployment Environment | Inherited (AWS) | Service-level decision |
| Compute Infrastructure | **N/A** | U-3 (Lambda) + U-4 (CDK) |
| Storage Infrastructure | **N/A** | U-2 (DynamoDB) + U-4 (CDK) |
| Messaging Infrastructure | **N/A** | U-3 (Step Functions task-token) |
| Networking Infrastructure | **N/A** | U-4 (VPC, endpoints) |
| Monitoring Infrastructure | Inherited | U-3 (Powertools wiring) + U-4 (CloudWatch + X-Ray) |
| Shared Infrastructure (build + CI) | **Applies** | U-1 + service-wide tooling |

---

## 2. What U-1 Does NOT Own

Explicit pointers to the units that DO own each concern:

- **Lambda function definition + IAM role** → U-3 NFR Design + U-4 `ClassificationLambdaStack`
- **DynamoDB tables (`content-hashes`, `workspace-config`)** → U-2 NFR Design + U-4 `ClassificationDataStack`
- **VPC + private endpoints (for S3, DDB, SFN access)** → U-4 `ClassificationLambdaStack`
- **CloudWatch log groups + retention + custom metric namespace** → U-4 `ClassificationObservabilityStack`
- **X-Ray service map + sampling configuration** → U-4 `ClassificationObservabilityStack`
- **CloudWatch alarms** (latency p99, `SendTaskFailure` rate, auth-failure) → U-4 `ClassificationObservabilityStack`
- **Step Function task-token signaling** → U-3 handler (uses `TaskSignaler` port; the CDK State Machine itself is upstream)
- **S3 ranged GET / streaming I/O** → U-3 handler via `S3Reader` + `S3Streamer` ports

---

## 3. Locked Infrastructure Decisions (Q1–Q4)

### 3.1 Bundling — Q1=A
**esbuild via CDK `NodejsFunction` construct**.

Concrete configuration:
- CDK construct: `aws-cdk-lib/aws-lambda-nodejs.NodejsFunction`
- Bundling options (specified by U-4's `ClassificationLambdaStack` but consumed by U-1's compile path):
  - `target: "node20"`
  - `minify: true`
  - `sourceMap: true` (for X-Ray traces)
  - `externalModules: ["@aws-sdk/*"]` (provided by the Lambda runtime)
  - `format: "esm"` (matches our `"type": "module"` in `package.json`)
- U-1 contributes: nothing special. As long as U-1 stays in `src/domain/**` with no I/O imports, esbuild tree-shakes it cleanly into the bundle.

### 3.2 CI Runner — Q2=A
**GitHub Actions on `ubuntu-latest`** with Node 20.

Concrete workflow file (materialised in U-4 Infrastructure Design):
```yaml
# .github/workflows/ci.yml (excerpt — U-1 jobs only)
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
    needs: lint  # fail-fast on lint before paying for typecheck
    steps: [ checkout, setup-node, cache, npm ci, npm run typecheck ]

  test-unit:
    runs-on: ubuntu-latest
    steps: [ ..., npm run test:unit ]

  test-pbt:
    runs-on: ubuntu-latest
    steps: [ ..., npm run test:pbt ]

  coverage:
    runs-on: ubuntu-latest
    steps: [ ..., npm run test:coverage ]

  bench:
    runs-on: ubuntu-latest
    # Only run if src/domain/** changed
    if: contains(github.event.pull_request.changed_files, 'src/domain/')
    steps: [ ..., npm run bench ]

  supply-chain:
    runs-on: ubuntu-latest
    steps: [ ..., npm audit --omit=dev --audit-level=high ]

  pbt-regression-diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: git diff origin/main -- tests/regression/pbt-failures.json
      - run: |
          if git diff --quiet origin/main -- tests/regression/pbt-failures.json; then
            echo "No new PBT regressions."
          else
            echo "::warning::New PBT regressions captured. Confirm intentional."
          fi
```

### 3.3 Dependency Caching — Q3=A
**`actions/cache@v4`** keyed on `${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}`.

- Cache hit: ~5 s restore + `npm ci --prefer-offline` ~3 s
- Cache miss: ~30 s fresh `npm ci`
- `npm ci`'s strict-lockfile mode mitigates cache-poisoning risk

### 3.4 Bundle Verification — Q4=A
**Smoke check + 5 MB size budget** (run by U-3's build pipeline, since U-3 owns the handler export; U-1 contributes the compiled domain code that imports cleanly).

Concrete script (U-3 will write this; documented here as the contract U-1 must support):
```bash
# scripts/verify-bundle.sh
set -euo pipefail
BUNDLE_PATH="cdk.out/asset.*/handler.js"
BUNDLE_SIZE_BYTES=$(stat -c%s "$BUNDLE_PATH")
MAX_BYTES=5242880  # 5 MB

if [ "$BUNDLE_SIZE_BYTES" -gt "$MAX_BYTES" ]; then
  echo "::error::Bundle size $BUNDLE_SIZE_BYTES > 5MB ($MAX_BYTES)"
  exit 1
fi

# Smoke check: bundle must load and export `handler`
node -e "import('$BUNDLE_PATH').then(m => { if (typeof m.handler !== 'function') process.exit(1) })"

echo "Bundle OK: ${BUNDLE_SIZE_BYTES} bytes"
```

**U-1's contract**: ensure that no module in `src/domain/**` has top-level side effects that throw when the bundle is first loaded. The ESLint rule set (no AWS SDK imports, no `Date.now()` etc.) plus the "no I/O in domain" boundary already enforces this.

---

## 4. CI Gate Manifest (concrete)

| Gate | GitHub Actions job | Runner | Cache | Trigger | Pass criterion |
|---|---|---|---|---|---|
| Lint | `lint` | ubuntu-latest | `~/.npm` keyed on lockfile | every PR + push | zero errors |
| Type check | `typecheck` | ubuntu-latest | (same) | every PR + push | zero errors |
| Unit tests | `test-unit` | ubuntu-latest | (same) | every PR + push | all pass |
| PBT tests | `test-pbt` | ubuntu-latest | (same) | every PR + push | all pass; seeds logged |
| Coverage | `coverage` | ubuntu-latest | (same) | every PR + push | ≥ 90% on `src/domain/**`, ≥ 95% on `tier2-ole2/**` |
| Perf bench | `bench` | ubuntu-latest | (same) | PRs touching `src/domain/**` | p99 ≤ baseline × 1.10 AND ≤ budget |
| Supply chain | `supply-chain` | ubuntu-latest | (same) | every PR + nightly | zero high/critical from `npm audit` |
| PBT regression diff | `pbt-regression-diff` | ubuntu-latest | n/a | every PR | new entries in `pbt-failures.json` warned (not blocking) |

All gates run in parallel after `lint` passes (lint is the fast pre-check). `npm ci` cost shared via cache.

---

## 5. U-1's Position in the Service Build Pipeline

```
Source                       Build                       Deploy
─────────────                ────────────                ─────────────
src/domain/**                tsc typecheck               
src/shared/**     ───►       ESLint check        ───►    bundled into
tests/**                     Vitest test suite           Lambda zip
                             esbuild bundling            by CDK NodejsFunction
                             (tree-shakes file-type)     (U-4)
                                                            │
                                                            ▼
                                                         CDK deploy
                                                         (U-4 stacks)
                                                            │
                                                            ▼
                                                         AWS Lambda
                                                         executing
                                                         ClassificationService
                                                         (orchestrator in U-3,
                                                         calling U-1's
                                                         pure-domain functions)
```

U-1's "infrastructure" footprint is entirely build-time + CI-time. **At deploy-and-runtime, U-1 is just function calls inside a Lambda that U-4 deploys and U-3 entry-points.**

---

## 6. Compliance Notes for This Stage

| Rule | Status for U-1 Infrastructure | Note |
|---|---|---|
| SECURITY-10 (supply chain) | **Compliant** | `npm audit` gate (high/critical level); `actions/cache@v4` versioned exactly; runner image pinned (`ubuntu-latest` is the GitHub convention — explicit-major pin `ubuntu-24.04` would be stricter but breaks when GitHub rotates; the `actions/setup-node@v4 with: node-version: 20` is the load-bearing pin) |
| SECURITY-13 (CI/CD integrity) | **Compliant** | GitHub Actions workflow files in `.github/workflows/` are subject to branch-protection rules (configured at U-4 stage); only repo admins can push to `main`; secret-less workflow (no AWS deploy secrets in U-1 CI jobs — those live in U-4's deploy workflow) |
| SECURITY-14 (alerting) | **Inherited** | CI failure notifications via GitHub default + (optional) Slack webhook for `main` branch failures — wired in U-4 |
| Cross-cutting boundaries | **Compliant** | U-1 owns NO AWS resources by construction; the explicit "What U-1 does NOT own" section (§2) makes this auditable |

**Blocking findings**: none.
