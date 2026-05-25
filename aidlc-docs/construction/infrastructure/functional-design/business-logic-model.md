# Business Logic Model — U-4 `infrastructure`

> Per-stack constructor specifications. Each stack reads from U-2's or U-3's `infrastructure-design.md` and translates those decisions into CDK L2 construct calls.

---

## 1. `ClassificationDataStack` Constructor

**Purpose**: Provisions the two DynamoDB tables per U-2 IaD §2 + §3.

**Algorithm** (TypeScript-flavoured pseudocode):

```typescript
constructor(scope: Construct, id: string, props: DataStackProps) {
  super(scope, id, props);

  // Per U-2 IaD §2 (content-hashes)
  const contentHashTable = new dynamodb.Table(this, "ContentHashes", {
    tableName: `content-hashes${props.envConfig.envName === "prod" ? "" : `-${props.envConfig.envName}`}`,
    partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
    sortKey: { name: "contentHash", type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    encryption: dynamodb.TableEncryption.AWS_MANAGED,
    pointInTimeRecovery: props.envConfig.pitrEnabledContentHashes,
    timeToLiveAttribute: "expiresAt",
    deletionProtection: props.envConfig.deletionProtectionEnabled,
    removalPolicy: props.envConfig.envName === "prod"
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY,
    contributorInsightsEnabled: true,
  });

  // Per U-2 IaD §3 (workspace-config)
  const workspaceConfigTable = new dynamodb.Table(this, "WorkspaceConfig", {
    tableName: `workspace-config${props.envConfig.envName === "prod" ? "" : `-${props.envConfig.envName}`}`,
    partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    encryption: dynamodb.TableEncryption.AWS_MANAGED,
    pointInTimeRecovery: false,
    deletionProtection: props.envConfig.deletionProtectionEnabled,
    removalPolicy: props.envConfig.envName === "prod"
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY,
    contributorInsightsEnabled: true,
  });

  // Apply cdk-nag suppression for the AwsSolutions-DDB3 rule (PITR) on workspace-config
  NagSuppressions.addResourceSuppressions(workspaceConfigTable, [
    {
      id: "AwsSolutions-DDB3",
      reason: "Workspace config is small (~hundreds of rows) and source-of-truth managed externally; PITR overhead not justified. Per U-2 IaD Q2=A.",
    },
  ]);

  this.contentHashTable = contentHashTable;
  this.workspaceConfigTable = workspaceConfigTable;
}
```

---

## 2. `ClassificationLambdaStack` Constructor

**Purpose**: Provisions the Lambda function with full IAM + env vars per U-3 IaD §2.

**Algorithm**:

