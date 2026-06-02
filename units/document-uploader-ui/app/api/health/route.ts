import { NextResponse } from "next/server";
import { ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { awsClientConfig, DISPLAY_ENDPOINT } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Reuse the backend config classifier.ts resolved: LocalStack pins the
  // endpoint + static creds; AWS mode passes region-only so the IRSA chain
  // applies. Without this, AWS mode would probe localhost:4566 (absent in the
  // pod), 503, and the readiness/liveness probes would never pass.
  // A 2 s timeout keeps the probe snappy.
  const client = new DynamoDBClient({
    ...awsClientConfig,
    requestHandler: { requestTimeout: 2000 } as never,
  });
  try {
    const start = Date.now();
    const out = await client.send(new ListTablesCommand({}));
    return NextResponse.json({
      ready: true,
      endpoint: DISPLAY_ENDPOINT,
      tables: out.TableNames ?? [],
      latencyMs: Date.now() - start,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      {
        ready: false,
        endpoint: DISPLAY_ENDPOINT,
        error: (e as Error)?.message ?? "unknown",
      },
      { status: 503 },
    );
  }
}
