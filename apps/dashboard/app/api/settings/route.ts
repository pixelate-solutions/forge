import { NextResponse } from "next/server";
import { getStore } from "@forge/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: getStore().getSettings() });
}

export async function POST(request: Request) {
  const body = await request.json();
  const store = getStore();
  const current = store.getSettings();
  const settings = store.saveSettings({ ...current, ...body });
  return NextResponse.json({ settings });
}
