import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import type { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as logs from "aws-cdk-lib/aws-logs";
import * as xray from "aws-cdk-lib/aws-xray";
import { NagSuppressions } from "cdk-nag";
import type { EnvConfig } from "../config/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface LambdaStackProps extends cdk.StackProps {
  readonly envConfig: EnvConfig;
  readonly contentHashTable: dynamodb.ITable;
  readonly workspaceConfigTable: dynamodb.ITable;
}

export class ClassificationLambdaStack extends cdk.Stack {
  readonly fn: lambda.IFunction;
  readonly alias: lambda.IAlias;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, {
      ...props,
      terminationProtection: props.envConfig.envName === "prod",
    });

    const { envConfig, contentHashTable, workspaceConfigTable } = props;

    const logRetention = mapLogRetention(envConfig.logRetentionDays);

    const fn = new lambdaNodejs.NodejsFunction(this, "ClassificationFunction", {
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
        format: lambdaNodejs.OutputFormat.ESM,
        mainFields: ["module", "main"],
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
        STATE_MACHINE_ARN: envConfig.stateMachineArn,
      },
      logRetention,
      insightsVersion: envConfig.lambdaInsightsEnabled
        ? lambda.LambdaInsightsVersion.VERSION_1_0_229_0
        : undefined,
    });

    // IAM policy — 4 inline statements (per U-3 IaD §2.4)
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ContentHashesReadWrite",
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
        resources: [contentHashTable.tableArn],
      }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "WorkspaceConfigReadOnly",
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:GetItem"],
        resources: [workspaceConfigTable.tableArn],
      }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "S3DocumentRead",
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetObject"],
        resources: [`${envConfig.documentBucketArn}/*`],
      }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "StepFunctionSignal",
        effect: iam.Effect.ALLOW,
        actions: ["states:SendTaskSuccess", "states:SendTaskFailure"],
        resources: [envConfig.stateMachineArn],
      }),
    );

    // X-Ray sampling rule (per U-3 IaD §2.6)
    new xray.CfnSamplingRule(this, "Sampling", {
      samplingRule: {
        ruleName: `classification-service-${envConfig.envName}`,
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
    NagSuppressions.addResourceSuppressions(
      fn.role!,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "AWSLambdaBasicExecutionRole and AWSXRayDaemonWriteAccess are AWS-recommended managed " +
            "policies for Lambda logging + X-Ray; using them is more reliable than re-deriving " +
            "every action. Per U-3 IaD §6.",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
            "Policy::arn:<AWS::Partition>:iam::aws:policy/AWSXRayDaemonWriteAccess",
            "Policy::arn:<AWS::Partition>:iam::aws:policy/CloudWatchLambdaInsightsExecutionRolePolicy",
          ],
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "S3 GetObject on bucket/* is the canonical wildcard pattern for object-level access — " +
            "not a security violation. Per U-3 IaD §6.",
          // cdk-nag in aws-cdk-lib ≥ 2.176 resolves intrinsic refs in the
          // finding key; match both the tokenized placeholder (when present)
          // and the resolved ARN per env.
          appliesTo: [
            "Resource::<<DocumentBucketArn>>/*",
            `Resource::${envConfig.documentBucketArn}/*`,
          ],
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(fn, [
      {
        id: "AwsSolutions-L1",
        reason: "nodejs20.x is current at planning time.",
      },
    ]);

    // Suppressions for CDK's auto-generated LogRetention helper Lambda.
    // The `logRetention` prop on NodejsFunction installs a custom resource
    // (a small AWS-managed Lambda) that sets the CloudWatch log group's
    // retention. We don't own this helper; its IAM4/IAM5 findings are
    // accepted per the same rationale as the main function's suppressions.
    NagSuppressions.addStackSuppressions(this, [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "LogRetention is an internal CDK-managed custom resource that uses " +
          "AWSLambdaBasicExecutionRole. We don't control its role policy.",
        appliesTo: [
          "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
        ],
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "The LogRetention helper Lambda's role needs logs:* on * to manage " +
          "CloudWatch log group retention for any function. Internal to CDK; " +
          "we don't author it.",
        appliesTo: ["Resource::*"],
      },
    ]);

    // Component tag
    cdk.Tags.of(this).add("Component", "lambda");

    this.fn = fn;
    this.alias = alias;

    new cdk.CfnOutput(this, "FunctionName", {
      value: fn.functionName,
      exportName: `ClassificationFunctionName-${envConfig.envName}`,
    });
    new cdk.CfnOutput(this, "AliasArn", {
      value: alias.functionArn,
      exportName: `ClassificationAliasArn-${envConfig.envName}`,
    });
  }
}

function mapLogRetention(days: number): logs.RetentionDays {
  // Map common values to RetentionDays enum
  switch (days) {
    case 1: return logs.RetentionDays.ONE_DAY;
    case 3: return logs.RetentionDays.THREE_DAYS;
    case 5: return logs.RetentionDays.FIVE_DAYS;
    case 7: return logs.RetentionDays.ONE_WEEK;
    case 14: return logs.RetentionDays.TWO_WEEKS;
    case 30: return logs.RetentionDays.ONE_MONTH;
    case 60: return logs.RetentionDays.TWO_MONTHS;
    case 90: return logs.RetentionDays.THREE_MONTHS;
    case 180: return logs.RetentionDays.SIX_MONTHS;
    case 365: return logs.RetentionDays.ONE_YEAR;
    default:
      throw new Error(`Unsupported log retention days: ${days}`);
  }
}
