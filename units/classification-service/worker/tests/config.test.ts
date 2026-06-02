import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const VALID_ENV = {
  CONVERT_QUEUE_URL: "https://sqs.eu-west-1.amazonaws.com/000000000000/q",
  OFFICE_CONVERT_BASE_URL: "http://office-convert:8080",
  CLASSIFICATIONS_TABLE_NAME: "classifications-dev",
  AWS_REGION: "eu-west-1",
};

describe("loadConfig", () => {
  it("parses a complete env", () => {
    const cfg = loadConfig(VALID_ENV);
    expect(cfg.convertQueueUrl).toMatch(/sqs/);
    expect(cfg.classificationsTableName).toBe("classifications-dev");
    expect(cfg.awsRegion).toBe("eu-west-1");
    expect(cfg.sqsWaitTimeSeconds).toBe(20); // default
    expect(cfg.officeConvertTimeoutMs).toBe(1_800_000); // 30 min default
    expect(cfg.excludeDwg).toBe(true);
    expect(cfg.logLevel).toBe("info");
  });

  it("rejects a missing CONVERT_QUEUE_URL with a structured error", () => {
    const env = { ...VALID_ENV };
    delete (env as Partial<typeof env>).CONVERT_QUEUE_URL;
    expect(() => loadConfig(env)).toThrowError(/convertQueueUrl/);
  });

  it("rejects a non-URL CONVERT_QUEUE_URL", () => {
    expect(() => loadConfig({ ...VALID_ENV, CONVERT_QUEUE_URL: "not-a-url" })).toThrowError(/url/i);
  });

  it("rejects a missing CLASSIFICATIONS_TABLE_NAME", () => {
    const env = { ...VALID_ENV };
    delete (env as Partial<typeof env>).CLASSIFICATIONS_TABLE_NAME;
    expect(() => loadConfig(env)).toThrowError(/classificationsTableName/);
  });

  it("clamps SQS_WAIT_TIME_SECONDS to the [0,20] range", () => {
    expect(() => loadConfig({ ...VALID_ENV, SQS_WAIT_TIME_SECONDS: "21" })).toThrowError(/20/);
    expect(() => loadConfig({ ...VALID_ENV, SQS_WAIT_TIME_SECONDS: "-1" })).toThrowError(/0/);
  });

  it("coerces EXCLUDE_DWG=false to a boolean", () => {
    const cfg = loadConfig({ ...VALID_ENV, EXCLUDE_DWG: "false" });
    expect(cfg.excludeDwg).toBe(false);
  });

  it("passes AWS_ENDPOINT_URL through (LocalStack)", () => {
    const cfg = loadConfig({
      ...VALID_ENV,
      AWS_ENDPOINT_URL: "http://localstack:4566",
    });
    expect(cfg.awsEndpointUrl).toBe("http://localstack:4566");
  });

  it("falls back AWS_REGION → AWS_DEFAULT_REGION when only the latter is set", () => {
    const env = { ...VALID_ENV };
    delete (env as Partial<typeof env>).AWS_REGION;
    const cfg = loadConfig({ ...env, AWS_DEFAULT_REGION: "us-east-1" });
    expect(cfg.awsRegion).toBe("us-east-1");
  });
});
