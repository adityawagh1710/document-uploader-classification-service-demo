import { describe, it, expect } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ClassificationDataStack } from "./data-stack.js";
import { ClassificationLambdaStack } from "./lambda-stack.js";
import { snapshotTemplate } from "./_test-helpers.js";
import devConfig from "../config/dev.js";
import prodConfig from "../config/prod.js";

function buildLambdaStack(envConfig = devConfig) {
  const app = new cdk.App();
  const data = new ClassificationDataStack(app, "TestData", { envConfig });
  const lambdaStack = new ClassificationLambdaStack(app, "TestLambda", {
    envConfig,
    contentHashTable: data.contentHashTable,
    workspaceConfigTable: data.workspaceConfigTable,
  });
  return { app, lambdaStack, template: Template.fromStack(lambdaStack) };
}

describe("ClassificationLambdaStack", () => {
  it("creates the classification Lambda (+ CDK's log-retention helper Lambda)", () => {
    const { template } = buildLambdaStack();
    // The `logRetention` prop on NodejsFunction installs a custom-resource
    // Lambda (`LogRetention<ID>`) that sets the CloudWatch retention. Net
    // count is 2: the classification function + the helper.
    template.resourceCountIs("AWS::Lambda::Function", 2);
  });

  it("Lambda has correct memory, timeout, architecture", () => {
    const { template } = buildLambdaStack();
    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        MemorySize: 512,
        Timeout: 30,
        Architectures: ["arm64"],
        Runtime: "nodejs20.x",
        TracingConfig: { Mode: "Active" },
      }),
    );
  });

  it("Lambda has Powertools env vars", () => {
    const { template } = buildLambdaStack();
    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({
            POWERTOOLS_SERVICE_NAME: "classification-service",
            POWERTOOLS_METRICS_NAMESPACE: "ClassificationService",
            POWERTOOLS_LOGGER_LOG_EVENT: "false",
          }),
        }),
      }),
    );
  });

  it("prod has reservedConcurrentExecutions = 100", () => {
    const { template } = buildLambdaStack(prodConfig);
    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({ ReservedConcurrentExecutions: 100 }),
    );
  });

  it("dev has no reservedConcurrentExecutions", () => {
    const { template } = buildLambdaStack(devConfig);
    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({ ReservedConcurrentExecutions: Match.absent() }),
    );
  });

  it("has an X-Ray sampling rule", () => {
    const { template } = buildLambdaStack();
    template.resourceCountIs("AWS::XRay::SamplingRule", 1);
  });

  it("has a `live` alias", () => {
    const { template } = buildLambdaStack();
    template.hasResourceProperties(
      "AWS::Lambda::Alias",
      Match.objectLike({ Name: "live" }),
    );
  });

  it("matches snapshot (dev)", () => {
    const { template } = buildLambdaStack();
    expect(snapshotTemplate(template)).toMatchSnapshot();
  });
});
