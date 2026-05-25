import { NextResponse } from "next/server";
import { snapshot } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(snapshot());
}
