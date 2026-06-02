import { z } from "zod";

/**
 * Worker configuration — parsed from environment at boot. Fail-fast on missing
 * required vars so a misconfigured deploy crashes loudly instead of polling an
 * undefined queue forever.
 */
const ConfigSchema = z.object({
  // --- SQS source ---------------------------------------------------------
  /** Full queue URL (https://sqs.<region>.amazonaws.com/<acct>/<name>) or LocalStack equivalent. */
  convertQueueUrl: z.string().url(),
  /** Long-poll wait in seconds. Max 20. SQS-recommended for cost-efficient polling. */
  sqsWaitTimeSeconds: z.number().int().min(0).max(20).default(20),
  /**
   * Max in-flight messages a single worker can pull per ReceiveMessage call.
   * Keep at 1 — each message can trigger a 30-min office-convert call, so
   * batching makes the visibility-timeout math hard for no benefit.
   */
  sqsMaxMessages: z.number().int().min(1).max(10).default(1),

  // --- office-convert target ---------------------------------------------
  /**
   * Base URL of office-convert. In dev05 EKS this is the in-cluster Service
   * DNS (no ALB needed, no CIDR allowlist crossing). For LocalStack-mode dev
   * loop, point at the locally-running office-convert (compose link).
   */
  officeConvertBaseUrl: z.string().url(),
  /**
   * Per-request HTTP timeout in ms. Sized to match the SQS visibility timeout
   * (1800s = 30 min) so a stuck conversion is detectable on either side.
   */
  officeConvertTimeoutMs: z.number().int().min(1000).default(1_800_000),

  // --- DDB sink ----------------------------------------------------------
  /** Classifications table name (the per-upload UI activity log). */
  classificationsTableName: z.string().min(1),

  // --- AWS plumbing -------------------------------------------------------
  awsRegion: z.string().min(1),
  /**
   * Override AWS endpoint (LocalStack). Empty in real-AWS mode — SDK resolves
   * the regional endpoint from {service, region}. The classification-ui uses
   * the same env-var convention via the AWS SDK default chain.
   */
  awsEndpointUrl: z.string().optional(),

  // --- Behavior gates ----------------------------------------------------
  /**
   * Set to `true` to short-circuit DWG inputs as failed-unsupported without
   * round-tripping to office-convert. office-convert's 4-libs vendor path
   * (Words / Cells / Slides / PDF / Email) has no Aspose.CAD, so DWG would
   * 500 anyway — this just saves a wasted call + surfaces a clearer error.
   *
   * `z.coerce.boolean()` would treat the string "false" as truthy (any
   * non-empty string is truthy under JS coercion). Use an explicit string→
   * boolean transform so EXCLUDE_DWG=false actually disables.
   */
  excludeDwg: z
    .preprocess(
      (v) => (typeof v === "string" ? v.toLowerCase() !== "false" && v !== "" : v),
      z.boolean(),
    )
    .default(true),

  // --- Observability ------------------------------------------------------
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Build-time identifier baked into every log line (git SHA preferred). */
  workerVersion: z.string().default("dev"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Pull every env-var first, then validate as one object so zod's error
  // collects ALL missing/invalid fields in one shot instead of dying on the
  // first failure (better operator UX).
  const raw = {
    convertQueueUrl: env.CONVERT_QUEUE_URL,
    sqsWaitTimeSeconds: env.SQS_WAIT_TIME_SECONDS
      ? Number(env.SQS_WAIT_TIME_SECONDS)
      : undefined,
    sqsMaxMessages: env.SQS_MAX_MESSAGES
      ? Number(env.SQS_MAX_MESSAGES)
      : undefined,
    officeConvertBaseUrl: env.OFFICE_CONVERT_BASE_URL,
    officeConvertTimeoutMs: env.OFFICE_CONVERT_TIMEOUT_MS
      ? Number(env.OFFICE_CONVERT_TIMEOUT_MS)
      : undefined,
    classificationsTableName: env.CLASSIFICATIONS_TABLE_NAME,
    awsRegion: env.AWS_REGION ?? env.AWS_DEFAULT_REGION,
    awsEndpointUrl: env.AWS_ENDPOINT_URL,
    excludeDwg: env.EXCLUDE_DWG,
    logLevel: env.LOG_LEVEL,
    workerVersion: env.WORKER_VERSION,
  };
  return ConfigSchema.parse(raw);
}
