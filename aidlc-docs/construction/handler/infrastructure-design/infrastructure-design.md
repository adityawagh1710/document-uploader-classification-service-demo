# Infrastructure Design — U-3 `handler`

> U-3's infrastructure footprint = **one Lambda function + its IAM policy + 5 CloudWatch alarms + X-Ray tracing config**. CDK code lives in U-4's `ClassificationLambdaStack`; this document is the source-of-truth U-4 implements against.

---

## 1. Category Applicability

| Category | U-3 ownership | Notes |
|---|---|---|
| Deployment Environment | Inherited | Service-level (AWS, single-region) |
| **Compute** | **Yes — core** | Lambda function defined by U-3's specifications |
| Storage | N/A | DynamoDB owned by U-2; S3 bucket owned by upstream |
| Messaging | N/A | Step Functions State Machine owned upstream |
| Networking | **Justified deviation** | Lambda outside VPC (inherited from U-1 IaD Q4=B) |
| **Monitoring** | **Yes — partial** | 5 Lambda-level alarms; SNS topic referenced via SSM |
| Shared | Inherited | CI runner from U-1 |

---

## 2. Lambda Function Specification

### 2.1 Runtime Configuration (from NFR Reqs §2.1 + Q1=A + Q5=A)

| Setting | Value | Source |
|---|---|---|
| Runtime | `nodejs20.x` | Application Design Q7=A |
| Architecture | `arm64` | U-1 IaD |
| Memory | 512 MB | NFR Reqs Q1=A |
| Timeout | 30 seconds | NFR Reqs Q1=A |
| Reserved concurrency (prod) | 100 | NFR Reqs Q2=A |
| Reserved concurrency (dev/staging) | unset (unlimited) | NFR Reqs Q2=A |
| Function name pattern | `classification-service-${env}` | convention |
| Alias | `live` pointing to `$LATEST` | Q1=A |
| Tracing | `Tracing.ACTIVE` (X-Ray) | NFR-8 |
| X-Ray sampling rule | `reservoirSize: 1, fixedRate: 0.05` | Q5=A |

### 2.2 Bundling Configuration

