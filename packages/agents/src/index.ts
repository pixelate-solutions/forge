import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ForgeStore, ParsedScope, Ticket } from "@forge/core";
import { createId } from "@forge/core";
import { detectProjectCommands, SafeCommandRunner } from "@forge/project-runner";
import { runVisualQA } from "@forge/visual-qa";

const FEATURE_KEYWORDS = [
  "dashboard",
  "admin",
  "customer",
  "support",
  "ticket",
  "order",
  "schedule",
  "portal",
  "auth",
  "payment",
  "report",
  "notification",
  "ai"
];

export type AgentDefinition = {
  name: string;
  prompt: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  responsibilities: string[];
};

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    name: "Scope Parser Agent",
    prompt: "Parse product scope into features, tickets, acceptance criteria, dependencies, priorities, and testing needs.",
    inputSchema: { rawScope: "string", projectNotes: "string?", repoContext: "string?" },
    outputSchema: { features: "string[]", tickets: "Ticket[]" },
    responsibilities: ["Extract features", "Create ticket queue", "Estimate complexity", "Identify required screens and entities"]
  },
  {
    name: "Architect Agent",
    prompt: "Create architecture, data model, route, API, auth, permission, and implementation plans.",
    inputSchema: { tickets: "Ticket[]", repoAnalysis: "string?", preferences: "object?" },
    outputSchema: { architecturePlan: "string", dataModel: "string", implementationPlan: "string" },
    responsibilities: ["Write architecture docs", "Order implementation", "List risks"]
  },
  {
    name: "Builder Agent",
    prompt: "Implement one ticket at a time and only advance after tests and visual QA pass.",
    inputSchema: { ticket: "Ticket", architectureDocs: "string", repoContext: "string" },
    outputSchema: { changedFiles: "string[]", status: "done|blocked|failed" },
    responsibilities: ["Edit code", "Add states", "Run checks", "Commit passing changes"]
  }
];

