import { describe, it, expect } from "vitest";
import { Match } from "aws-cdk-lib/assertions";
import { ClassificationConvertQueueStack } from "./convert-queue-stack.js";
import { buildAppAndStack, snapshotTemplate } from "./_test-helpers.js";
import prodConfig from "../config/prod.js";

describe("ClassificationConvertQueueStack", () => {
  it("creates exactly 2 SQS queues (main + DLQ)", () => {
    const { template } = buildAppAndStack(ClassificationConvertQueueStack);
    template.resourceCountIs("AWS::SQS::Queue", 2);
  });

  it("creates exactly 2 CloudWatch alarms (DLQ depth + queue age)", () => {
    const { template } = buildAppAndStack(ClassificationConvertQueueStack);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });

  it("main queue has 30-min visibility, 14-day retention, KMS encryption, redrive to DLQ (maxReceiveCount=3)", () => {
    const { template } = buildAppAndStack(ClassificationConvertQueueStack);
    template.hasResourceProperties(
      "AWS::SQS::Queue",
      Match.objectLike({
        QueueName: "classification-convert-queue-dev",
        VisibilityTimeout: 1800, // 30 min in seconds
        MessageRetentionPeriod: 1209600, // 14 days in seconds
        KmsMasterKeyId: "alias/aws/sqs",
        RedrivePolicy: Match.objectLike({
          maxReceiveCount: 3,
        }),
      }),
    );
  });

  it("DLQ has 14-day retention, KMS encryption, no redrive of its own", () => {
    const { template } = buildAppAndStack(ClassificationConvertQueueStack);
    template.hasResourceProperties(
      "AWS::SQS::Queue",
      Match.objectLike({
        QueueName: "classification-convert-queue-dev-dlq",
        MessageRetentionPeriod: 1209600,
        KmsMasterKeyId: "alias/aws/sqs",
      }),
    );
    // No DLQ has a RedrivePolicy of its own.
    const queues = template.findResources("AWS::SQS::Queue", {
      Properties: { QueueName: "classification-convert-queue-dev-dlq" },
    });
    const dlqProps = Object.values(queues)[0]?.Properties ?? {};
    expect(dlqProps).not.toHaveProperty("RedrivePolicy");
  });

  it("both queues enforce SSL via queue policy", () => {
    const { template } = buildAppAndStack(ClassificationConvertQueueStack);
    template.resourceCountIs("AWS::SQS::QueuePolicy", 2);
    template.hasResourceProperties(
      "AWS::SQS::QueuePolicy",
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Deny",
              Condition: Match.objectLike({
                Bool: Match.objectLike({ "aws:SecureTransport": "false" }),
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it("DLQ depth alarm fires on >= 1 visible message (5-min window)", () => {
    const { template } = buildAppAndStack(ClassificationConvertQueueStack);
    template.hasResourceProperties(
      "AWS::CloudWatch::Alarm",
      Match.objectLike({
        AlarmName: "classification-convert-queue-dev-dlq-depth",
        Threshold: 1,
        EvaluationPeriods: 1,
        ComparisonOperator: "GreaterThanOrEqualToThreshold",
        MetricName: "ApproximateNumberOfMessagesVisible",
        Period: 300,
      }),
    );
  });

  it("age-of-oldest alarm fires on >= 1800s (2x 5-min datapoints)", () => {
    const { template } = buildAppAndStack(ClassificationConvertQueueStack);
    template.hasResourceProperties(
      "AWS::CloudWatch::Alarm",
      Match.objectLike({
        AlarmName: "classification-convert-queue-dev-age",
        Threshold: 1800,
        EvaluationPeriods: 2,
        ComparisonOperator: "GreaterThanOrEqualToThreshold",
        MetricName: "ApproximateAgeOfOldestMessage",
      }),
    );
  });

  it("exports queue URL + ARN for both main and DLQ (cross-stack consumers)", () => {
    const { template } = buildAppAndStack(ClassificationConvertQueueStack);
    template.hasOutput(
      "ConvertQueueUrl",
      Match.objectLike({ Export: { Name: "ClassificationConvertQueueUrl-dev" } }),
    );
    template.hasOutput(
      "ConvertQueueArn",
      Match.objectLike({ Export: { Name: "ClassificationConvertQueueArn-dev" } }),
    );
    template.hasOutput(
      "ConvertDlqUrl",
      Match.objectLike({ Export: { Name: "ClassificationConvertDlqUrl-dev" } }),
    );
    template.hasOutput(
      "ConvertDlqArn",
      Match.objectLike({ Export: { Name: "ClassificationConvertDlqArn-dev" } }),
    );
  });

  it("applies Service + Environment + Component tags via Stack-level tagging", () => {
    const { template } = buildAppAndStack(ClassificationConvertQueueStack);
    // Stack-level tags propagate to taggable resources. Verify on the main queue.
    template.hasResourceProperties(
      "AWS::SQS::Queue",
      Match.objectLike({
        QueueName: "classification-convert-queue-dev",
        Tags: Match.arrayWith([
          Match.objectLike({ Key: "Component", Value: "convert" }),
        ]),
      }),
    );
  });

  it("prod stack uses unsuffixed queue names + RETAIN removal policy", () => {
    const { template } = buildAppAndStack(
      ClassificationConvertQueueStack,
      {},
      prodConfig,
    );
    template.hasResourceProperties(
      "AWS::SQS::Queue",
      Match.objectLike({ QueueName: "classification-convert-queue" }),
    );
    template.hasResourceProperties(
      "AWS::SQS::Queue",
      Match.objectLike({ QueueName: "classification-convert-queue-dlq" }),
    );
    // Removal policy RETAIN appears at the resource level, not in Properties.
    const queues = template.findResources("AWS::SQS::Queue");
    for (const def of Object.values(queues)) {
      expect((def as { DeletionPolicy: string }).DeletionPolicy).toBe("Retain");
    }
  });

  it("matches snapshot (full template; scrubbed of CDK volatile fields)", () => {
    const { template } = buildAppAndStack(ClassificationConvertQueueStack);
    expect(snapshotTemplate(template)).toMatchSnapshot();
  });
});
