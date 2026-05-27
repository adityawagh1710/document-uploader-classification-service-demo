import type { EnvConfig } from "./types.js";

// dev environment = the dev05 sandbox account (eu-west-1, account 537462380503).
//
// Option A topology: only the DataStack (the two DynamoDB tables) is deployed
// here — the UI runs the classifier in-process via IRSA, so there is no Lambda
// or Step Functions to wire up yet. The stateMachineArn / documentBucketArn /
// SNS-SSM values below are STILL PLACEHOLDERS; they are consumed only by the
// (undeployed) LambdaStack + ObservabilityStack. Fill them in when the real
// upstream document-ingestion pipeline exists. See deploy/AWS_TOPOLOGY.md.
const config: EnvConfig = {
  envName: "dev",
  region: "eu-west-1",
  account: "537462380503",
  pitrEnabledContentHashes: false,
  deletionProtectionEnabled: false,
  logLevel: "DEBUG",
  powertoolsDev: true,
  powertoolsLoggerSampleRate: 1.0,
  reservedConcurrentExecutions: undefined,
  logRetentionDays: 7,
  // PLACEHOLDER (LambdaStack-only): real upstream pipeline not yet provisioned.
  stateMachineArn: "arn:aws:states:eu-west-1:537462380503:stateMachine:document-ingestion-dev",
  // PLACEHOLDER (LambdaStack-only): real document bucket not yet provisioned.
  documentBucketArn: "arn:aws:s3:::document-bucket-dev",
  xraySamplingReservoirSize: 1,
  xraySamplingFixedRate: 0.5,
  alarmsSnsTopicSsmPath: "/observability/sns-topic-arn/dev",
  lambdaInsightsEnabled: false,
  costCenter: "tbd",
};

export default config;
