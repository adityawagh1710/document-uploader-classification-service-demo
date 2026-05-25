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

  // X-Ray sampling
  readonly xraySamplingReservoirSize: number;
  readonly xraySamplingFixedRate: number;

  // Observability
  readonly alarmsSnsTopicSsmPath: string;
  readonly lambdaInsightsEnabled: boolean;

  // Tagging
  readonly costCenter: string;
}
