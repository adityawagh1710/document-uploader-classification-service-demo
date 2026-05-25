import { NextResponse } from "next/server";
import { ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const endpoint = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
  const region = process.env.AWS_REGION ?? "us-east-1";
  const client = new DynamoDBClient({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
    requestHandler: { requestTimeout: 2000 } as never,
  });
  try {
    const start = Date.now();
    const out = await client.send(new ListTablesCommand({}));
    return NextResponse.json({
      ready: true,
      endpoint,
      tables: out.TableNames ?? [],
      latencyMs: Date.now() - start,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      {
        ready: false,
        endpoint,
        error: (e as Error)?.message ?? "unknown",
      },
      { status: 503 },
    );
  }
}
