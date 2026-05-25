# NFR Design Patterns — U-4 `infrastructure`

> Seven CDK-specific patterns. U-4 inherits patterns from U-1 (Result, exhaustive switch, etc.) and U-2/U-3 (logging, conditional writes) where applicable, though most don't apply to declarative CDK code.

---

## Pattern P-4-1 — `synthAndAssertSnapshot` test helper

**Satisfies**: NFR Reqs Q3=A (snapshot + targeted assertions), Q4=A (Match.anyValue for stable snapshots)

**Pattern**:

```typescript
// infra/lib/_test-helpers.ts
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import type { EnvConfig } from "../config/types.js";
import devConfig from "../config/dev.js";

export function buildAppAndTemplate<T extends { new (...args: any[]): any }>(
  StackCtor: T,
  envConfig: EnvConfig = devConfig,
): { app: App; template: Template; stack: InstanceType<T> } {
  const app = new App();
  const stack = new StackCtor(app, "Test", { envConfig });
  const template = Template.fromStack(stack);
  return { app, template, stack };
}

export function snapshotTemplate(template: Template): unknown {
  // Strip CDK-internal hashes + region placeholders for snapshot stability
  return scrubVolatile(template.toJSON());
}

function scrubVolatile(json: unknown): unknown {
  // Recursive scrub of asset hashes, regional placeholders, etc.
  // Implementation in Code Generation.
  return json;
}
```

**Usage in test files**:

```typescript
// infra/lib/data-stack.test.ts
import { describe, it, expect } from "vitest";
import { Match } from "aws-cdk-lib/assertions";
import { ClassificationDataStack } from "./data-stack.js";
import { buildAppAndTemplate, snapshotTemplate } from "./_test-helpers.js";

describe("ClassificationDataStack", () => {
  const { template } = buildAppAndTemplate(ClassificationDataStack);

  it("creates exactly 2 DDB tables", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 2);
  });

  it("content-hashes table has TTL on expiresAt", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TimeToLiveSpecification: Match.objectLike({
        AttributeName: "expiresAt",
        Enabled: true,
      }),
    });
  });

  it("matches snapshot", () => {
    expect(snapshotTemplate(template)).toMatchSnapshot();
  });
});
```

**Enforcement**: Code review check — every stack test file uses the helper.

---

## Pattern P-4-2 — Co-located cdk-nag suppressions

**Satisfies**: SECURITY-06 (least-privilege IAM documented), SECURITY-13 (audit trail of suppression decisions)

**Pattern**: each suppression sits next to the construct it applies to, with a reason that references the deciding source.

```typescript
// Inside ClassificationDataStack (workspace-config table)
const workspaceConfigTable = new dynamodb.Table(this, "WorkspaceConfig", {
  // ...
  pointInTimeRecovery: false,
});

NagSuppressions.addResourceSuppressions(workspaceConfigTable, [
  {
    id: "AwsSolutions-DDB3",
    reason: "Workspace config is small (~hundreds of rows) and source-of-truth managed externally; PITR overhead not justified. Per U-2 IaD Q2=A.",
  },
]);
```

```typescript
// Inside ClassificationLambdaStack (Lambda role)
NagSuppressions.addResourceSuppressions(fn.role!, [
  {
    id: "AwsSolutions-IAM4",
    reason: "AWSLambdaBasicExecutionRole and AWSXRayDaemonWriteAccess are AWS-recommended managed policies for Lambda logging + X-Ray; using them is more reliable than re-deriving every action. Per U-3 IaD §6.",
    appliesTo: [
      "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
      "Policy::arn:<AWS::Partition>:iam::aws:policy/AWSXRayDaemonWriteAccess",
    ],
  },
]);

NagSuppressions.addResourceSuppressions(fn, [
  {
    id: "AwsSolutions-L2",
    reason: "Lambda DLQ not configured because the Step Function task-retry policy serves as the dead-letter mechanism for unrecoverable failures. Per U-3 IaD §6.",
  },
]);
```

