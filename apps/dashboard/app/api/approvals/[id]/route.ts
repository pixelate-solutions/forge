import { NextResponse } from "next/server";
import { getStore } from "@forge/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as { status?: "approved" | "rejected" };
  if (body.status !== "approved" && body.status !== "rejected") {
    return NextResponse.json({ error: "status must be approved or rejected." }, { status: 400 });
  }
  const store = getStore();
  const approval = store.resolveApproval(id, body.status);
  if (!approval) return NextResponse.json({ error: "Approval not found." }, { status: 404 });
  store.updateRun(approval.runId, { status: body.status === "approved" ? "paused" : "paused" });
  store.addAgentMessage({
    runId: approval.runId,
    agent: "ApprovalSystem",
    level: body.status === "approved" ? "info" : "warn",
    message: `Approval ${body.status}: ${approval.title}`
  });
  return NextResponse.json({ approval });
}
