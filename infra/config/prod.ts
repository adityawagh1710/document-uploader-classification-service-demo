import type { EnvConfig } from "./types.js";

const config: EnvConfig = {
  envName: "prod",
  region: "us-east-1",
  account: "333333333333",
  pitrEnabledContentHashes: true,
  deletionProtectionEnabled: true,
  logLevel: "INFO",
  powertoolsDev: false,
  powertoolsLoggerSampleRate: 0.01,
  reservedConcurrentExecutions: 100,
  logRetentionDays: 90,
  stateMachineArn: "arn:aws:states:us-east-1:333333333333:stateMachine:document-ingestion",
  documentBucketArn: "arn:aws:s3:::document-bucket-prod",
  xraySamplingReservoirSize: 1,
  xraySamplingFixedRate: 0.05,
  alarmsSnsTopicSsmPath: "/observability/sns-topic-arn/prod",
  lambdaInsightsEnabled: true,
  costCenter: "tbd",
};

export default config;
