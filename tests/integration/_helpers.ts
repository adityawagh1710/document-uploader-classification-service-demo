// Worker-side helper: reconstructs LocalStack AWS clients in each test process
// using values published by `_setup.ts` via vitest's provide()/inject() API.
import { inject } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export interface LocalstackContext {
  readonly endpoint: string;
  readonly ddb: DynamoDBDocumentClient;
  readonly contentHashTable: string;
  readonly workspaceConfigTable: string;
}

export function getLocalstack(): LocalstackContext {
  const port = inject("localstackPort");
  const endpoint = `http://localhost:${port}`;
  const ddbLowLevel = new DynamoDBClient({
    region: "us-east-1",
    endpoint,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    retryMode: "standard",
    maxAttempts: 3,
  });
  const ddb = DynamoDBDocumentClient.from(ddbLowLevel);
  return {
    endpoint,
    ddb,
    contentHashTable: inject("contentHashTable"),
    workspaceConfigTable: inject("workspaceConfigTable"),
  };
}
