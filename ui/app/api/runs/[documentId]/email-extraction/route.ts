import { NextResponse } from "next/server";
import { getEmailExtraction } from "@/lib/email-extractions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { documentId: string };
}

// Returns the cached email-extraction-service response for a given classifier
// documentId. 404 when no cache entry exists (UI container restarted, or the
// row predates the fan-out wiring).
export async function GET(_req: Request, { params }: RouteContext) {
  const documentId = params.documentId;
  const extraction = getEmailExtraction(documentId);
  if (!extraction) {
    return NextResponse.json(
      { error: "no cached extraction for this document", documentId },
      { status: 404 },
    );
  }
  return NextResponse.json({ documentId, extraction });
}
