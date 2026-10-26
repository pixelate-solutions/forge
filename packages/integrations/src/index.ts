import type { ForgeStore } from "@forge/core";
import { requestApproval } from "@forge/approvals";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { policyEngine } from "@forge/policies";

export function prepareVercelPreview(input: { store: ForgeStore; runId: string; projectPath: string }) {
  return requestApproval(input.store, {
    runId: input.runId,
    title: "Approve Vercel preview deployment",
    description: "Forge Agent prepared a preview deployment command. It will not run until approved.",
    actionType: "preview_deploy",
    riskLevel: "medium",
    commandPreview: `cd ${input.projectPath} && vercel`,
    affectedResources: [input.projectPath]
  });
}

export function prepareGithubPr(input: { title: string; body: string }) {
  return {
    title: input.title,
    body: input.body,
    note: "Prepared locally. Pushing branches and opening PRs should still be reviewed before execution."
  };
}

export async function collectReferenceContext(input: {
  store: ForgeStore;
  runId: string;
  rawInput: string;
  allowWebSearch: boolean;
}): Promise<string> {
  const artifacts = input.store.listArtifacts(input.runId).filter((artifact) => artifact.type === "reference");
  const chunks: string[] = [];

  for (const artifact of artifacts) {
    const kind = String(artifact.metadata?.kind ?? "");
    if (kind === "notes") {
      chunks.push(`Reference notes:\n${String(artifact.metadata?.text ?? "").slice(0, 8000)}`);
      continue;
    }

    if (kind === "file") {
      chunks.push(readFileReference(artifact.path, String(artifact.metadata?.mimeType ?? ""), artifact.label));
      continue;
    }

    if (kind === "url") {
      if (!input.allowWebSearch) {
        chunks.push(`URL reference provided but not fetched because web search is disabled: ${artifact.path}`);
        continue;
      }
      const decision = policyEngine.classify({
        kind: "web_search",
        description: `Fetch user-provided reference URL ${artifact.path}`
      });
      if (decision.level !== "safe_local") {
        chunks.push(`URL reference was not fetched because policy returned ${decision.level}: ${decision.reason}`);
        continue;
      }
      chunks.push(await fetchUrlReference(artifact.path));
    }
  }

  if (input.allowWebSearch) {
    const query = buildSearchQuery(input.rawInput, chunks);
    const decision = policyEngine.classify({ kind: "web_search", description: `Search web for ${query}` });
    if (query && decision.level === "safe_local") chunks.push(await searchWebContext(query));
    if (query && decision.level !== "safe_local") {
      chunks.push(`Web search was not executed because policy returned ${decision.level}: ${decision.reason}`);
    }
  }

  const context = chunks.filter(Boolean).join("\n\n---\n\n").slice(0, 40_000);
  input.store.addAgentMessage({
    runId: input.runId,
    agent: "ReferenceCollector",
    level: "info",
    message: `Collected ${artifacts.length} saved references${input.allowWebSearch ? " with web context enabled" : ""}.`,
    metadata: { referenceCount: artifacts.length, webSearch: input.allowWebSearch }
  });
  return context;
}

function readFileReference(filePath: string, mimeType: string, label: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const isTextLike =
    mimeType.startsWith("text/") ||
    [".md", ".markdown", ".txt", ".json", ".csv", ".tsv", ".html", ".css", ".js", ".ts", ".tsx"].includes(extension);

  if (!existsSync(filePath)) return `Missing uploaded reference file: ${label}`;
  if (!isTextLike) return `Uploaded reference file available for manual/visual context: ${label} (${mimeType || extension || "unknown type"})`;

  const text = readFileSync(filePath, "utf8").slice(0, 16_000);
  return `Uploaded reference file: ${label}\n\n${text}`;
}

async function fetchUrlReference(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "ForgeAgent/0.1 local-reference-fetcher" }
    });
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const clean = contentType.includes("html") ? stripHtml(text) : text;
    return `Fetched URL reference: ${url}\nStatus: ${response.status}\n\n${clean.slice(0, 12_000)}`;
  } catch (error) {
    return `Could not fetch URL reference ${url}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function searchWebContext(query: string): Promise<string> {
  try {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "ForgeAgent/0.1 local-web-context" }
    });
    const json = (await response.json()) as {
      AbstractText?: string;
      Heading?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
    };
    const related = flattenRelatedTopics(json.RelatedTopics ?? [])
      .slice(0, 6)
      .map((item) => `- ${item.Text}${item.FirstURL ? ` (${item.FirstURL})` : ""}`)
      .join("\n");
    return `Web search context for: ${query}\n${json.Heading ? `Heading: ${json.Heading}\n` : ""}${
      json.AbstractText ? `Summary: ${json.AbstractText}\n` : ""
    }${related}`;
  } catch (error) {
    return `Web search failed for "${query}": ${error instanceof Error ? error.message : String(error)}`;
  }
}

function flattenRelatedTopics(
  topics: Array<{ Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string; FirstURL?: string }> }>
): Array<{ Text?: string; FirstURL?: string }> {
  const flattened: Array<{ Text?: string; FirstURL?: string }> = [];
  for (const topic of topics) {
    if ("Topics" in topic) {
      flattened.push(...(topic.Topics ?? []));
    } else if ("Text" in topic) {
      flattened.push(topic);
    }
  }
  return flattened.filter((topic) => topic.Text);
}

function buildSearchQuery(rawInput: string, chunks: string[]): string {
  const source = `${rawInput}\n${chunks.join("\n")}`
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return source.split(" ").slice(0, 12).join(" ");
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
