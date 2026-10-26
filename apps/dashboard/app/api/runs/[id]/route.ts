import { NextResponse } from "next/server";
import { getStore } from "@forge/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const details = getStore().getRunDetails(id);
  if (!details) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  return NextResponse.json(details);
}
