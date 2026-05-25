# Build Instructions

> Final Construction artifact for the Classification Service. Covers building the Lambda + CDK infrastructure across all 4 units (classifier-core, persistence, handler, infrastructure).

---

## 1. Prerequisites

### 1.1 Tooling

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20.x LTS (`>=20.11.0`) | Runtime + dev toolchain |
| npm | 10.x (bundled with Node 20) | Package manager |
| AWS CDK CLI | 2.158.0 (locally via `npx`) | Synth + deploy |
| AWS SAM CLI | ≥ 1.120.0 | Smoke tests via `sam local invoke` |
| Docker | ≥ 24.x | Required by SAM Local + LocalStack |
| AWS CLI | v2 ≥ 2.15 | One-time bootstrap + manual diagnostics |

> Workstation must have ≥ 8 GB RAM and ≥ 4 GB free disk to run Docker + bundling + tests in parallel.

### 1.2 Repository Layout

```
classification-service/
├── src/                  # Application code (U-1, U-2, U-3)
├── infra/                # CDK code (U-4)
├── tests/                # unit / pbt / integration / smoke / regression
├── scripts/              # verify-bundle.sh
├── .github/workflows/    # ci.yml, deploy.yml
├── package.json
├── tsconfig.json
├── cdk.json
└── template.yaml         # SAM Local config (handler smoke testing)
```

### 1.3 Environment Variables

No env vars are required at build time. At deploy time, the CDK app reads `env` from CDK context (`-c env=dev|staging|prod`) and loads matching `infra/config/{env}.ts`. AWS credentials are read from the standard credential chain (env vars, `~/.aws/credentials`, or OIDC role in CI).

---

## 2. Build Steps

### Step 1 — Install dependencies (clean install)

```bash
npm ci
```

- `ci` (not `install`) — strictly honours `package-lock.json`, fails on drift.
- Expected duration: ≈ 30–60 s on a warm npm cache.

### Step 2 — Type-check application code

```bash
npm run typecheck
```

Runs `tsc --noEmit` against `tsconfig.json` (covers `src/**/*`).

### Step 3 — Type-check infrastructure code

```bash
npx tsc -p infra/tsconfig.json --noEmit
```

Separate compile unit; covers `infra/**/*` against CDK + cdk-nag type defs.

### Step 4 — Lint

```bash
npm run lint
```

Runs ESLint with hexagonal boundary rules (`boundaries/element-types` restricts AWS SDK imports to `adapters/` only).

### Step 5 — Synthesize the CDK app

```bash
npx cdk synth -c env=dev
```

- Produces CloudFormation templates under `cdk.out/`
- Bundles the Lambda via `NodejsFunction` (esbuild) — the bundled JS lands in `cdk.out/asset.*/`
- The `AwsSolutionsChecks` aspect runs during synth; any non-suppressed cdk-nag violation fails this step

For staging / prod:

```bash
npx cdk synth -c env=staging
npx cdk synth -c env=prod
```

### Step 6 — Verify Lambda bundle size + handler export

```bash
bash scripts/verify-bundle.sh cdk.out
```

Validates:
- Bundle size ≤ 5 MB (NFR target)
- `handler` export exists in the bundled JS

### Step 7 — Build artifact summary

After the above succeed, the build outputs are:

| Artifact | Location | Purpose |
|---|---|---|
| `cdk.out/*.template.json` | 3 templates per env (data / lambda / observability) | Deployable CloudFormation |
| `cdk.out/asset.*/` | Bundled Lambda JS + source maps | Lambda code package |
| `cdk.out/cdk.out` | CDK assembly metadata | Used by `cdk deploy` |

---

## 3. Optional Build Targets

| Command | Purpose |
|---|---|
| `npm run build` | Emits compiled JS to `dist/` (used by smoke tests + IDE refactoring) |
| `npm run cdk:diff -- -c env=dev` | Diff synthesized template vs deployed stack (deploy-time pre-check) |
| `npm run clean` | Remove `dist/`, `cdk.out/`, `coverage/`, `.tsbuildinfo` |

---

## 4. Troubleshooting

### Build fails — "Cannot find module 'aws-cdk-lib'"
- **Cause**: Dependencies not installed.
- **Fix**: Re-run `npm ci`. If `node_modules/` is partially populated, delete it and retry.

### `cdk synth` fails — "AwsSolutions-IAM5 ... not suppressed"
- **Cause**: A new wildcard IAM action was introduced without a documented suppression.
- **Fix**: Either narrow the IAM action or add a `NagSuppressions.addResourceSuppressions(...)` with a written justification referencing the source IaD doc. **Do not silently broaden the suppression list.**

### `verify-bundle.sh` fails — "bundle exceeds 5 MB"
- **Cause**: A new heavyweight dependency was added to runtime (not dev) deps.
- **Fix**: Check `package.json` `dependencies` block — move build-time tooling to `devDependencies`; investigate whether the new dep is needed at runtime.

### Lint fails — "boundaries/element-types: 'src/domain/...' cannot import 'aws-cdk-lib'"
- **Cause**: Domain code imported an AWS SDK or CDK module.
- **Fix**: Domain code must remain pure. Move AWS-aware code into `src/adapters/` and inject behind a port interface.

### `cdk synth` fails on `prod` but succeeds on `dev`
- **Cause**: Prod-only resources (reserved concurrency alarm, deletion protection) hit edge cases.
- **Fix**: Run `npx cdk synth -c env=prod --debug` and inspect the failing resource.

---

## 5. Build Validation Checklist

Before any deploy, confirm:

- [ ] `npm ci` completed without errors
- [ ] `npm run typecheck` (both src + infra) returned 0
- [ ] `npm run lint` returned 0
- [ ] `npx cdk synth -c env={target}` completed without cdk-nag violations
- [ ] `bash scripts/verify-bundle.sh cdk.out` reported bundle ≤ 5 MB
- [ ] `cdk.out/` contains 3 templates for the target env
- [ ] CI passed on the source commit (see `.github/workflows/ci.yml`)
