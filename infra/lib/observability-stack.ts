import * as cdk from "aws-cdk-lib";
import type { Construct } from "constructs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { EnvConfig } from "../config/types.js";

export interface ObservabilityStackProps extends cdk.StackProps {
  readonly envConfig: EnvConfig;
  readonly fn: lambda.IFunction;
  readonly alias: lambda.IAlias;
  readonly contentHashTable: dynamodb.ITable;
  readonly workspaceConfigTable: dynamodb.ITable;
}

export class ClassificationObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, {
      ...props,
      terminationProtection: props.envConfig.envName === "prod",
    });

    const { envConfig, fn, contentHashTable } = props;
    const env = envConfig.envName;

    // Resolve SNS topic ARN from SSM Parameter Store (Pattern P-2-2 of U-2 NFR Design Q3=A).
    // First-time synth returns a `dummy-value-for-...` placeholder before
    // the SSM cache is populated by `cdk synth` against the live account.
    // aws-cdk-lib ≥ 2.176 validates ARNs in `Topic.fromTopicArn` and rejects
    // the dummy; substitute a syntactically valid placeholder so first
    // synth succeeds. After the operator pre-populates SSM (see operator
    // hand-off §7.3), the real ARN flows through unchanged.
    const lookup = ssm.StringParameter.valueFromLookup(this, envConfig.alarmsSnsTopicSsmPath);
    const snsTopicArn = lookup.startsWith("dummy-value-for-")
      ? `arn:aws:sns:${envConfig.region}:${envConfig.account}:classification-alarms-${env}`
      : lookup;
    const snsTopic = sns.Topic.fromTopicArn(this, "AlarmsTopic", snsTopicArn);
    const snsAction = new cwActions.SnsAction(snsTopic);

    // ---- DDB alarms (4) — per U-2 IaD §6 ----

    new cloudwatch.Alarm(this, "ContentHashesThrottledRequests", {
      alarmName: `content-hashes-throttled-requests-${env}`,
      metric: contentHashTable.metricThrottledRequestsForOperations({
        operations: [
          dynamodb.Operation.GET_ITEM,
          dynamodb.Operation.PUT_ITEM,
          dynamodb.Operation.UPDATE_ITEM,
        ],
        statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.seconds(60),
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 5,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(snsAction);

    new cloudwatch.Alarm(this, "ContentHashesSystemErrors", {
      alarmName: `content-hashes-system-errors-${env}`,
      metric: contentHashTable.metricSystemErrorsForOperations({
        operations: [
          dynamodb.Operation.GET_ITEM,
          dynamodb.Operation.PUT_ITEM,
          dynamodb.Operation.UPDATE_ITEM,
        ],
        statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.seconds(60),
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 5,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(snsAction);

    new cloudwatch.Alarm(this, "ContentHashesUserErrors", {
      alarmName: `content-hashes-user-errors-${env}`,
      metric: contentHashTable.metricUserErrors({
        statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.seconds(60),
      }),
      threshold: 100,   // adjust per traffic; placeholder = 100 errors per 60s
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 15,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(snsAction);

    new cloudwatch.Alarm(this, "WorkspaceConfigNotFound", {
      alarmName: `workspace-config-not-found-${env}`,
      metric: new cloudwatch.Metric({
        namespace: "ClassificationService",
        metricName: "WorkspaceConfigStore.NotFound.Count",
        statistic: cloudwatch.Stats.SUM,
        period: cdk.Duration.seconds(300),
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(snsAction);

    // ---- Lambda alarms (6) — per U-3 IaD §3 ----

    new cloudwatch.Alarm(this, "LambdaDurationP99SmallDocs", {
      alarmName: `lambda-duration-p99-small-docs-${env}`,
      metric: new cloudwatch.Metric({
        namespace: "ClassificationService",
        metricName: "LambdaDuration",
        statistic: "p99",
        period: cdk.Duration.seconds(60),
        dimensionsMap: { sizeClass: "small" },
      }),
      threshold: 3000,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 5,
    }).addAlarmAction(snsAction);

    new cloudwatch.Alarm(this, "LambdaDurationP99LargeDocs", {
      alarmName: `lambda-duration-p99-large-docs-${env}`,
      metric: new cloudwatch.Metric({
        namespace: "ClassificationService",
        metricName: "LambdaDuration",
        statistic: "p99",
        period: cdk.Duration.seconds(60),
        dimensionsMap: { sizeClass: "large" },
      }),
      threshold: 15000,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 5,
    }).addAlarmAction(snsAction);

    new cloudwatch.Alarm(this, "LambdaErrors", {
      alarmName: `lambda-errors-${env}`,
      metric: fn.metricErrors({ statistic: cloudwatch.Stats.SUM, period: cdk.Duration.seconds(60) }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 5,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(snsAction);

    new cloudwatch.Alarm(this, "LambdaThrottles", {
      alarmName: `lambda-throttles-${env}`,
      metric: fn.metricThrottles({ statistic: cloudwatch.Stats.SUM, period: cdk.Duration.seconds(60) }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 5,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(snsAction);

    if (envConfig.reservedConcurrentExecutions !== undefined) {
      new cloudwatch.Alarm(this, "LambdaConcurrentExecutionsNearCap", {
        alarmName: `lambda-concurrent-executions-near-cap-${env}`,
        metric: new cloudwatch.Metric({
          namespace: "AWS/Lambda",
          metricName: "ConcurrentExecutions",
          statistic: cloudwatch.Stats.MAXIMUM,
          period: cdk.Duration.seconds(60),
          dimensionsMap: { FunctionName: fn.functionName },
        }),
        threshold: Math.floor(envConfig.reservedConcurrentExecutions * 0.8),
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 3,
      }).addAlarmAction(snsAction);
    }

    new cloudwatch.Alarm(this, "LambdaColdStartP99Regression", {
      alarmName: `lambda-cold-start-p99-regression-${env}`,
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

    // ---- CloudWatch Dashboard (US-SRE-003) ----

    new cloudwatch.Dashboard(this, "ClassificationDashboard", {
      dashboardName: `classification-service-${env}`,
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
            left: [fn.metricInvocations({ statistic: cloudwatch.Stats.SUM })],
            right: [fn.metricErrors({ statistic: cloudwatch.Stats.SUM })],
            width: 12,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: "Classifications by Category",
            left: [
              new cloudwatch.Metric({
                namespace: "ClassificationService",
                metricName: "ClassificationOk",
                statistic: cloudwatch.Stats.SUM,
                period: cdk.Duration.seconds(300),
              }),
            ],
            width: 24,
          }),
        ],
      ],
    });

    cdk.Tags.of(this).add("Component", "observability");
  }
}
