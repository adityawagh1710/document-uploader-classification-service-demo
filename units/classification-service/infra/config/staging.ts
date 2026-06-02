import type { EnvConfig } from "./types.js";

const config: EnvConfig = {
  envName: "staging",
  region: "us-east-1",
  account: "222222222222",
  pitrEnabledContentHashes: true,
  deletionProtectionEnabled: true,
  logLevel: "INFO",
  powertoolsDev: false,
  powertoolsLoggerSampleRate: 0.1,
  reservedConcurrentExecutions: undefined,
  logRetentionDays: 30,
  stateMachineArn: "arn:aws:states:us-east-1:222222222222:stateMachine:document-ingestion-staging",
  documentBucketArn: "arn:aws:s3:::document-bucket-staging",
  zipExtractionQueueArn: "arn:aws:sqs:us-east-1:222222222222:zip-extraction-queue-staging",
  zipExtractionQueueUrl: "https://sqs.us-east-1.amazonaws.com/222222222222/zip-extraction-queue-staging",
  xraySamplingReservoirSize: 1,
  xraySamplingFixedRate: 0.1,
  alarmsSnsTopicSsmPath: "/observability/sns-topic-arn/staging",
  lambdaInsightsEnabled: true,
  costCenter: "tbd",
};

export default config;