```typescript
constructor(scope: Construct, id: string, props: LambdaStackProps) {
  super(scope, id, props);

  const { envConfig, contentHashTable, workspaceConfigTable } = props;

  // Resolve upstream cross-stack imports
  const stateMachineArn = envConfig.stateMachineArn;
  const documentBucketArn = envConfig.documentBucketArn;

  const fn = new lambda_nodejs.NodejsFunction(this, "ClassificationFunction", {
    functionName: `classification-service-${envConfig.envName}`,
    runtime: lambda.Runtime.NODEJS_20_X,
    architecture: lambda.Architecture.ARM_64,
    memorySize: 512,
    timeout: cdk.Duration.seconds(30),
    reservedConcurrentExecutions: envConfig.reservedConcurrentExecutions,
    tracing: lambda.Tracing.ACTIVE,
    entry: path.join(__dirname, "../../src/handler/lambda.ts"),
    handler: "handler",
    bundling: {
      target: "node20",
      minify: true,
      sourceMap: true,
      externalModules: ["@aws-sdk/*"],
      format: lambda_nodejs.OutputFormat.ESM,
    },
    environment: {
      LOG_LEVEL: envConfig.logLevel,
      POWERTOOLS_SERVICE_NAME: "classification-service",
      POWERTOOLS_METRICS_NAMESPACE: "ClassificationService",
      POWERTOOLS_LOGGER_LOG_EVENT: "false",
      POWERTOOLS_DEV: envConfig.powertoolsDev ? "true" : "false",
      POWERTOOLS_LOGGER_SAMPLE_RATE: envConfig.powertoolsLoggerSampleRate.toString(),
      CONTENT_HASH_TABLE_NAME: contentHashTable.tableName,
      WORKSPACE_CONFIG_TABLE_NAME: workspaceConfigTable.tableName,
      STATE_MACHINE_ARN: stateMachineArn,
    },
    logRetention: logs.RetentionDays.of(envConfig.logRetentionDays),
    insightsVersion: envConfig.lambdaInsightsEnabled
      ? lambda.LambdaInsightsVersion.VERSION_1_0_229_0
      : undefined,
  });

  // IAM policy (per U-3 IaD §2.4)
  fn.addToRolePolicy(new iam.PolicyStatement({
    sid: "ContentHashesReadWrite",
    effect: iam.Effect.ALLOW,
    actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
    resources: [contentHashTable.tableArn],
  }));
  fn.addToRolePolicy(new iam.PolicyStatement({
    sid: "WorkspaceConfigReadOnly",
    effect: iam.Effect.ALLOW,
    actions: ["dynamodb:GetItem"],
    resources: [workspaceConfigTable.tableArn],
  }));
  fn.addToRolePolicy(new iam.PolicyStatement({
    sid: "S3DocumentRead",
    effect: iam.Effect.ALLOW,
    actions: ["s3:GetObject"],
    resources: [`${documentBucketArn}/*`],
  }));
  fn.addToRolePolicy(new iam.PolicyStatement({
    sid: "StepFunctionSignal",
    effect: iam.Effect.ALLOW,
    actions: ["states:SendTaskSuccess", "states:SendTaskFailure"],
    resources: [stateMachineArn],
  }));

  // X-Ray sampling rule (per U-3 IaD §2.6)
  new xray.CfnSamplingRule(this, "Sampling", {
    samplingRule: {
      ruleName: "classification-service-default",
      resourceArn: "*",
      serviceName: "classification-service",
      serviceType: "AWS::Lambda::Function",
      httpMethod: "*",
      urlPath: "*",
      host: "*",
      priority: 1000,
      reservoirSize: envConfig.xraySamplingReservoirSize,
      fixedRate: envConfig.xraySamplingFixedRate,
      version: 1,
    },
  });

  // Live alias (per U-3 IaD §2.5)
  const alias = fn.currentVersion.addAlias("live");

  // cdk-nag suppressions (per U-3 IaD §6)
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

  this.fn = fn;
  this.alias = alias;
}
```

---

## 3. `ClassificationObservabilityStack` Constructor

**Purpose**: Defines 10 alarms total (4 DDB from U-2 IaD §6, 6 Lambda from U-3 IaD §3) + CloudWatch dashboard.

**Algorithm**:

```typescript
constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
  super(scope, id, props);

  const { envConfig, fn, alias, contentHashTable, workspaceConfigTable } = props;

  // Resolve the alarms SNS topic from SSM
  const snsTopicArn = ssm.StringParameter.valueFromLookup(this, envConfig.alarmsSnsTopicSsmPath);
  const snsTopic = sns.Topic.fromTopicArn(this, "AlarmsTopic", snsTopicArn);
  const snsAction = new cloudwatch_actions.SnsAction(snsTopic);

  // --- U-2 IaD §6 — DDB alarms (4) ---

  new cloudwatch.Alarm(this, "ContentHashesThrottledRequests", {
    alarmName: `content-hashes-throttled-requests-${envConfig.envName}`,
    metric: contentHashTable.metricThrottledRequests({ statistic: "Sum", period: cdk.Duration.seconds(60) }),
    threshold: 0,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 5,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(snsAction);

  new cloudwatch.Alarm(this, "ContentHashesSystemErrors", {
    alarmName: `content-hashes-system-errors-${envConfig.envName}`,
    metric: contentHashTable.metricSystemErrorsForOperations({
      statistic: "Sum",
      period: cdk.Duration.seconds(60),
    }),
    threshold: 0,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 5,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(snsAction);

  new cloudwatch.Alarm(this, "ContentHashesUserErrors", {
    alarmName: `content-hashes-user-errors-${envConfig.envName}`,
    metric: contentHashTable.metricUserErrors({ statistic: "Sum", period: cdk.Duration.seconds(60) }),
    threshold: 0.01,   // 1%
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 15,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(snsAction);

  new cloudwatch.Alarm(this, "WorkspaceConfigNotFound", {
    alarmName: `workspace-config-not-found-${envConfig.envName}`,
    metric: new cloudwatch.Metric({
      namespace: "ClassificationService",
      metricName: "WorkspaceConfigStore.NotFound.Count",
      statistic: "Sum",
      period: cdk.Duration.seconds(300),
    }),
    threshold: 0,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(snsAction);

  // --- U-3 IaD §3 — Lambda alarms (6) ---

  new cloudwatch.Alarm(this, "LambdaDurationP99SmallDocs", {
    alarmName: `lambda-duration-p99-small-docs-${envConfig.envName}`,
    metric: new cloudwatch.Metric({
      namespace: "ClassificationService",
      metricName: "LambdaDuration",
      statistic: "p99",
      period: cdk.Duration.seconds(60),
      dimensionsMap: { sizeClass: "small" },
    }),
    threshold: 3000,    // 3 seconds
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 5,
  }).addAlarmAction(snsAction);

  new cloudwatch.Alarm(this, "LambdaDurationP99LargeDocs", {
    alarmName: `lambda-duration-p99-large-docs-${envConfig.envName}`,
    metric: new cloudwatch.Metric({
      namespace: "ClassificationService",
      metricName: "LambdaDuration",
      statistic: "p99",
      period: cdk.Duration.seconds(60),
      dimensionsMap: { sizeClass: "large" },
    }),
    threshold: 15000,   // 15 seconds
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 5,
  }).addAlarmAction(snsAction);

  new cloudwatch.Alarm(this, "LambdaErrors", {
    alarmName: `lambda-errors-${envConfig.envName}`,
    metric: fn.metricErrors({ statistic: "Sum", period: cdk.Duration.seconds(60) }),
    threshold: 0,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 5,
  }).addAlarmAction(snsAction);

  new cloudwatch.Alarm(this, "LambdaThrottles", {
    alarmName: `lambda-throttles-${envConfig.envName}`,
    metric: fn.metricThrottles({ statistic: "Sum", period: cdk.Duration.seconds(60) }),
    threshold: 0,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 5,
  }).addAlarmAction(snsAction);

  if (envConfig.reservedConcurrentExecutions !== undefined) {
    new cloudwatch.Alarm(this, "LambdaConcurrentExecutionsNearCap", {
      alarmName: `lambda-concurrent-executions-near-cap-${envConfig.envName}`,
      metric: new cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName: "ConcurrentExecutions",
        statistic: "Maximum",
        period: cdk.Duration.seconds(60),
        dimensionsMap: { FunctionName: fn.functionName },
      }),
      threshold: envConfig.reservedConcurrentExecutions * 0.8,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
    }).addAlarmAction(snsAction);
  }

  new cloudwatch.Alarm(this, "LambdaColdStartP99Regression", {
    alarmName: `lambda-cold-start-p99-regression-${envConfig.envName}`,
    metric: new cloudwatch.Metric({
      namespace: "ClassificationService",
      metricName: "LambdaInitDuration",
      statistic: "p99",
      period: cdk.Duration.seconds(300),
    }),
    threshold: 3000,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 12,
  }).addAlarmAction(snsAction);

  // --- CloudWatch Dashboard (per US-SRE-003) ---

  new cloudwatch.Dashboard(this, "ClassificationDashboard", {
    dashboardName: `classification-service-${envConfig.envName}`,
    widgets: [
      [
        new cloudwatch.GraphWidget({
          title: "Lambda Duration p50/p99",
          left: [
            fn.metricDuration({ statistic: "p50" }),
            fn.metricDuration({ statistic: "p99" }),
          ],
          width: 12,
        }),
        new cloudwatch.GraphWidget({
          title: "Lambda Invocations + Errors",
          left: [fn.metricInvocations({ statistic: "Sum" })],
          right: [fn.metricErrors({ statistic: "Sum" })],
          width: 12,
        }),
      ],
      // …additional widgets for category breakdown, detectionTier, DDB metrics
    ],
  });
}
```

---

## 4. CDK App Entry-Point

(Concrete contract already shown in `domain-entities.md` §5.)

---

## 5. Test File Structure

```typescript
// infra/lib/data-stack.test.ts (illustrative)
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, it, expect } from "vitest";
import { ClassificationDataStack } from "./data-stack.js";
import devConfig from "../config/dev.js";

describe("ClassificationDataStack", () => {
  const app = new App();
  const stack = new ClassificationDataStack(app, "Test", { envConfig: devConfig });
  const template = Template.fromStack(stack);

  it("creates exactly 2 DDB tables", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 2);
  });

  it("content-hashes table uses PAY_PER_REQUEST + AWS_MANAGED encryption", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: Match.arrayWith([
        Match.objectLike({ AttributeName: "workspaceId", KeyType: "HASH" }),
        Match.objectLike({ AttributeName: "contentHash", KeyType: "RANGE" }),
      ]),
      BillingMode: "PAY_PER_REQUEST",
      SSESpecification: Match.objectLike({ SSEEnabled: true }),
      TimeToLiveSpecification: Match.objectLike({ AttributeName: "expiresAt", Enabled: true }),
    });
  });

  it("matches the committed snapshot", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
```

Similar test files for `lambda-stack.test.ts` and `observability-stack.test.ts`.

---

## 6. Module Composition Diagram

```
       infra/bin/app.ts (entry-point)
          │
          ├── infra/config/load.ts ─── dev.ts / staging.ts / prod.ts
          │
          ▼
       App
       │
       ├── ClassificationDataStack
       │     │
       │     ├── DDB Table: content-hashes
       │     └── DDB Table: workspace-config
       │
       ├── ClassificationLambdaStack
       │     │
       │     ├── NodejsFunction
       │     ├── IAM Role + 4 inline policies + 2 managed
       │     ├── X-Ray sampling rule
       │     └── `live` alias
       │
       └── ClassificationObservabilityStack
             │
             ├── 4 DDB alarms
             ├── 6 Lambda alarms
             └── CloudWatch Dashboard
       │
       ▼
       cdk.Aspects.of(app).add(new AwsSolutionsChecks())
```

All `Construct`s are typed L2 (Q2=A); the only L1 use is `xray.CfnSamplingRule` (no L2 exists yet for sampling rules in `aws-cdk-lib`).