export function parseScope(rawScope: string, runId = "preview"): ParsedScope {
  const lines = rawScope
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const numberedScope = extractNumberedScope(lines);
  const candidateLines = lines.filter((line) => {
    const normalized = line.toLowerCase();
    return (
      /^[-*#\d.]+\s+/.test(line) ||
      FEATURE_KEYWORDS.some((keyword) => normalized.includes(keyword))
    );
  });
  const seeds = numberedScope.length > 0 ? numberedScope : candidateLines.length > 0 ? candidateLines : lines.slice(0, 8);
  const titles = unique(
    seeds
      .map((line) => line.replace(/^[-*#\d.\s]+/, "").replace(/[:.]$/, ""))
      .filter((line) => line.length > 8)
      .slice(0, 16)
  );
  const fallbackTitles =
    titles.length > 0
      ? titles
      : [
          "Create product foundation",
          "Build primary dashboard",
          "Add tests and visual QA",
          "Prepare final report"
        ];

  const tickets = fallbackTitles.map((title, index) => {
    const lower = title.toLowerCase();
    const screenHints = [
      lower.includes("admin") ? "Admin dashboard" : undefined,
      lower.includes("customer") ? "Customer dashboard" : undefined,
      lower.includes("support") || lower.includes("ticket") ? "Support tickets" : undefined,
      lower.includes("schedule") ? "Production schedule" : undefined,
      lower.includes("order") ? "Order status" : undefined,
      lower.includes("ai") ? "AI support placeholder" : undefined
    ].filter(Boolean) as string[];
    return {
      id: createId(`t${index + 1}`),
      title: toTitle(title),
      description: `Implement and verify: ${title}. Source run: ${runId}.`,
      priority: numberedScope.length > 0 ? "V1" : index < 4 ? "V1" : index < 8 ? "V2" : "V3",
      acceptanceCriteria: [
        "Feature is visible in the application UI or documented as backend-only.",
        "Loading, empty, and error states are handled where relevant.",
        "Responsive behavior works on mobile, tablet, and desktop.",
        "No known console errors or failed network requests remain."
      ],
      dependencies: index === 0 ? [] : [fallbackTitles[Math.max(0, index - 1)] ?? "Project foundation"],
      filesLikelyTouched: inferFiles(lower),
      testRequirements: [
        "Run lint/typecheck/build commands when available.",
        "Add or update unit/integration tests for changed business logic."
      ],
      visualQaRequirements: [
        "Capture screenshots across the default viewport matrix.",
        "Check horizontal overflow, broken images, console errors, and core form/button usability."
      ],
      complexity: lower.includes("auth") || lower.includes("payment") || lower.includes("admin") ? "high" : "medium",
      requiredScreens: screenHints,
      requiredBackendEntities: inferEntities(lower),
      requiredIntegrations: lower.includes("github") || lower.includes("vercel") ? ["External deployment integration"] : []
    } satisfies ParsedScope["tickets"][number];
  });

  return {
    features: fallbackTitles.map(toTitle),
    tickets,
    architectureNotes: [
      "Use local-first development with SQLite state and filesystem artifacts.",
      "Keep production, billing, secret, and destructive operations behind approvals.",
      "Run visual QA in real browsers before closing UI tickets."
    ],
    risks: [
      "Pasted SOWs can be ambiguous; human review should validate ticket boundaries.",
      "External integrations remain gated until credentials and approvals are configured."
    ]
  };
}

function extractNumberedScope(lines: string[]): string[] {
  const startIndex = lines.findIndex((line) => /^(v1\s+scope|scope\s+to\s+complete|primary\s+objective)/i.test(line));
  const relevantLines = startIndex >= 0 ? lines.slice(startIndex) : lines;
  const stopPatterns = [/^important boundaries/i, /^execution process/i, /^definition of done/i, /^reference materials/i];
  const titles: string[] = [];

  for (const line of relevantLines) {
    if (titles.length > 0 && stopPatterns.some((pattern) => pattern.test(line))) break;
    const match = line.match(/^(\d{1,2})\.\s+(.+)$/);
    if (!match) continue;
    const title = match[2]
      ?.replace(/\s+[-–—]\s+.+$/, "")
      .replace(/[:.]$/, "")
      .trim();
    if (!title || title.length < 4) continue;
    if (/^(inspect|summarize|compare|create|work|write|run|fix|commit|produce)\b/i.test(title) && titles.length >= 8) continue;
    titles.push(title);
  }

  return unique(titles).slice(0, 20);
}

export function createArchitectureDocs(parsed: ParsedScope): Record<string, string> {
  const features = parsed.features.map((feature) => `- ${feature}`).join("\n");
  const tickets = parsed.tickets.map((ticket, index) => `${index + 1}. ${ticket.title}`).join("\n");
  return {
    "ARCHITECTURE.md": `# Architecture

Forge Agent generated this project plan from the submitted scope.

## Features
${features}

## Application Shape
- Local-first web application with a dashboard UI.
- SQLite stores project, run, ticket, command, artifact, visual QA, and approval state.
- Worker process executes agent loops and writes state back to the dashboard.
- Policy engine gates every command or external action.

## Risks
${parsed.risks.map((risk) => `- ${risk}`).join("\n")}
`,
    "IMPLEMENTATION_PLAN.md": `# Implementation Plan

## Ticket Order
${tickets}

## Quality Gates
- lint
- typecheck
- tests
- build
- Playwright visual QA
`,
    "DATA_MODEL.md": `# Data Model

## Core Entities
- Projects
- Runs
- Tickets
- Agent messages
- Commands
- Artifacts
- Visual QA results
- Test runs
- Approval requests
- Settings
- Secret references, never raw secret values
`
  };
}

export function writeArchitectureDocs(targetPath: string, parsed: ParsedScope): string[] {
  mkdirSync(targetPath, { recursive: true });
  const docs = createArchitectureDocs(parsed);
  const written: string[] = [];
  for (const [fileName, contents] of Object.entries(docs)) {
    const destination = path.join(targetPath, fileName);
    writeFileSync(destination, contents);
    written.push(destination);
  }
  return written;
}

export async function runTicketChecks(input: {
  store: ForgeStore;
  runId: string;
  ticketId: string;
  repoPath: string;
}): Promise<boolean> {
  const commands = detectProjectCommands(input.repoPath);
  if (commands.length === 0) {
    input.store.addAgentMessage({
      runId: input.runId,
      agent: "TestAgent",
      level: "warn",
      message: "No package.json test commands were detected."
    });
    return true;
  }
  const runner = new SafeCommandRunner(input.store);
  let passed = true;
  for (const command of commands) {
    const result = await runner.run({
      runId: input.runId,
      ticketId: input.ticketId,
      cwd: input.repoPath,
      command,
      timeoutMs: 180_000
    });
    if (result.status !== "completed") passed = false;
  }
  return passed;
}

export async function runFrontendVisualQA(input: {
  store: ForgeStore;
  runId: string;
  baseUrl: string;
  routes: string[];
  outputDir: string;
}): Promise<boolean> {
  const result = await runVisualQA({
    baseUrl: input.baseUrl,
    routes: input.routes,
    runId: input.runId,
    outputDir: input.outputDir
  });
  for (const item of result.results) {
    input.store.addVisualQAResult(item);
    input.store.addArtifact({
      runId: input.runId,
      type: "screenshot",
      path: item.screenshotPath,
      label: `${item.route} ${item.viewport}`,
      metadata: { route: item.route, viewport: item.viewport, passed: item.passed }
    });
  }
  return result.passed;
}

export function reviewerDecision(ticket: Ticket): { approved: boolean; notes: string[] } {
  const notes = [
    `Acceptance criteria listed: ${ticket.acceptanceCriteria.length}.`,
    `Test requirements listed: ${ticket.testRequirements.length}.`,
    `Visual QA requirements listed: ${ticket.visualQaRequirements.length}.`
  ];
  return {
    approved: ticket.acceptanceCriteria.length > 0 && ticket.testRequirements.length > 0,
    notes
  };
}

function inferFiles(lowerTitle: string): string[] {
  const files = ["app/", "components/", "tests/"];
  if (lowerTitle.includes("api") || lowerTitle.includes("support") || lowerTitle.includes("order")) {
    files.push("app/api/", "db/schema");
  }
  if (lowerTitle.includes("admin")) files.push("app/admin/");
  if (lowerTitle.includes("customer")) files.push("app/customer/");
  return unique(files);
}

function inferEntities(lowerTitle: string): string[] {
  return [
    lowerTitle.includes("customer") ? "Customer" : undefined,
    lowerTitle.includes("support") || lowerTitle.includes("ticket") ? "SupportTicket" : undefined,
    lowerTitle.includes("schedule") ? "ProductionSchedule" : undefined,
    lowerTitle.includes("order") ? "Order" : undefined,
    lowerTitle.includes("admin") ? "AdminUser" : undefined
  ].filter(Boolean) as string[];
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function toTitle(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function repoHasFrontend(repoPath: string): boolean {
  return existsSync(path.join(repoPath, "package.json")) && existsSync(path.join(repoPath, "app"));
}