**Enforcement**:
- `cdk-nag` aspect at app level surfaces unsuppressed violations during `cdk synth`
- Code review checks that every suppression has a `reason` referencing a deciding source

---

## Pattern P-4-3 — Explicit env switch with fail-closed default

**Satisfies**: SECURITY-15 (fail-closed), NFR-6 (config-driven)

**Pattern**:

```typescript
// infra/config/load.ts
import type { EnvConfig } from "./types.js";
import devConfig from "./dev.js";
import stagingConfig from "./staging.js";
import prodConfig from "./prod.js";

export function loadEnvConfig(envName: string): EnvConfig {
  switch (envName) {
    case "dev": return devConfig;
    case "staging": return stagingConfig;
    case "prod": return prodConfig;
    default:
      throw new Error(
        `Unknown environment "${envName}". Expected one of: dev, staging, prod. ` +
        `Pass via -c env=<name> or set CDK_DEFAULT_ENV.`,
      );
  }
}
```

**Why this works**:
- Switch fails loudly on typos (e.g., `prdo`)
- Error message tells the user how to fix it
- Static analysis catches future env addition: TypeScript narrows the return type when each case matches

**Enforcement**: a unit test in `infra/config/load.test.ts` verifies `loadEnvConfig("invalid")` throws.

---

## Pattern P-4-4 — Adjacent test files under `infra/lib/`

**Satisfies**: convention; matches `aws-cdk-lib`'s own test organisation

**Pattern**:

```
infra/
├── bin/
│   └── app.ts
├── lib/
│   ├── _test-helpers.ts
│   ├── data-stack.ts
│   ├── data-stack.test.ts
│   ├── __snapshots__/
│   │   ├── data-stack.test.ts.snap
│   │   ├── lambda-stack.test.ts.snap
│   │   └── observability-stack.test.ts.snap
│   ├── lambda-stack.ts
│   ├── lambda-stack.test.ts
│   ├── observability-stack.ts
│   └── observability-stack.test.ts
├── config/
│   ├── types.ts
│   ├── load.ts
│   ├── load.test.ts
│   ├── dev.ts
│   ├── staging.ts
│   └── prod.ts
├── cdk.json
└── tsconfig.json
```

