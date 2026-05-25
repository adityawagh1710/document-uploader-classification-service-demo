import type { EnvConfig } from "./types.js";

// Placeholder values — operator must replace `111111111111` with the real account ID
// and adjust ARNs to match actual upstream stacks.
const config: EnvConfig = {
  envName: "dev",
  region: "us-east-1",
  account: "111111111111",
  pitrEnabledContentHashes: false,
  deletionProtectionEnabled: false,
  logLevel: "DEBUG",
  powertoolsDev: true,
  powertoolsLoggerSampleRate: 1.0,
  reservedConcurrentExecutions: undefined,
  logRetentionDays: 7,
  stateMachineArn: "arn:aws:states:us-east-1:111111111111:stateMachine:document-ingestion-dev",
  documentBucketArn: "arn:aws:s3:::document-bucket-dev",
  xraySamplingReservoirSize: 1,
  xraySamplingFixedRate: 0.5,
  alarmsSnsTopicSsmPath: "/observability/sns-topic-arn/dev",
  lambdaInsightsEnabled: false,
  costCenter: "tbd",
};

export default config;
