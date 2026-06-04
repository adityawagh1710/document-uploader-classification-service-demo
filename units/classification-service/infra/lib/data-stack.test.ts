import { describe, it, expect } from "vitest";
import { Match } from "aws-cdk-lib/assertions";
import { ClassificationDataStack } from "./data-stack.js";
import { buildAppAndStack, snapshotTemplate } from "./_test-helpers.js";
import devConfig from "../config/dev.js";
import prodConfig from "../config/prod.js";

describe("ClassificationDataStack", () => {
  it("creates exactly 4 DDB tables", () => {
    const { template } = buildAppAndStack(ClassificationDataStack);
    template.resourceCountIs("AWS::DynamoDB::Table", 4);
  });

  it("email-extractions table has correct partition key (documentId), TTL, no sort key", () => {
    const { template } = buildAppAndStack(ClassificationDataStack);
    const tables = template.findResources("AWS::DynamoDB::Table");
    const emailExtractionsTable = Object.values(tables).find((t) => {
      const keySchema = (t.Properties as { KeySchema?: Array<{ AttributeName: string }> })?.KeySchema;
      return keySchema?.length === 1 && keySchema[0]?.AttributeName === "documentId";
    });
    expect(emailExtractionsTable).toBeDefined();
    expect(emailExtractionsTable?.Properties).toMatchObject({
      BillingMode: "PAY_PER_REQUEST",
      SSESpecification: { SSEEnabled: true },
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
    });
  });

  it("classifications table has correct keys, billing mode, encryption, TTL", () => {
    const { template } = buildAppAndStack(ClassificationDataStack);
    template.hasResourceProperties(
      "AWS::DynamoDB::Table",
      Match.objectLike({
        KeySchema: Match.arrayWith([
          Match.objectLike({ AttributeName: "workspaceId", KeyType: "HASH" }),
          Match.objectLike({ AttributeName: "runId", KeyType: "RANGE" }),
        ]),
        BillingMode: "PAY_PER_REQUEST",
        SSESpecification: Match.objectLike({ SSEEnabled: true }),
        TimeToLiveSpecification: Match.objectLike({
          AttributeName: "expiresAt",
          Enabled: true,
        }),
      }),
    );
  });

  it("content-hashes table has correct keys, billing mode, encryption, TTL", () => {
    const { template } = buildAppAndStack(ClassificationDataStack);
    template.hasResourceProperties(
      "AWS::DynamoDB::Table",
      Match.objectLike({
        KeySchema: Match.arrayWith([
          Match.objectLike({ AttributeName: "workspaceId", KeyType: "HASH" }),
          Match.objectLike({ AttributeName: "contentHash", KeyType: "RANGE" }),
        ]),
        BillingMode: "PAY_PER_REQUEST",
        SSESpecification: Match.objectLike({ SSEEnabled: true }),
        TimeToLiveSpecification: Match.objectLike({
          AttributeName: "expiresAt",
          Enabled: true,
        }),
      }),
    );
  });

  it("workspace-config table has correct partition key (no sort key)", () => {
    const { template } = buildAppAndStack(ClassificationDataStack);
    const tables = template.findResources("AWS::DynamoDB::Table");
    const workspaceConfigTable = Object.values(tables).find((t) => {
      const keySchema = (t.Properties as { KeySchema?: Array<{ AttributeName: string }> })?.KeySchema;
      return keySchema?.length === 1 && keySchema[0]?.AttributeName === "workspaceId";
    });
    expect(workspaceConfigTable).toBeDefined();
  });

  it("content-hashes PITR enabled in prod", () => {
    const { template } = buildAppAndStack(ClassificationDataStack, {}, prodConfig);
    const tables = template.findResources("AWS::DynamoDB::Table");
    const contentHashTable = Object.values(tables).find((t) => {
      const keySchema = (t.Properties as { KeySchema?: Array<{ AttributeName: string }> })?.KeySchema;
      // Both content-hashes and classifications have a 2-key schema; the
      // content-hashes table is the one whose sort key is contentHash.
      return keySchema?.some((k) => k.AttributeName === "contentHash");
    });
    expect(contentHashTable?.Properties).toMatchObject({
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  it("content-hashes PITR disabled in dev", () => {
    const { template } = buildAppAndStack(ClassificationDataStack, {}, devConfig);
    const tables = template.findResources("AWS::DynamoDB::Table");
    const contentHashTable = Object.values(tables).find((t) => {
      const keySchema = (t.Properties as { KeySchema?: Array<{ AttributeName: string }> })?.KeySchema;
      // Both content-hashes and classifications have a 2-key schema; the
      // content-hashes table is the one whose sort key is contentHash.
      return keySchema?.some((k) => k.AttributeName === "contentHash");
    });
    const pitr = (contentHashTable?.Properties as { PointInTimeRecoverySpecification?: { PointInTimeRecoveryEnabled?: boolean } })?.PointInTimeRecoverySpecification;
    expect(pitr?.PointInTimeRecoveryEnabled).toBe(false);
  });

  it("matches snapshot (dev)", () => {
    const { template } = buildAppAndStack(ClassificationDataStack);
    expect(snapshotTemplate(template)).toMatchSnapshot();
  });
});