**Why this works**:
- Tests + source side-by-side; no cross-tree navigation
- Snapshots in dedicated `__snapshots__/` directory (Vitest's default location)
- The `infra/` tree is its own package boundary; tests within it preserve that

**Enforcement**:
- Vitest config `include: "infra/lib/**/*.test.ts"`
- ESLint applied to both source and test files via the same `infra/tsconfig.json`

---

## Pattern P-4-5 — OIDC role with environment-conditioned trust

**Satisfies**: SECURITY-06 (least-privilege), SECURITY-13 (CI/CD integrity)

**Pattern** (the IAM role definitions live outside U-4's CDK — they're typically provisioned per AWS account by the platform team — but U-4 documents the required shape):

```json
// Required IAM trust policy for the GitHub OIDC role in PROD account
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::333333333333:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:${org}/classification-service:environment:prod"
        }
      }
    }
  ]
}
```

The trust policy locks the role to:
- Federated identity from GitHub Actions OIDC
- Repository: `${org}/classification-service`
- **Environment: `prod`** — only GitHub Actions runs gated by the `prod` environment can assume this role

The GitHub `environment: prod` setting in the deploy workflow + the GitHub environment-protection rules + this OIDC trust policy combine to give 3-layer defense:
1. The workflow file must specify `environment: prod` (visible in PRs)
2. GitHub blocks the deployment until manual approval (configured at repo level)
3. The OIDC role rejects assume-role requests from any workflow not gated by `environment: prod`

For dev/staging, the trust condition uses `ref:refs/heads/main` instead of `environment:`.

**Enforcement**: documented in U-4's deployment-architecture.md as the trust contract; the actual IAM role provisioning is operational (outside CDK).

---

## Pattern P-4-6 — Hierarchical CI job graph

**Satisfies**: NFR Reqs Q6=A (fast-fail on cheap checks)

**Pattern** (visualised as a dependency graph):

```
                  ┌──────────────┐
                  │     lint     │   (fastest: ~10s)
                  └──────┬───────┘
                         │
                  ┌──────▼───────┐
                  │   typecheck  │   (~20s)
                  └──────┬───────┘
                         │
       ┌─────────────────┼─────────────────────────┐
       │                 │                         │
       ▼                 ▼                         ▼
 ┌──────────┐    ┌─────────────┐         ┌──────────────────┐
 │ test-unit│    │  test-pbt   │         │   cdk-synth      │
 └──────────┘    └─────────────┘         └────────┬─────────┘
       │                 │                        │
       │                 │           ┌────────────┼────────────┐
       │                 │           │            │            │
       │                 │           ▼            ▼            ▼
       │                 │   ┌─────────────┐ ┌──────────┐ ┌──────────────┐
       │                 │   │  cdk-nag    │ │verify-   │ │  test-smoke  │
       │                 │   │             │ │bundle    │ │              │
       │                 │   └─────────────┘ └──────────┘ └──────────────┘
       │                 │
       └────┬────────────┘
            │
            ▼
  ┌──────────────────┐    ┌──────────────────┐    ┌─────────────────┐
  │ test-integration │    │ infra-tests      │    │ supply-chain    │
  └──────────────────┘    └──────────────────┘    └─────────────────┘
            │
            ▼
       ┌──────────┐
       │ coverage │   (consolidates unit + pbt + integration)
       └──────────┘
```

**Why this works**:
- Lint failure (~10s) kills the run before any heavyweight test starts
- Typecheck failure (~20s) kills the run before tests + cdk-synth
- cdk-synth output is required by cdk-nag, verify-bundle, and test-smoke — all gated on it succeeding
- Everything else runs in parallel for throughput

**Enforcement**: `.github/workflows/ci.yml` uses `needs:` to declare these dependencies.

---

## Pattern P-4-7 — cdk-nag aspect at app level

**Satisfies**: SECURITY-06, SECURITY-13 (entire-app validation)

**Pattern**:

```typescript
// infra/bin/app.ts
import { App } from "aws-cdk-lib";
import { Aspects } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
// ... stack imports ...

const app = new App();
// ... instantiate stacks ...

// Apply cdk-nag at app level — every stack + resource gets checked
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
```

**Why this works**:
- Single point of cdk-nag configuration; impossible to forget on individual stacks
- The aspect traverses the entire construct tree at `cdk synth` time
- `verbose: true` makes violations show resource paths for easy diagnosis
- New stacks added later are automatically covered

**Enforcement**:
- The `cdk-nag` CI job (Pattern P-4-6) runs `cdk synth` which triggers the aspect
- Any non-suppressed violation fails the synth → fails the CI job → blocks the PR

---

## Pattern Summary Table

| # | Pattern | Satisfies | Enforcement |
|---|---|---|---|
| P-4-1 | `synthAndAssertSnapshot` test helper | Q3=A snapshot + targeted assertions | `_test-helpers.ts` referenced by all stack tests; code review |
| P-4-2 | Co-located cdk-nag suppressions | SECURITY-06, SECURITY-13 | `NagSuppressions.addResourceSuppressions` adjacent to construct |
| P-4-3 | Explicit env switch + throw | SECURITY-15, NFR-6 | `loadEnvConfig` switch with throw; unit test for unknown env |
| P-4-4 | Adjacent tests under `infra/lib/` | Convention | Vitest config + ESLint config |
| P-4-5 | OIDC role + env-conditioned trust | SECURITY-06, SECURITY-13 | IAM trust policy doc; reviewed at AWS account setup |
| P-4-6 | Hierarchical CI job graph | NFR Reqs Q6=A | GitHub Actions `needs:` directives |
| P-4-7 | cdk-nag aspect at app level | SECURITY-06, SECURITY-13 | `Aspects.of(app).add()` in entry point; CI synth check |
