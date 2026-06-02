export interface EnvConfig {
  readonly envName: "dev" | "staging" | "prod";

  // Region + account
  readonly region: string;
  readonly account: string;

  // DDB
  readonly pitrEnabledContentHashes: boolean;
  readonly deletionProtectionEnabled: boolean;

  // Lambda
  readonly logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
  readonly powertoolsDev: boolean;
  readonly powertoolsLoggerSampleRate: number;
  readonly reservedConcurrentExecutions: number | undefined;
  readonly logRetentionDays: number;

  // Cross-stack imports (upstream)
  readonly stateMachineArn: string;
  readonly documentBucketArn: string;

  // Downstream archive fan-out — when category=archive the Lambda
  // publishes a claim-check here. Empty string disables the fan-out.
  readonly zipExtractionQueueArn: string;
  readonly zipExtractionQueueUrl: string;

  // X-Ray sampling
  readonly xraySamplingReservoirSize: number;
  readonly xraySamplingFixedRate: number;

  // Observability
  readonly alarmsSnsTopicSsmPath: string;
  readonly lambdaInsightsEnabled: boolean;

  // Tagging
  readonly costCenter: string;
}
