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
// Snapshots compare *infrastructure shape* — they must be resilient to
// CDK-version-dependent metadata, esbuild output hashes, and CDK's 8-char
// logical-ID hash suffixes that shift when upstream synth behavior changes.
export function snapshotTemplate(template: Template): unknown {
  return scrubVolatile(template.toJSON());
}

// Lambda Version + Alias logical IDs follow the pattern:
//   <Prefix><8-char hash><optional 32-char content hash>
// Example: `ClassificationFunctionCurrentVersion2174D664a8454aff948…`
// where:
//   - 2174D664 is CDK's location-based logical-ID hash (stable per stack/path)
//   - a8454aff… (32 hex chars) is the bundle content hash, which differs
//     between local + CI because of esbuild/Node version + filesystem
//     ordering. This is what caused PR #2's snapshot to drift in CI even
//     though local + initial-CI passed.
// We normalize BOTH so snapshots stay stable across environments.
function stripLogicalIdHash(s: string): string {
  return (
    s
      // First: 32+ char hex content hashes anywhere (handles embedded variants).
      .replace(/[a-f0-9]{32,}/gi, "__CONTENT_HASH__")
      // Second: 8-char CDK location hash suffix on identifier-like strings.
      // Lookahead matches word boundary, end-of-string, or the just-inserted
      // `__CONTENT_HASH__` placeholder.
      .replace(/([A-Za-z][A-Za-z0-9_]+)[A-F0-9]{8}(?=__|\b|$)/g, "$1__HASH__")
  );
}

function scrubVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubVolatile);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Drop CDK's per-resource Metadata block — new fields appear here
      // between aws-cdk-lib versions (cdk:path, asset-bundling markers, etc.)
      // and they're not part of infrastructure shape.
      if (k === "Metadata") {
        out[k] = "__SCRUBBED_METADATA__";
        continue;
      }
      const normalizedKey = /^[a-f0-9]{32,}/i.test(k) ? "__VOLATILE_KEY__" : stripLogicalIdHash(k);
      if (typeof v === "string") {
        // SHA-256 asset hashes (32+ hex), bootstrap SSM param defaults, and
        // *.zip asset object keys are all env-tied — normalize them.
        if (/^[a-f0-9]{32,}$/i.test(v) || /^[a-f0-9]{32,}\.zip$/i.test(v)) {
          out[normalizedKey] = "__VOLATILE_HASH__";
          continue;
        }
        if (/\/cdk-bootstrap\//.test(v)) {
          out[normalizedKey] = "__BOOTSTRAP_PARAM__";
          continue;
        }
        out[normalizedKey] = stripLogicalIdHash(v);
        continue;
      }
      out[normalizedKey] = scrubVolatile(v);
    }
    return out;
  }
  // Strings reached as standalone values (e.g. inside Fn::* intrinsics) also
  // carry the 8-char hash suffix — normalize so cross-resource refs are stable.
  if (typeof value === "string") {
    return stripLogicalIdHash(value);
  }
  return value;
}
