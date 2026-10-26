import { NextResponse } from "next/server";
import { getStore } from "@forge/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ approvals: getStore().listApprovalRequests() });
}
