# Tech Stack Decisions — U-3 `handler`

> New runtime + dev dependencies + Powertools env config + Lambda function configuration introduced by U-3. Inherits everything from U-1 and U-2 tech-stack docs.

---

## 1. Service-Level Decisions Inherited

| Concern | Choice | Source |
|---|---|---|
| Runtime | Node.js 20.x LTS | U-1 |
| Language | TypeScript strict-plus | U-1 |
| Test framework | Vitest | U-1 |
| PBT framework | fast-check | U-1 |
| Schema validation | Zod | Application Design Q4=A (used here for the first time) |
| DynamoDB client | AWS SDK v3 DocumentClient | Application Design Q5=A |
| Observability | AWS Lambda Powertools (Logger + Metrics + Tracer) | Application Design Q6=A |
| AWS SDK retry mode | `standard`, `maxAttempts: 3` | U-2 NFR Reqs §2.3 |
| Project layout | Single `package.json` | U-1 |

---

## 2. U-3 Runtime Dependencies (exact pins for SDK; caret for Powertools per Q4=A)

Added to `package.json` `dependencies`.

| Package | Version | Pin Strategy | Rationale |
|---|---|---|---|
| `@aws-sdk/client-s3` | `3.654.0` | **Exact** | Matches the SDK major version from U-2. Behaviour-sensitive (retry defaults, header changes can shift between minors). |
| `@aws-sdk/client-sfn` | `3.654.0` | **Exact** | Same major version family as the other SDK clients. |
| `zod` | `3.23.8` | **Exact** | Schema-validation library. Pinning prevents subtle behaviour changes in error messages or default coercion. Used by `InputValidator` (the SECURITY-05 entry point). |
| `@aws-lambda-powertools/logger` | `^2.10.0` | Caret | Patch-level updates safe; we want bug fixes. |
| `@aws-lambda-powertools/metrics` | `^2.10.0` | Caret | Same major version family as Logger. |
| `@aws-lambda-powertools/tracer` | `^2.10.0` | Caret | Same major version family. |

**Total new runtime dependencies for U-3**: 6 packages.

---

## 3. U-3 Dev Dependencies (caret pins)

| Package | Version | Pin Strategy | Rationale |
|---|---|---|---|
| `@types/aws-lambda` | `^8.10.142` | Caret | Type definitions only; never affects runtime |

---

## 4. Powertools Runtime Configuration (Lambda env vars)

Per Q5=A — locked production defaults:

```yaml
# In U-4's CDK Lambda function construct (illustrative):
environment:
  LOG_LEVEL: INFO
  POWERTOOLS_SERVICE_NAME: classification-service
  POWERTOOLS_METRICS_NAMESPACE: ClassificationService
  POWERTOOLS_LOGGER_LOG_EVENT: "false"     # critical for SECURITY-03
  POWERTOOLS_DEV: "false"                   # production = structured JSON
  POWERTOOLS_LOGGER_SAMPLE_RATE: "0.01"     # 1% INFO debug-enriched
  # Inherited from U-2's CDK Lambda construct:
  CONTENT_HASH_TABLE_NAME: ...               # set by CDK at deploy time
  WORKSPACE_CONFIG_TABLE_NAME: ...
  STATE_MACHINE_ARN: ...                     # for SendTaskSuccess/Failure
  DOCUMENT_BUCKET_NAME: ...                  # default bucket; payload's s3.bucket overrides
```

