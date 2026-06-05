import * as cdk from "aws-cdk-lib";
import type { Construct } from "constructs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { NagSuppressions } from "cdk-nag";
import type { EnvConfig } from "../config/types.js";

export interface ConvertQueueStackProps extends cdk.StackProps {
  readonly envConfig: EnvConfig;
}

/**
 * SQS infra for the auto-convert fan-out (category === "convert" path).
 *
 * Produces a main queue + DLQ pair plus two CloudWatch alarms:
 *
 *   - {name}              main queue (visibility 30 min, retention 14 days)
 *   - {name}-dlq          dead-letter (retention 14 days)
 *   - {name}-dlq-depth    alarm: any message in DLQ → ALARM
 *   - {name}-age          alarm: oldest visible message > 30 min → ALARM
 *
 * The 30-min visibility timeout is sized for the worst-case office-convert
 * conversion (large PPTX / XLSX hitting the 600s chunk_timeout_seconds limit
 * across multiple chunks). maxReceiveCount=3 mirrors the archive fan-out's
 * redrive policy on zip-extraction-dev05.
 *
 * Sibling stack to ClassificationDataStack (data-stack.ts). Lives in its own
 * stack so `make undeploy-all` can teardown queue separately from DDB if the
 * operator wants — and so the convert feature can be conditionally deployed.
 *
 * The worker (feat/04) consumes from the main queue; the classify route
 * (feat/05) produces to it. Stack outputs (ConvertQueueUrl / ConvertQueueArn)
 * are read by both via CloudFormation cross-stack export — same pattern as
 * data-stack's table-name/ARN exports.
 */
export class ClassificationConvertQueueStack extends cdk.Stack {
  readonly convertQueue: sqs.IQueue;
  readonly convertDlq: sqs.IQueue;

  constructor(scope: Construct, id: string, props: ConvertQueueStackProps) {
    super(scope, id, {
      ...props,
      terminationProtection: props.envConfig.envName === "prod",
    });

    const env = props.envConfig.envName;
    const removalPolicy =
      env === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    const queueName =
      env === "prod"
        ? "classification-convert-queue"
        : `classification-convert-queue-${env}`;
    const dlqName = `${queueName}-dlq`;

    // DLQ first — main queue references it for redrive.
    const dlq = new sqs.Queue(this, "ConvertDlq", {
      queueName: dlqName,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      enforceSSL: true,
      removalPolicy,
    });

    // Main convert queue.
    //
    // visibilityTimeout = 30 min:
    //   office-convert's per-chunk timeout is 600s; multi-chunk heavy docs
    //   can stack up several timeouts before failing. 30 min is the safety
    //   floor before SQS redelivers the message to another worker replica.
    //   Tune up only if conversions routinely exceed this AND we add HPA.
    //
    // retentionPeriod = 14 days:
    //   maximum SQS retention; gives operators a full week to triage stuck
    //   DLQ messages before they age out.
    const convertQueue = new sqs.Queue(this, "ConvertQueue", {
      queueName,
      visibilityTimeout: cdk.Duration.minutes(30),
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      enforceSSL: true,
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
      removalPolicy,
    });

    // DLQ depth alarm — any message in DLQ is signal we want to see, both
    // for the dev05 dashboard and the SNS-wired pager (feat/07).
    new cloudwatch.Alarm(this, "ConvertDlqDepthAlarm", {
      alarmName: `${dlqName}-depth`,
      metric: dlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: "Maximum",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "Convert-worker failed >= maxReceiveCount (3) times for at least one message. " +
        "Inspect the DLQ body for the office-convert failure_class or the worker's " +
        "local diagnostic. The classifications-dev row will carry convertStatus=failed.",
    });

    // Age-of-oldest-message alarm — backlog detection (worker stalled, scaled
    // to zero, HPA misconfigured, IRSA dropped, etc.).
    new cloudwatch.Alarm(this, "ConvertQueueAgeAlarm", {
      alarmName: `${queueName}-age`,
      metric: convertQueue.metricApproximateAgeOfOldestMessage({
        period: cdk.Duration.minutes(5),
        statistic: "Maximum",
      }),
      threshold: 1800, // 30 min
      evaluationPeriods: 2,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "Convert queue's oldest message has been waiting > 30 min. Worker may be " +
        "stalled or scaled to zero. Check `kubectl -n classification-service-sandbox " +
        "get pods -l app=convert-worker` and the worker pod logs.",
    });

    // cdk-nag suppression: KMS_MANAGED uses AWS-owned keys (no CMK rotation
    // surface to manage). Sufficient for dev-tier ephemeral fan-out. Prod
    // can revisit with a customer-managed key if SQS-data sensitivity warrants.
    NagSuppressions.addResourceSuppressions(convertQueue, [
      {
        id: "AwsSolutions-SQS4",
        reason:
          "enforceSSL=true is set on the queue policy. The S3-event flag the rule " +
          "expects is not applicable here (no S3 event source).",
      },
    ]);
    NagSuppressions.addResourceSuppressions(dlq, [
      {
        id: "AwsSolutions-SQS3",
        reason:
          "This IS the dead-letter queue — it does not itself have a downstream DLQ.",
      },
      {
        id: "AwsSolutions-SQS4",
        reason: "enforceSSL=true is set; rule mismatch as above.",
      },
    ]);

    cdk.Tags.of(this).add("Component", "convert");

    this.convertQueue = convertQueue;
    this.convertDlq = dlq;

    // Cross-stack exports — consumed by the worker's IRSA policy (feat/03+04)
    // and by the classify route's env var (feat/05).
    new cdk.CfnOutput(this, "ConvertQueueUrl", {
      value: convertQueue.queueUrl,
      exportName: `ClassificationConvertQueueUrl-${env}`,
    });
    new cdk.CfnOutput(this, "ConvertQueueArn", {
      value: convertQueue.queueArn,
      exportName: `ClassificationConvertQueueArn-${env}`,
    });
    new cdk.CfnOutput(this, "ConvertDlqUrl", {
      value: dlq.queueUrl,
      exportName: `ClassificationConvertDlqUrl-${env}`,
    });
    new cdk.CfnOutput(this, "ConvertDlqArn", {
      value: dlq.queueArn,
      exportName: `ClassificationConvertDlqArn-${env}`,
    });
  }
}
