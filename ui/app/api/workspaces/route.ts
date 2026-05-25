import { NextResponse } from "next/server";
import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, WORKSPACE_CONFIG_TABLE, ensureResourcesProvisioned } from "@/lib/classifier";
import type { WorkspaceConfig } from "@svc/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WorkspacePutBody {
  workspaceId?: string;
  policyVersion?: string;
  threshold?: number;
  maxZipDepth?: number;
  quarantineMacros?: boolean;
  slipsheetRules?: Record<string, "always-slipsheet">;
  hashTtlDays?: number | null;
}

export async function GET() {
  await ensureResourcesProvisioned();
  const res = await ddb.send(new ScanCommand({ TableName: WORKSPACE_CONFIG_TABLE }));
  const items = (res.Items ?? []) as WorkspaceConfig[];
  return NextResponse.json({ workspaces: items });
}

export async function POST(req: Request) {
  await ensureResourcesProvisioned();
  let body: WorkspacePutBody;
  try {
    body = (await req.json()) as WorkspacePutBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const config: WorkspaceConfig = {
    workspaceId,
    policyVersion: body.policyVersion ?? "v1",
    threshold: typeof body.threshold === "number" ? body.threshold : 0.5,
    maxZipDepth: typeof body.maxZipDepth === "number" ? body.maxZipDepth : 5,
    quarantineMacros: typeof body.quarantineMacros === "boolean" ? body.quarantineMacros : false,
    slipsheetRules: body.slipsheetRules ?? {},
    hashTtlDays: body.hashTtlDays === undefined ? null : body.hashTtlDays,
  };

  await ddb.send(
    new PutCommand({
      TableName: WORKSPACE_CONFIG_TABLE,
      Item: { ...config },
    }),
  );

  return NextResponse.json({ workspace: config });
}
