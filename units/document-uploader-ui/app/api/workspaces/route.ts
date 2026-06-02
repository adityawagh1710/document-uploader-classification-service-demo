import { NextResponse } from "next/server";
import { routerGraphQL } from "@/lib/router-graphql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Migrated off direct DynamoDB access: workspace configs are now read/written
// through the wundergraph-router (workspaceConfigs / saveWorkspaceConfig), which
// fronts the same workspace-config table the classification service consumes.

interface WorkspaceConfigShape {
  workspaceId: string;
  policyVersion: string;
  threshold: number;
  maxZipDepth: number;
  quarantineMacros: boolean;
  slipsheetRules: Record<string, string>;
  hashTtlDays: number | null;
}

interface WorkspacePutBody {
  workspaceId?: string;
  policyVersion?: string;
  threshold?: number;
  maxZipDepth?: number;
  quarantineMacros?: boolean;
  slipsheetRules?: Record<string, string>;
  hashTtlDays?: number | null;
}

const CONFIG_FIELDS =
  "workspaceId policyVersion threshold maxZipDepth quarantineMacros slipsheetRules hashTtlDays";

export async function GET() {
  const data = await routerGraphQL<{ workspaceConfigs: WorkspaceConfigShape[] }>(
    `{ workspaceConfigs { ${CONFIG_FIELDS} } }`,
  );
  return NextResponse.json({ workspaces: data.workspaceConfigs });
}

export async function POST(req: Request) {
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

  const data = await routerGraphQL<{ saveWorkspaceConfig: WorkspaceConfigShape }>(
    `mutation($i: WorkspaceConfigInput!){ saveWorkspaceConfig(input: $i){ ${CONFIG_FIELDS} } }`,
    {
      i: {
        workspaceId,
        policyVersion: body.policyVersion,
        threshold: body.threshold,
        maxZipDepth: body.maxZipDepth,
        quarantineMacros: body.quarantineMacros,
        slipsheetRules: body.slipsheetRules,
        hashTtlDays: body.hashTtlDays,
      },
    },
  );

  return NextResponse.json({ workspace: data.saveWorkspaceConfig });
}
