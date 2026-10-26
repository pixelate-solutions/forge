import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getStore } from "@forge/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  return NextResponse.json({
    runs: store.listRuns(),
    approvals: store.listApprovalRequests(),
    commands: store.listCommands(),
    messages: store.listAgentMessages(),
    artifacts: store.listArtifacts(),
    visualQaResults: store.listVisualQAResults(),
    settings: store.getSettings()
  });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const form = contentType.includes("multipart/form-data") ? await request.formData() : undefined;
  const jsonBody = form
    ? undefined
    : ((await request.json()) as {
        projectName?: string;
        repoPath?: string;
        title?: string;
        rawInput?: string;
        referenceUrls?: string;
        referenceNotes?: string;
        allowWebSearch?: boolean;
        sourceRunId?: string;
      });
  const files = form?.getAll("references").filter((item): item is File => item instanceof File) ?? [];
  const rawInput = String(form?.get("rawInput") ?? jsonBody?.rawInput ?? "").trim();
  const referenceUrls = String(form?.get("referenceUrls") ?? jsonBody?.referenceUrls ?? "").trim();
  const referenceNotes = String(form?.get("referenceNotes") ?? jsonBody?.referenceNotes ?? "").trim();
  const sourceRunId = String(form?.get("sourceRunId") ?? jsonBody?.sourceRunId ?? "").trim();
  const hasReferences = referenceUrls.length > 0 || referenceNotes.length > 0 || files.some((file) => file.size > 0);
  if (rawInput.length < 10 && !hasReferences) {
    return NextResponse.json(
      { error: "Provide a SOW/task description or at least one reference file, URL, or note." },
      { status: 400 }
    );
  }
  const store = getStore();
  const run = store.createRun({
    projectName: String(form?.get("projectName") ?? jsonBody?.projectName ?? "").trim() || "Local Project",
    repoPath: String(form?.get("repoPath") ?? jsonBody?.repoPath ?? "").trim(),
    title: String(form?.get("title") ?? jsonBody?.title ?? "").trim() || "Untitled Forge run",
    inputType: "sow",
    rawInput,
    referenceNotes,
    allowWebSearch:
      String(form?.get("allowWebSearch") ?? jsonBody?.allowWebSearch ?? "false") === "true"
  });

  if (referenceNotes) {
    store.addArtifact({
      runId: run.id,
      type: "reference",
      path: `notes:${run.id}`,
      label: "Reference notes",
      metadata: { kind: "notes", text: referenceNotes }
    });
  }

  for (const url of parseReferenceUrls(referenceUrls)) {
    store.addArtifact({
      runId: run.id,
      type: "reference",
      path: url,
      label: url,
      metadata: { kind: "url", url }
    });
  }

  const clonedReferences = cloneSourceFileReferences(store, sourceRunId, run.id);

  const referenceDir = path.join(findWorkspaceRoot(process.cwd()), "artifacts", "runs", run.id, "references");
  await mkdir(referenceDir, { recursive: true });
  for (const file of files) {
    if (file.size === 0) continue;
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: `${file.name} is larger than the 25MB reference limit.` }, { status: 400 });
    }
    const fileName = sanitizeFileName(file.name || "reference");
    const targetPath = path.join(referenceDir, `${Date.now()}-${fileName}`);
    await writeFile(targetPath, Buffer.from(await file.arrayBuffer()));
    store.addArtifact({
      runId: run.id,
      type: "reference",
      path: targetPath,
      label: file.name || fileName,
      metadata: { kind: "file", fileName: file.name, mimeType: file.type, size: file.size }
    });
  }

  store.addAgentMessage({
    runId: run.id,
    agent: "Dashboard",
    level: "info",
    message: `Run created with ${files.length + clonedReferences} uploaded references, ${parseReferenceUrls(referenceUrls).length} URL references, and web search ${
      run.allowWebSearch ? "enabled" : "disabled"
    }.`
  });
  return NextResponse.json({ run }, { status: 201 });
}

function cloneSourceFileReferences(store: ReturnType<typeof getStore>, sourceRunId: string, nextRunId: string): number {
  if (!sourceRunId) return 0;
  let count = 0;
  for (const artifact of store.listArtifacts(sourceRunId)) {
    if (artifact.type !== "reference" || artifact.metadata?.kind !== "file") continue;
    store.addArtifact({
      runId: nextRunId,
      type: "reference",
      path: artifact.path,
      label: artifact.label,
      metadata: {
        ...artifact.metadata,
        clonedFromRunId: sourceRunId,
        clonedFromArtifactId: artifact.id
      }
    });
    count += 1;
  }
  return count;
}

function parseReferenceUrls(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => /^https?:\/\//i.test(item))
    )
  );
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 120) || "reference";
}

function findWorkspaceRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}