(For U-4's CDK `NodejsFunction` construct — already locked in U-1 IaD Q1=A.)

```typescript
bundling: {
  target: "node20",
  minify: true,
  sourceMap: true,
  externalModules: ["@aws-sdk/*"],   // provided by Lambda runtime
  format: OutputFormat.ESM,
}
```

### 2.3 Environment Variables

Resolved at deploy time by CDK. Values come from CDK per-environment config + `Fn.importValue` from upstream stacks.

| Env Var | Source | Production value |
|---|---|---|
| `LOG_LEVEL` | CDK per-env config | `INFO` |
| `POWERTOOLS_SERVICE_NAME` | constant | `classification-service` |
| `POWERTOOLS_METRICS_NAMESPACE` | constant | `ClassificationService` |
| `POWERTOOLS_LOGGER_LOG_EVENT` | constant | `false` |
| `POWERTOOLS_DEV` | CDK per-env config | `false` (prod) / `true` (local) |
| `POWERTOOLS_LOGGER_SAMPLE_RATE` | CDK per-env config | `0.01` |
| `CONTENT_HASH_TABLE_NAME` | `Fn.importValue` from `ClassificationDataStack` | `content-hashes` (resolved) |
| `WORKSPACE_CONFIG_TABLE_NAME` | `Fn.importValue` from `ClassificationDataStack` | `workspace-config` (resolved) |
| `STATE_MACHINE_ARN` | `Fn.importValue` from upstream State Machine stack | `arn:aws:states:...:stateMachine:document-ingestion` |

**Q2=A: Cross-stack imports**

```typescript
// In U-4's ClassificationLambdaStack:
const stateMachineArn = Fn.importValue("DocumentIngestionStateMachineArn");
const contentHashTableName = Fn.importValue("ContentHashTableName");
const workspaceConfigTableName = Fn.importValue("WorkspaceConfigTableName");

new NodejsFunction(this, "ClassificationFunction", {
  // ... runtime config ...
  environment: {
    STATE_MACHINE_ARN: stateMachineArn,
    CONTENT_HASH_TABLE_NAME: contentHashTableName,
    WORKSPACE_CONFIG_TABLE_NAME: workspaceConfigTableName,
    // ... static env vars ...
  },
});
```

The upstream stack must export these values via `CfnOutput` with `exportName`:

```typescript
new CfnOutput(this, "StateMachineArn", {
  value: this.stateMachine.stateMachineArn,
  exportName: "DocumentIngestionStateMachineArn",
});
```

### 2.4 IAM Policy

Per NFR Requirements §2.5 verbatim. Restated for U-4's CDK to implement:

```typescript
// Custom inline policy (4 statements)
const inlinePolicy = new PolicyDocument({
  statements: [
    new PolicyStatement({
      sid: "ContentHashesReadWrite",
      effect: Effect.ALLOW,
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
      resources: [Fn.importValue("ContentHashTableArn")],
    }),
    new PolicyStatement({
      sid: "WorkspaceConfigReadOnly",
      effect: Effect.ALLOW,
      actions: ["dynamodb:GetItem"],
      resources: [Fn.importValue("WorkspaceConfigTableArn")],
    }),
    new PolicyStatement({
      sid: "S3DocumentRead",
      effect: Effect.ALLOW,
      actions: ["s3:GetObject"],
      resources: [`${Fn.importValue("DocumentBucketArn")}/*`],
    }),
    new PolicyStatement({
      sid: "StepFunctionSignal",
      effect: Effect.ALLOW,
      actions: ["states:SendTaskSuccess", "states:SendTaskFailure"],
      resources: [stateMachineArn],
    }),
  ],
});

// Plus 2 AWS-managed policies with cdk-nag suppression
fn.role!.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));
fn.role!.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("AWSXRayDaemonWriteAccess"));

NagSuppressions.addResourceSuppressions(fn.role!, [
  {
    id: "AwsSolutions-IAM4",
    reason: "AWSLambdaBasicExecutionRole and AWSXRayDaemonWriteAccess are AWS-recommended managed policies for Lambda logging + X-Ray; using them is more reliable than re-deriving every action.",
    appliesTo: [
      "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
      "Policy::arn:<AWS::Partition>:iam::aws:policy/AWSXRayDaemonWriteAccess",
    ],
  },
]);
```

cdk-nag rules:
- `AwsSolutions-IAM5` — Pass (no wildcard resources)
- `AwsSolutions-IAM4` — Suppressed with reason above
- `AwsSolutions-L1` — Pass (using latest Node runtime)

### 2.5 Alias Strategy (Q1=A)

```typescript
const alias = fn.currentVersion.addAlias("live");
// All invocations go through the alias; CDK deploys atomically update the alias target.
```

The Step Function's task definition references the alias ARN (`...:function:classification-service-prod:live`) — invocations always hit the current `live` version.

**Rollback procedure**: revert the git commit → `cdk deploy` → the alias atomically swings back to the previous version (Lambda retains prior versions for 90 days by default; can be increased via CDK if needed).

### 2.6 X-Ray Sampling Rule (Q5=A)

```typescript
new CfnSamplingRule(this, "ClassificationServiceSampling", {
  samplingRule: {
    ruleName: "classification-service-default",
    resourceArn: "*",
    serviceName: "classification-service",
    serviceType: "AWS::Lambda::Function",
    httpMethod: "*",
    urlPath: "*",
    host: "*",
    priority: 1000,
    reservoirSize: 1,    // at least 1 trace/sec guaranteed
    fixedRate: 0.05,     // 5% of additional traffic
    version: 1,
  },
});
```

---

## 3. CloudWatch Alarms (Q4=A — 5 alarms)

All 5 alarms publish to a per-environment SNS topic (Q3=A) whose ARN is read from SSM Parameter Store at deploy time.

```typescript
const snsTopicArn = StringParameter.valueFromLookup(
  this,
  `/observability/sns-topic-arn/${envName}`,
);
const snsTopic = Topic.fromTopicArn(this, "AlarmsTopic", snsTopicArn);
```

### 3.1 `lambda-duration-p99-small-docs`

| Property | Value |
|---|---|
| Metric | Custom EMF metric `LambdaDuration` (Dimensions: `sizeClass=small`) |
| Statistic | p99 |
| Period | 60 s |
| Evaluation periods | 5 |
| Threshold | > 3000 ms |
| Severity | Page |
| Suppression | None |

### 3.2 `lambda-duration-p99-large-docs`

| Property | Value |
|---|---|
| Metric | Custom EMF metric `LambdaDuration` (Dimensions: `sizeClass=large`) |
| Statistic | p99 |
| Period | 60 s |
| Evaluation periods | 5 |
| Threshold | > 15000 ms |
| Severity | Page |
| Suppression | None |

### 3.3 `lambda-errors`

| Property | Value |
|---|---|
| Metric | `AWS/Lambda.Errors` (Dimensions: `FunctionName`) |
| Statistic | Sum |
| Period | 60 s |
| Evaluation periods | 5 |
| Threshold | > 0 |
| Severity | Page |

### 3.4 `lambda-throttles`

| Property | Value |
|---|---|
| Metric | `AWS/Lambda.Throttles` |
| Statistic | Sum |
| Period | 60 s |
| Evaluation periods | 5 |
| Threshold | > 0 |
| Severity | Warn (Slack) |

### 3.5 `lambda-concurrent-executions-near-cap`

| Property | Value |
|---|---|
| Metric | `AWS/Lambda.ConcurrentExecutions` |
| Statistic | Max |
| Period | 60 s |
| Evaluation periods | 3 |
| Threshold | > 80 (80% of prod's 100 reserved) |
| Severity | Warn (Slack) |

### 3.6 `lambda-cold-start-p99-regression`

| Property | Value |
|---|---|
| Metric | Custom EMF metric `LambdaInitDuration` (emitted from cold-start INIT_REPORT in CloudWatch Logs Insights) |
| Statistic | p99 |
| Period | 300 s |
| Evaluation periods | 12 (1 hour) |
| Threshold | > 3000 ms |
| Severity | Warn (Slack) |
| Note | Detects bundle bloat or init regression that doesn't yet violate end-to-end latency |

---

## 4. VPC Topology

**Lambda outside VPC** per U-1 IaD Q4=B (inherited).

Rationale: cold-start savings (~1-2s) outweigh the SECURITY-07 ideal of private endpoints for a service that only touches AWS-managed services over the AWS backbone. AWS SDK v3 routes calls via HTTPS over the AWS backbone regardless of VPC attachment.

**Revisit trigger**: if any U-3 dep is later added that requires VPC-private access (RDS, ElastiCache, on-prem), Lambda must enter the VPC and Gateway VPC endpoints for DDB + S3 become mandatory (free; eliminate NAT costs).

---

## 5. SECURITY Compliance at This Stage

| Rule | Status | Notes |
|---|---|---|
| SECURITY-01 (encryption at rest & in transit) | Inherited (U-4) | Lambda env vars encrypted at rest via KMS by default; HTTPS for all SDK calls |
| SECURITY-03 (app-level logging) | Compliant | Powertools Logger with redaction (`LOG_EVENT=false`); CloudWatch Logs retention ≥ 90 days |
| SECURITY-05 (input validation) | Compliant | Zod schema in `InputValidator` |
| SECURITY-06 (least-privilege IAM) | Compliant | §2.4 — per-resource per-action; `cdk-nag` IAM5 passes |
| SECURITY-07 (restrictive network) | Justified deviation | Lambda outside VPC; revisit trigger documented |
| SECURITY-09 (hardening) | Compliant | Generic error messages in SendTaskFailure; no stack traces leak to caller |
| SECURITY-10 (supply chain) | Compliant | All AWS SDK exact-pinned; `aws-actions/setup-sam@v2.0.0` exact-pinned (Q6=A) |
| SECURITY-13 (data integrity) | Compliant | Result-typed plumbing; conditional DDB writes inherited; signed bundle artifact |
| SECURITY-14 (alerting + monitoring) | Compliant | 5 alarms defined; CloudWatch Logs retention from observability stack |
| SECURITY-15 (fail-safe defaults) | Compliant | Global try/catch (Pattern P-3-7); best-effort SendTaskFailure |

**Blocking findings**: none.

---

## 6. cdk-nag Rule Status (for U-4)

| Rule | Status | Action if violated |
|---|---|---|
| `AwsSolutions-IAM4` (no AWS-managed policies) | Suppress with documented reason | 2 suppressions for AWSLambdaBasicExecutionRole + AWSXRayDaemonWriteAccess |
| `AwsSolutions-IAM5` (no wildcard resources) | Pass | (S3 `${bucket}/*` is canonical wildcard pattern for object-level access — not a violation) |
| `AwsSolutions-L1` (latest runtime) | Pass | nodejs20.x is current |
| `AwsSolutions-L2` (Lambda dead-letter queue) | Suppress with documented reason | DLQ not configured because we use Step Function task-retry as the dead-letter mechanism; documented in `cdk-nag` exclusions |

---

## 7. Open Items for U-4

| Item | Where in U-4 |
|---|---|
| `infra/lib/lambda-stack.ts` — full CDK stack for the function + IAM + alarms | U-4 Infrastructure Design + Code Generation |
| `infra/config/{dev,staging,prod}.ts` — per-env config values | U-4 Infrastructure Design |
| `cdk-nag` suppressions concretely written in CDK code | U-4 Code Generation |
| `.github/workflows/ci.yml` with `aws-actions/setup-sam@v2.0.0` step | U-4 Infrastructure Design |
| SNS topic / SSM parameter for the alarm topic (managed by observability stack) | Outside U-3; assumed pre-existing |
