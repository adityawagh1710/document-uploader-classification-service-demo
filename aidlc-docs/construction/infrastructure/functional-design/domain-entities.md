# Domain Entities — U-4 `infrastructure`

> U-4's "entities" are CDK construct classes + per-environment config + cross-stack reference contracts. Most resource specs come verbatim from U-2's and U-3's `infrastructure-design.md` documents.

---

## 1. Entity Index

| Entity | Layer | Owned By | Notes |
|---|---|---|---|
| `ClassificationDataStack` | infrastructure | U-4 | Wraps 2 DDB tables |
| `ClassificationLambdaStack` | infrastructure | U-4 | Wraps Lambda function + IAM |
| `ClassificationObservabilityStack` | infrastructure | U-4 | Wraps 10 alarms + X-Ray sampling rule + dashboard |
| `EnvConfig` (interface) | infrastructure | U-4 | Per-environment configuration shape |
| `CdkApp` (entry point) | infrastructure | U-4 | `infra/bin/app.ts` |
| `DataStackProps`, `LambdaStackProps`, `ObservabilityStackProps` | infrastructure | U-4 | Stack constructor props |

---

## 2. Stack Class Hierarchy

```typescript
// All stacks extend cdk.Stack and live under infra/lib/

export class ClassificationDataStack extends cdk.Stack {
  readonly contentHashTable: dynamodb.ITable;
  readonly workspaceConfigTable: dynamodb.ITable;
}

export class ClassificationLambdaStack extends cdk.Stack {
  readonly fn: lambda.IFunction;
  readonly alias: lambda.IAlias;
}

export class ClassificationObservabilityStack extends cdk.Stack {
  // No public outputs; alarms are side effects on the CloudWatch namespace
}
```

### 2.1 Stack Dependency Graph

```
         ┌──────────────────────────────────┐
         │     ClassificationDataStack      │
         │  - content-hashes table          │
         │  - workspace-config table        │
         └──────────────┬───────────────────┘
                        │ (table ARNs + names)
                        ▼
         ┌──────────────────────────────────┐
         │   ClassificationLambdaStack      │
         │  - NodejsFunction                │
         │  - IAM role + policies           │
         │  - `live` alias                  │
         │  - X-Ray sampling                │
         └──────────────┬───────────────────┘
                        │ (function ARN, table names, function name)
                        ▼
         ┌──────────────────────────────────┐
         │ClassificationObservabilityStack  │
         │  - 4 DDB alarms                  │
         │  - 6 Lambda alarms               │
         │  - X-Ray service map             │
         │  - CloudWatch dashboard          │
         └──────────────────────────────────┘
```

Stack references use **direct construct references** within the same CDK app (typed via `Props`) for stacks deployed together, and `Fn.importValue` for cross-app dependencies (e.g., upstream State Machine, document S3 bucket).

---

## 3. Stack Props Interfaces

### 3.1 `DataStackProps`
```typescript
export interface DataStackProps extends cdk.StackProps {
  readonly envConfig: EnvConfig;
}
```

### 3.2 `LambdaStackProps`
```typescript
export interface LambdaStackProps extends cdk.StackProps {
  readonly envConfig: EnvConfig;
  readonly contentHashTable: dynamodb.ITable;
  readonly workspaceConfigTable: dynamodb.ITable;
}
```

### 3.3 `ObservabilityStackProps`
```typescript
export interface ObservabilityStackProps extends cdk.StackProps {
  readonly envConfig: EnvConfig;
  readonly fn: lambda.IFunction;
  readonly alias: lambda.IAlias;
  readonly contentHashTable: dynamodb.ITable;
  readonly workspaceConfigTable: dynamodb.ITable;
}
```

---

## 4. `EnvConfig` Interface

```typescript
// infra/config/types.ts
export interface EnvConfig {
  readonly envName: "dev" | "staging" | "prod";

  // Region + account
  readonly region: string;
  readonly account: string;

  // DDB
  readonly pitrEnabledContentHashes: boolean;
  readonly deletionProtectionEnabled: boolean;

  // Lambda
  readonly logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
  readonly powertoolsDev: boolean;
  readonly powertoolsLoggerSampleRate: number;   // 0.01 in prod, 1.0 in dev
  readonly reservedConcurrentExecutions: number | undefined;   // undefined = unlimited
  readonly logRetentionDays: number;

  // Cross-stack imports (upstream)
  readonly stateMachineArn: string;
  readonly documentBucketArn: string;

  // X-Ray sampling
  readonly xraySamplingReservoirSize: number;
  readonly xraySamplingFixedRate: number;

  // Observability
  readonly alarmsSnsTopicSsmPath: string;        // e.g., "/observability/sns-topic-arn/${env}"
  readonly lambdaInsightsEnabled: boolean;
}
```

