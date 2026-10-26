import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getStore } from "@forge/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxFileBytes = 250_000;
const maxFiles = 100;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const store = getStore();
  const details = store.getRunDetails(id);
  if (!details) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const projectRoot = details.project?.repoPath ? path.resolve(details.project.repoPath) : undefined;
  const files = getChangedFiles(details.messages)
    .filter((filePath) => isReadableSourceFile(filePath, projectRoot))
    .slice(0, maxFiles);

  const payload = await Promise.all(
    files.map(async (filePath) => {
      const stat = statSync(filePath);
      const tooLarge = stat.size > maxFileBytes;
      return {
        path: filePath,
        relativePath: projectRoot && filePath.startsWith(projectRoot) ? path.relative(projectRoot, filePath) : filePath,
        language: languageForPath(filePath),
        size: stat.size,
        truncated: tooLarge,
        content: tooLarge ? await readTruncated(filePath) : await readFile(filePath, "utf8")
      };
    })
  );

  return NextResponse.json({ files: payload });
}

function getChangedFiles(messages: Array<{ metadata?: Record<string, unknown> }>): string[] {
  const files = new Set<string>();
  for (const message of messages) {
    const changed = message.metadata?.changedFiles;
    if (!Array.isArray(changed)) continue;
    for (const item of changed) {
      if (typeof item === "string") files.add(item);
    }
  }
  return Array.from(files).filter(isReportableChangedFile).sort();
}

function isReadableSourceFile(filePath: string, projectRoot?: string): boolean {
  const resolved = path.resolve(filePath);
  if (!path.isAbsolute(resolved)) return false;
  if (projectRoot && !resolved.startsWith(projectRoot)) return false;
  if (!existsSync(resolved)) return false;
  try {
    const stat = statSync(resolved);
    return stat.isFile() && isTextLike(resolved);
  } catch {
    return false;
  }
}

function isTextLike(filePath: string): boolean {
  return [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".json",
    ".md",
    ".css",
    ".scss",
    ".html",
    ".dart",
    ".yaml",
    ".yml",
    ".env",
    ".txt",
    ".sql",
    ".prisma"
  ].includes(path.extname(filePath).toLowerCase());
}

async function readTruncated(filePath: string): Promise<string> {
  const text = await readFile(filePath, "utf8");
  return `${text.slice(0, maxFileBytes)}\n\n/* File truncated in Forge Code Review. */`;
}

function languageForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "ts",
    ".tsx": "tsx",
    ".js": "js",
    ".jsx": "jsx",
    ".json": "json",
    ".md": "md",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".dart": "dart",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".sql": "sql",
    ".prisma": "prisma"
  };
  return map[extension] ?? "text";
}

function isReportableChangedFile(filePath: string): boolean {
  return !/(^|\/)(\.next|node_modules|build|dist|coverage|\.dart_tool|Pods|DerivedData|\.turbo|\.cache)(\/|$)/.test(filePath);
}