Per-environment overrides (set in U-4's CDK per-env config):

| Env Var | dev | staging | prod |
|---|---|---|---|
| `LOG_LEVEL` | `DEBUG` | `INFO` | `INFO` |
| `POWERTOOLS_DEV` | `true` (pretty-print local) | `false` | `false` |
| `POWERTOOLS_LOGGER_SAMPLE_RATE` | `1.0` (debug everything) | `0.1` | `0.01` |

---

## 5. Lambda Function Configuration (Q1=A + Q2=A)

For U-4's CDK Lambda construct to materialise:

```typescript
new NodejsFunction(this, "ClassificationFunction", {
  runtime: Runtime.NODEJS_20_X,
  architecture: Architecture.ARM_64,
  memorySize: 512,                 // Q1=A
  timeout: Duration.seconds(30),   // Q1=A
  reservedConcurrentExecutions: isProd ? 100 : undefined,  // Q2=A
  
  entry: "src/handler/lambda.ts",
  handler: "handler",
  
  bundling: {
    target: "node20",
    minify: true,
    sourceMap: true,
    externalModules: ["@aws-sdk/*"],   // provided by Lambda runtime
    format: OutputFormat.ESM,
  },
  
  environment: {
    LOG_LEVEL: envConfig.logLevel,
    POWERTOOLS_SERVICE_NAME: "classification-service",
    POWERTOOLS_METRICS_NAMESPACE: "ClassificationService",
    POWERTOOLS_LOGGER_LOG_EVENT: "false",
    POWERTOOLS_DEV: envConfig.dev ? "true" : "false",
    POWERTOOLS_LOGGER_SAMPLE_RATE: envConfig.sampleRate,
    CONTENT_HASH_TABLE_NAME: contentHashTable.tableName,
    WORKSPACE_CONFIG_TABLE_NAME: workspaceConfigTable.tableName,
    STATE_MACHINE_ARN: stateMachineArn,
  },
  
  tracing: Tracing.ACTIVE,          // X-Ray
});
```

---

## 6. IAM Policy (Q7=A — exact restatement of NFR Requirements §2.5)

For U-4's CDK Lambda construct:

```typescript
// Custom inline policy
fn.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
  resources: [contentHashTable.tableArn],
}));
fn.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ["dynamodb:GetItem"],
  resources: [workspaceConfigTable.tableArn],
}));
fn.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ["s3:GetObject"],
  resources: [`${documentBucket.bucketArn}/*`],
}));
fn.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ["states:SendTaskSuccess", "states:SendTaskFailure"],
  resources: [stateMachineArn],
}));

// AWS-managed policies (with documented `cdk-nag` suppressions)
fn.role!.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));
fn.role!.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("AWSXRayDaemonWriteAccess"));

// cdk-nag suppression
NagSuppressions.addResourceSuppressions(fn.role!, [
  { id: "AwsSolutions-IAM4", reason: "AWSLambdaBasicExecutionRole and AWSXRayDaemonWriteAccess are AWS-recommended managed policies for Lambda logging + X-Ray; using them is more reliable than re-deriving every action." },
]);
```

---

## 7. Vitest Coverage Threshold Updates

Append to existing `vitest.config.ts` `coverage.thresholds` map:

```typescript
thresholds: {
  // existing U-1 + U-2 thresholds preserved
  
  // NEW U-3 thresholds (Q6=A)
  "src/application/**":                  { branches: 75, functions: 75, lines: 75, statements: 75 },
  "src/handler/**":                      { branches: 75, functions: 75, lines: 75, statements: 75 },
  "src/adapters/s3/**":                  { branches: 80, functions: 80, lines: 80, statements: 80 },
  "src/adapters/crypto/**":              { branches: 95, functions: 95, lines: 95, statements: 95 },
  "src/adapters/step-functions/**":      { branches: 80, functions: 80, lines: 80, statements: 80 },
  "src/adapters/powertools/**":          { branches: 75, functions: 75, lines: 75, statements: 75 },
}
```

---

## 8. Package.json Excerpt (after U-3 Code Generation)

```jsonc
{
  "dependencies": {
    // existing
    "file-type": "21.0.0",
    "@aws-sdk/client-dynamodb": "3.654.0",
    "@aws-sdk/lib-dynamodb": "3.654.0",
    // NEW U-3
    "@aws-sdk/client-s3": "3.654.0",
    "@aws-sdk/client-sfn": "3.654.0",
    "zod": "3.23.8",
    "@aws-lambda-powertools/logger": "^2.10.0",
    "@aws-lambda-powertools/metrics": "^2.10.0",
    "@aws-lambda-powertools/tracer": "^2.10.0"
  },
  "devDependencies": {
    // existing
    "@types/node": "^20.14.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "@vitest/coverage-v8": "^1.6.0",
    "eslint": "^8.57.0",
    "eslint-plugin-boundaries": "^4.2.0",
    "fast-check": "^3.19.0",
    "testcontainers": "^10.13.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    // NEW U-3
    "@types/aws-lambda": "^8.10.142"
  }
}
```

---

## 9. Supply Chain Hygiene (SECURITY-10)

| Practice | Configuration |
|---|---|
| Lockfile committed | `package-lock.json` |
| Exact-pinned AWS SDK | All `@aws-sdk/*` packages exact-pinned at `3.654.0` |
| Exact-pinned Zod | `3.23.8` |
| Caret-pinned Powertools (patch-safe) | `^2.10.0` |
| Vulnerability scan | `npm audit --omit=dev --audit-level=high` (existing CI gate) |
| SBOM | `npm sbom` (existing) |
| Bundle smoke check | Validates the deployed artifact loads and exports `handler` + size ≤ 5 MB |

---

## 10. Open Items for Subsequent Stages

| Item | Stage |
|---|---|
| Final `vitest.config.ts` merging all three units' thresholds | NFR Design |
| SAM `template.yaml` for the smoke test | NFR Design |
| Bundle smoke check `scripts/verify-bundle.sh` | Code Generation |
| Per-environment env-var matrix concrete values | Infrastructure Design (U-4) |
| Lambda alarms (Duration p99 by size class, Throttles, Errors) | Infrastructure Design (U-4) |
| `cdk-nag` suppression code blocks | Infrastructure Design (U-4) |
