#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { Aspects } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";

import { loadEnvConfig } from "../config/load.js";
import { ClassificationDataStack } from "../lib/data-stack.js";
import { ClassificationLambdaStack } from "../lib/lambda-stack.js";
import { ClassificationObservabilityStack } from "../lib/observability-stack.js";

const app = new cdk.App();

const envName =
  (app.node.tryGetContext("env") as string | undefined) ??
  process.env.CDK_DEFAULT_ENV ??
  "dev";

const envConfig = loadEnvConfig(envName);
const env = { account: envConfig.account, region: envConfig.region };

// App-level tags (Pattern §4 of U-4 IaD)
cdk.Tags.of(app).add("Service", "classification-service");
cdk.Tags.of(app).add("Environment", envConfig.envName);
cdk.Tags.of(app).add("ManagedBy", "cdk");
cdk.Tags.of(app).add("Owner", "platform-team");
cdk.Tags.of(app).add("CostCenter", envConfig.costCenter);

const data = new ClassificationDataStack(
  app,
  `ClassificationData-${envConfig.envName}`,
  { env, envConfig },
);

const lambdaStack = new ClassificationLambdaStack(
  app,
  `ClassificationLambda-${envConfig.envName}`,
  {
    env,
    envConfig,
    contentHashTable: data.contentHashTable,
    workspaceConfigTable: data.workspaceConfigTable,
  },
);
lambdaStack.addDependency(data);

const observability = new ClassificationObservabilityStack(
  app,
  `ClassificationObservability-${envConfig.envName}`,
  {
    env,
    envConfig,
    fn: lambdaStack.fn,
    alias: lambdaStack.alias,
    contentHashTable: data.contentHashTable,
    workspaceConfigTable: data.workspaceConfigTable,
  },
);
observability.addDependency(lambdaStack);

// Apply cdk-nag at app level — every stack + resource is checked
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
