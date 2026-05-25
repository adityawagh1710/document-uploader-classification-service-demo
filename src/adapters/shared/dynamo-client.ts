import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export interface DDBClientConfig {
  readonly endpoint?: string;
  readonly region?: string;
  readonly credentials?: { accessKeyId: string; secretAccessKey: string };
}

// Single shared DDB Document Client (Pattern P-2-1).
// Construct ONCE at Lambda init; reuse across all warm invocations.
export function createDDBDocumentClient(config: DDBClientConfig = {}): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    retryMode: "standard",
    maxAttempts: 3,
    ...(config.endpoint !== undefined && { endpoint: config.endpoint }),
    ...(config.region !== undefined && { region: config.region }),
    ...(config.credentials !== undefined && { credentials: config.credentials }),
  });
  return DynamoDBDocumentClient.from(client);
}
