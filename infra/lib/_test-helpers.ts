import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import type { EnvConfig } from "../config/types.js";
import devConfig from "../config/dev.js";

export interface TestStackProps {
  envConfig: EnvConfig;
  [key: string]: unknown;
}

// Pattern P-4-1: build an isolated App + Stack + Template for testing.
export function buildAppAndStack<S extends cdk.Stack>(
  StackCtor: new (scope: cdk.App, id: string, props: TestStackProps) => S,
  extraProps: Record<string, unknown> = {},
  envConfig: EnvConfig = devConfig,
): { app: cdk.App; stack: S; template: Template } {
  const app = new cdk.App();
  // aws-cdk-lib ≥ 2.176 requires an explicit env for context providers
  // (e.g. ssm.StringParameter.valueFromLookup) used by the observability
  // stack. Use deterministic placeholders so the test snapshot stays stable.
  const stack = new StackCtor(app, "TestStack", {
    envConfig,
    env: { account: "123456789012", region: "us-east-1" },
    ...extraProps,
  });
  const template = Template.fromStack(stack);
  return { app, stack, template };
}

// Strip CDK-internal volatile fields for stable snapshots.
export function snapshotTemplate(template: Template): unknown {
  return scrubVolatile(template.toJSON());
}

function scrubVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubVolatile);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Mask CDK asset hashes + auto-generated logical IDs
      if (/^[a-f0-9]{32,}/i.test(k)) {
        out["__VOLATILE_KEY__"] = scrubVolatile(v);
      } else if (typeof v === "string" && /^[a-f0-9]{40,}/i.test(v)) {
        out[k] = "__VOLATILE_HASH__";
      } else {
        out[k] = scrubVolatile(v);
      }
    }
    return out;
  }
  return value;
}
