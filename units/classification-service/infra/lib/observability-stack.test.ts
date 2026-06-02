import { describe, it, expect } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ClassificationDataStack } from "./data-stack.js";
import { ClassificationLambdaStack } from "./lambda-stack.js";
import { ClassificationObservabilityStack } from "./observability-stack.js";
import { snapshotTemplate } from "./_test-helpers.js";
import devConfig from "../config/dev.js";
import prodConfig from "../config/prod.js";

function buildObservabilityStack(envConfig = devConfig) {
  const app = new cdk.App({
    context: {
      // Provide a dummy SSM lookup result so cdk synth doesn't error
      [`ssm:account=${envConfig.account}:parameterName=${envConfig.alarmsSnsTopicSsmPath}:region=${envConfig.region}`]:
        `arn:aws:sns:${envConfig.region}:${envConfig.account}:test-topic`,
    },
  });
  // aws-cdk-lib ≥ 2.176 requires `env` on the stack for context-provider
  // lookups (ssm.StringParameter.valueFromLookup) even when a context
  // value is pre-supplied above. Pass the env explicitly to every stack.
  const env = { account: envConfig.account, region: envConfig.region };
  const data = new ClassificationDataStack(app, "TestData", { envConfig, env });
  const lambdaStack = new ClassificationLambdaStack(app, "TestLambda", {
    envConfig,
    env,
    contentHashTable: data.contentHashTable,
    workspaceConfigTable: data.workspaceConfigTable,
  });
  const observabilityStack = new ClassificationObservabilityStack(app, "TestObs", {
    envConfig,
    env,
    fn: lambdaStack.fn,
    alias: lambdaStack.alias,
    contentHashTable: data.contentHashTable,
    workspaceConfigTable: data.workspaceConfigTable,
  });
  return { app, observabilityStack, template: Template.fromStack(observabilityStack) };
}

describe("ClassificationObservabilityStack", () => {
  it("creates the expected number of alarms (dev has 5 — no concurrency alarm)", () => {
    const { template } = buildObservabilityStack(devConfig);
    // 4 DDB alarms + 6 Lambda alarms - 1 (no concurrency in dev) = 9
    template.resourceCountIs("AWS::CloudWatch::Alarm", 9);
  });

  it("creates the expected number of alarms (prod has all 10)", () => {
    const { template } = buildObservabilityStack(prodConfig);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 10);
  });

  it("creates a CloudWatch Dashboard", () => {
    const { template } = buildObservabilityStack();
    template.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
  });

  it("alarms have an SNS action wired", () => {
    const { template } = buildObservabilityStack();
    const alarms = template.findResources("AWS::CloudWatch::Alarm");
    for (const alarm of Object.values(alarms)) {
      const actions = (alarm.Properties as { AlarmActions?: unknown[] })?.AlarmActions ?? [];
      expect(actions.length).toBeGreaterThan(0);
    }
  });

  it("Lambda duration p99 alarms have correct thresholds", () => {
    const { template } = buildObservabilityStack();
    template.hasResourceProperties(
      "AWS::CloudWatch::Alarm",
      Match.objectLike({
        AlarmName: Match.stringLikeRegexp(".*lambda-duration-p99-small-docs.*"),
        Threshold: 3000,
      }),
    );
    template.hasResourceProperties(
      "AWS::CloudWatch::Alarm",
      Match.objectLike({
        AlarmName: Match.stringLikeRegexp(".*lambda-duration-p99-large-docs.*"),
        Threshold: 15000,
      }),
    );
  });

  it("matches snapshot (dev)", () => {
    const { template } = buildObservabilityStack();
    expect(snapshotTemplate(template)).toMatchSnapshot();
  });
});