Each per-environment file (`dev.ts`, `staging.ts`, `prod.ts`) exports a concrete `EnvConfig` instance.

---

## 5. CDK App Entry-Point Contract

```typescript
// infra/bin/app.ts
import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";

import { ClassificationDataStack } from "../lib/data-stack.js";
import { ClassificationLambdaStack } from "../lib/lambda-stack.js";
import { ClassificationObservabilityStack } from "../lib/observability-stack.js";
import { loadEnvConfig } from "../config/load.js";

const app = new cdk.App();
const envName = (app.node.tryGetContext("env") ?? process.env.CDK_DEFAULT_ENV ?? "dev") as "dev" | "staging" | "prod";
const envConfig = loadEnvConfig(envName);

const env = { account: envConfig.account, region: envConfig.region };

const data = new ClassificationDataStack(app, `ClassificationData-${envName}`, {
  env,
  envConfig,
});

const lambdaStack = new ClassificationLambdaStack(app, `ClassificationLambda-${envName}`, {
  env,
  envConfig,
  contentHashTable: data.contentHashTable,
  workspaceConfigTable: data.workspaceConfigTable,
});

new ClassificationObservabilityStack(app, `ClassificationObservability-${envName}`, {
  env,
  envConfig,
  fn: lambdaStack.fn,
  alias: lambdaStack.alias,
  contentHashTable: data.contentHashTable,
  workspaceConfigTable: data.workspaceConfigTable,
});

// Apply cdk-nag at the app level (Q5=A)
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
```

---

## 6. Per-Environment Config Files

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
    default: throw new Error(`Unknown environment: ${envName}`);
  }
}
```

```typescript
// infra/config/prod.ts (example)
import type { EnvConfig } from "./types.js";

const config: EnvConfig = {
  envName: "prod",
  region: "us-east-1",
  account: "123456789012",
  pitrEnabledContentHashes: true,
  deletionProtectionEnabled: true,
  logLevel: "INFO",
  powertoolsDev: false,
  powertoolsLoggerSampleRate: 0.01,
  reservedConcurrentExecutions: 100,
  logRetentionDays: 90,
  stateMachineArn: "arn:aws:states:us-east-1:123456789012:stateMachine:document-ingestion",
  documentBucketArn: "arn:aws:s3:::document-bucket-prod",
  xraySamplingReservoirSize: 1,
  xraySamplingFixedRate: 0.05,
  alarmsSnsTopicSsmPath: "/observability/sns-topic-arn/prod",
  lambdaInsightsEnabled: true,
};

export default config;
```

---

## 7. Cross-Stack Reference Contract

| Resource | Provider stack | Consumer stack(s) | Mechanism |
|---|---|---|---|
| `content-hashes` table ARN | `ClassificationDataStack` | `ClassificationLambdaStack`, `ClassificationObservabilityStack` | Direct construct reference (`data.contentHashTable`) via props |
| `workspace-config` table ARN | `ClassificationDataStack` | Same | Same |
| Lambda function + alias | `ClassificationLambdaStack` | `ClassificationObservabilityStack` | Same |
| State Machine ARN | (upstream stack outside this app) | `ClassificationLambdaStack` | `Fn.importValue` |
| Document bucket ARN | (upstream stack outside this app) | `ClassificationLambdaStack` | `Fn.importValue` |
| Alarms SNS topic ARN | (observability stack outside this app) | `ClassificationObservabilityStack` | `StringParameter.valueFromLookup` from SSM |

**Why mix direct refs + Fn.importValue + SSM**:
- Direct refs are typed + checked at synth time; preferred when stacks live in the same app
- `Fn.importValue` is for cross-app dependencies that deploy in separate CDK pipelines
- SSM parameters are for values managed outside CDK (e.g., the alarms SNS topic owned by a central observability team)

---

## 8. Entities Out of Scope for U-4

For clarity, U-4 does NOT define:
- Application code or business logic (U-1/U-2/U-3)
- State Machine itself (upstream)
- Document S3 bucket (upstream — owned by ingestion-orchestrator)
- The SNS topic for alarms (observability team)
- The DDB capacity / TTL / encryption choices (those are in U-2's IaD)
- The Lambda memory / timeout / IAM (those are in U-3's IaD)
- CloudWatch alarm thresholds (those are in U-2's IaD + U-3's IaD)

U-4's role is purely to **translate those decisions into CDK code**.
