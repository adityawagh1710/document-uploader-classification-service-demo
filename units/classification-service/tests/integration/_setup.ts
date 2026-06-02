// Pattern P-2-2: LocalStack globalSetup for integration tests.
// Provides connection details to worker processes via vitest's provide/inject API.
// `globalThis` mutations do NOT cross the main-process → worker boundary, so we
// expose values explicitly and let workers reconstruct AWS clients per-test.
import type { GlobalSetupContext } from "vitest/node";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { DynamoDBClient, CreateTableCommand } from "@aws-sdk/client-dynamodb";

const LOCALSTACK_IMAGE = "localstack/localstack:3.7.0";
const CONTENT_HASH_TABLE = "content-hashes-test";
const WORKSPACE_CONFIG_TABLE = "workspace-config-test";

declare module "vitest" {
  export interface ProvidedContext {
    localstackPort: number;
    contentHashTable: string;
    workspaceConfigTable: string;
  }
}

let container: StartedTestContainer | undefined;

export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  container = await new GenericContainer(LOCALSTACK_IMAGE)
    .withExposedPorts(4566)
    .withEnvironment({
      SERVICES: "dynamodb,s3,stepfunctions,sqs",
      DEFAULT_REGION: "us-east-1",
      PERSISTENCE: "0",
    })
    .withWaitStrategy(Wait.forLogMessage(/Ready\./))
    .start();

  const port = container.getMappedPort(4566);
  const endpoint = `http://localhost:${port}`;
  const ddbLowLevel = new DynamoDBClient({
    region: "us-east-1",
    endpoint,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    retryMode: "standard",
    maxAttempts: 3,
  });

  await provisionContentHashTable(ddbLowLevel);
  await provisionWorkspaceConfigTable(ddbLowLevel);

  provide("localstackPort", port);
  provide("contentHashTable", CONTENT_HASH_TABLE);
  provide("workspaceConfigTable", WORKSPACE_CONFIG_TABLE);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

async function provisionContentHashTable(client: DynamoDBClient): Promise<void> {
  await client.send(
    new CreateTableCommand({
      TableName: CONTENT_HASH_TABLE,
      AttributeDefinitions: [
        { AttributeName: "workspaceId", AttributeType: "S" },
        { AttributeName: "contentHash", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "workspaceId", KeyType: "HASH" },
        { AttributeName: "contentHash", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
}

async function provisionWorkspaceConfigTable(client: DynamoDBClient): Promise<void> {
  await client.send(
    new CreateTableCommand({
      TableName: WORKSPACE_CONFIG_TABLE,
      AttributeDefinitions: [{ AttributeName: "workspaceId", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "workspaceId", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
}
