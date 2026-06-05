import { NextResponse } from "next/server";
import { routerGraphQL } from "@/lib/router-graphql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

// The parsed email-extraction payload, now persisted to DynamoDB during classify
// and read back through the router (replaces the UI's old process-local cache).
const EMAIL_QUERY = `query($d: ID!){ emailExtraction(documentId: $d){ documentId extraction } }`;

export async function GET(_req: Request, { params }: RouteContext) {
  const { documentId } = await params;
  const data = await routerGraphQL<{
    emailExtraction: { documentId: string; extraction: Record<string, unknown> | null } | null;
  }>(EMAIL_QUERY, { d: documentId });

  const ext = data.emailExtraction;
  if (!ext || !ext.extraction) {
    return NextResponse.json(
      { error: "no extraction recorded for this document", documentId },
      { status: 404 },
    );
  }
  return NextResponse.json({ documentId: ext.documentId, extraction: ext.extraction });
}
