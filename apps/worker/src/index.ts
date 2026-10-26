import path from "node:path";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { getStore, type Run, type Ticket } from "@forge/core";
import {
  parseScope,
  reviewerDecision,
  runTicketChecks,
  writeArchitectureDocs
} from "@forge/agents";
import { branchNameForRun, isGitRepo, prepareBranch, preparePrBody } from "@forge/git";
import { collectReferenceContext, prepareGithubPr, prepareVercelPreview } from "@forge/integrations";
import { detectProjectCommands, isProjectRoot, resolveWorkspacePath } from "@forge/project-runner";

const pollMs = Number(process.env.FORGE_WORKER_POLL_MS ?? 4000);
const store = getStore();
const forgeRoot = findWorkspaceRoot(process.cwd());

async function processQueuedRuns(): Promise<void> {
  const runs = store.listRuns().filter((run) => run.status === "queued" || run.status === "paused");
  for (const run of runs) {
    await processRun(run);
  }
}

async function processRun(run: Run): Promise<void> {
  const project = store.getProject(run.projectId);
  if (!project) return;
  store.updateRun(run.id, { status: "planning" });
  store.addAgentMessage({
    runId: run.id,
    agent: "Worker",
    level: "info",
    message: `Starting run for ${project.name}.`
  });

  const referenceContext = await collectReferenceContext({
    store,
    runId: run.id,
    rawInput: run.rawInput,
    allowWebSearch: run.allowWebSearch
  });
  const repoPaths = resolveTargetRepoPaths(project.repoPath, run.referenceNotes ?? "", run.id);
  const scopedInput = [run.rawInput, run.referenceNotes, referenceContext]
    .filter((part) => part && part.trim().length > 0)
    .join("\n\nReference Context:\n");
  const parsed = parseScope(scopedInput, run.id);
  const tickets = store.upsertTickets(
    run.id,
    parsed.tickets.map((ticket) => ({ ...ticket, status: "queued" }))
  );
  store.addAgentMessage({
    runId: run.id,
    agent: "ScopeParserAgent",
    level: "decision",
    message: `Parsed ${parsed.features.length} features into ${tickets.length} tickets.`,
    metadata: { features: parsed.features }
  });

  const docsTarget =
    repoPaths.length === 1 && repoPaths[0]
      ? repoPaths[0]
      : path.join(forgeRoot, "artifacts", "runs", run.id, "reports");
  const writtenDocs = writeArchitectureDocs(docsTarget, parsed);
  for (const docPath of writtenDocs) {
    store.addArtifact({
      runId: run.id,
      type: "document",
      path: docPath,
      label: path.basename(docPath),
      metadata: { generatedBy: "ArchitectAgent" }
    });
  }
  store.addAgentMessage({
    runId: run.id,
    agent: "ArchitectAgent",
    level: "info",
    message: `Architecture documents written to ${docsTarget}.`
  });

  store.updateRun(run.id, { status: "running" });
  for (const repoPath of repoPaths.filter((item) => isGitRepo(item))) {
    await prepareBranch({
      store,
      runId: run.id,
      repoPath,
      branchName: branchNameForRun(run.id, tickets[0]?.title)
    });
  }

  const runnableRepos = repoPaths.filter((repoPath) => detectProjectCommands(repoPath).length > 0);
  if (repoPaths.length === 0 || runnableRepos.length === 0) {
    for (const ticket of tickets) store.updateTicketStatus(ticket.id, "blocked");
    store.updateRun(run.id, {
      status: "failed",
      summary:
        repoPaths.length === 0
          ? "No executable local project roots were found."
          : "Project roots were found, but none exposed known local check commands."
    });
    store.addAgentMessage({
      runId: run.id,
      agent: "Worker",
      level: "error",
      message:
        repoPaths.length === 0
          ? "No executable project roots found. Provide the actual mobile/web repo path or a parent folder containing package.json/pubspec.yaml projects."
          : `No local check commands found in detected project roots: ${repoPaths.join(", ")}`
    });
    return;
  }

  const implementation = await runCodexImplementation({
    run,
    parsed,
    tickets,
    repoPaths,
    docsTarget,
    referenceContext
  });
  if (!implementation.passed || implementation.changedFiles.length === 0) {
    for (const ticket of tickets) store.updateTicketStatus(ticket.id, implementation.passed ? "blocked" : "failed");
    store.updateRun(run.id, {
      status: "failed",
      summary: implementation.passed
        ? "Codex implementation finished but did not change any target repo files."
        : "Codex implementation failed before local checks could run."
    });
    store.addAgentMessage({
      runId: run.id,
      agent: "BuilderAgent",
      level: "error",
      message: implementation.passed
        ? "Implementation step produced no target repo changes, so the run was not marked complete."
        : "Implementation step failed. Inspect the Codex command log for stderr/stdout."
    });
    return;
  }

  const changeReportPath = path.join(forgeRoot, "artifacts", "runs", run.id, "reports", "changed-files.md");
  mkdirSync(path.dirname(changeReportPath), { recursive: true });
  writeFileSync(changeReportPath, `# Changed Files\n\n${implementation.changedFiles.map((file) => `- ${file}`).join("\n")}\n`);
  store.addArtifact({
    runId: run.id,
    type: "report",
    path: changeReportPath,
    label: "Changed files",
    metadata: { generatedBy: "BuilderAgent", changedFileCount: implementation.changedFiles.length }
  });

  let checksPassed = true;
  const checkTicketId = tickets[0]?.id;
  for (const repoPath of runnableRepos) {
    store.addAgentMessage({
      runId: run.id,
      agent: "TestAgent",
      level: "info",
      message: `Running local checks in ${repoPath}.`
    });
    const repoPassed = await runTicketChecks({ store, runId: run.id, ticketId: checkTicketId ?? run.id, repoPath });
    if (!repoPassed) checksPassed = false;
  }

  if (!checksPassed) {
    for (const ticket of tickets) store.updateTicketStatus(ticket.id, "failed");
    store.updateRun(run.id, { status: "failed", summary: "Implementation completed, but one or more local checks failed." });
    store.addAgentMessage({
      runId: run.id,
      agent: "TestAgent",
      level: "error",
      message: "Checks failed after implementation. The target repo changes were left in place for inspection."
    });
    return;
  }

  for (const ticket of tickets) {
    store.updateRun(run.id, { currentTicketId: ticket.id });
    store.updateTicketStatus(ticket.id, "review");
    store.addAgentMessage({
      runId: run.id,
      agent: "BuilderAgent",
      level: "info",
      message: `Implementation completed for ticket scope: ${ticket.title}`,
      metadata: { changedFiles: implementation.changedFiles.slice(0, 50) }
    });

    const review = reviewerDecision(ticket);
    store.addAgentMessage({
      runId: run.id,
      agent: "ReviewerAgent",
      level: review.approved ? "decision" : "warn",
      message: review.approved ? `Reviewed ticket: ${ticket.title}` : `Ticket needs human review: ${ticket.title}`,
      metadata: { notes: review.notes }
    });
    store.updateTicketStatus(ticket.id, review.approved ? "done" : "blocked");
  }

  const prBody = preparePrBody({
    summary: parsed.features,
    acceptanceCriteria: tickets.flatMap((ticket) => ticket.acceptanceCriteria).slice(0, 12),
    tests: ["pnpm lint", "pnpm typecheck", "pnpm test", "pnpm build", "pnpm playwright test"],
    visualQaViewports: ["mobile-small", "mobile-large", "tablet", "laptop", "desktop", "wide"]
  });
  const reportPath = path.join(forgeRoot, "artifacts", "runs", run.id, "reports", "final-report.md");
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    `# Final Report

## Run
${run.title}

## Features
${parsed.features.map((feature) => `- ${feature}`).join("\n")}

## References
${referenceContext ? referenceContext.slice(0, 4000) : "No additional reference context collected."}

## Tickets
${tickets.map((ticket) => `- ${ticket.title}: review`).join("\n")}

## Prepared PR
${prepareGithubPr({ title: run.title, body: prBody }).body}
`
  );
  store.addArtifact({
    runId: run.id,
    type: "report",
    path: reportPath,
    label: "Final report",
    metadata: { generatedBy: "Worker" }
  });

  if (process.env.FORGE_PREPARE_VERCEL_PREVIEW === "1") {
    prepareVercelPreview({ store, runId: run.id, projectPath: repoPaths[0] ?? docsTarget });
  } else {
    store.addAgentMessage({
      runId: run.id,
      agent: "DeploymentAgent",
      level: "info",
      message: "Preview deployment not requested. Production deployment was not executed."
    });
  }

  store.updateRun(run.id, {
    status: process.env.FORGE_PREPARE_VERCEL_PREVIEW === "1" ? "approval_required" : "completed",
    summary: `Parsed ${parsed.features.length} features and prepared ${tickets.length} tickets.`
  });
}

type ParsedForImplementation = ReturnType<typeof parseScope>;

async function runCodexImplementation(input: {
  run: Run;
  parsed: ParsedForImplementation;
  tickets: Ticket[];
  repoPaths: string[];
  docsTarget: string;
  referenceContext: string;
}): Promise<{ passed: boolean; changedFiles: string[] }> {
  const before = await snapshotRepos(input.repoPaths);
  const prompt = buildCodexPrompt(input);
  const command = resolveCodexBinary();
  const workingRoot = commonParent(input.repoPaths);
  if (!command) {
    store.addAgentMessage({
      runId: input.run.id,
      agent: "BuilderAgent",
      level: "error",
      message:
        "Codex CLI was not found in the worker PATH. Set FORGE_CODEX_BIN or install the Codex CLI where the worker can execute it."
    });
    store.addCommand({
      runId: input.run.id,
      ticketId: input.tickets[0]?.id,
      command: "codex --search exec --json <implementation-prompt-stdin>",
      cwd: workingRoot,
      policyLevel: "safe_local",
      status: "failed",
      stdout: "",
      stderr: "Codex CLI was not found. Set FORGE_CODEX_BIN to the full path of the codex executable.",
      durationMs: 0,
      completedAt: new Date().toISOString()
    });
    return { passed: false, changedFiles: [] };
  }
  const args = [
    ...(input.run.allowWebSearch ? ["--search"] : []),
    "exec",
    "--json",
    "--cd",
    workingRoot,
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox"
  ];
  const started = Date.now();
  const commandLog = store.addCommand({
    runId: input.run.id,
    ticketId: input.tickets[0]?.id,
    command: `codex${input.run.allowWebSearch ? " --search" : ""} exec --json --cd ${workingRoot} --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox <implementation-prompt-stdin>`,
    cwd: workingRoot,
    policyLevel: "safe_local",
    status: "running",
    stdout: "",
    stderr: ""
  });

  store.addAgentMessage({
    runId: input.run.id,
    agent: "BuilderAgent",
    level: "info",
    message: `Starting Codex implementation across ${input.repoPaths.length} repo root(s).`,
    metadata: { codexBinary: command }
  });

  const progressState = { lastOutputAt: Date.now(), changedFiles: new Set<string>() };
  const progressTimer = setInterval(() => {
    const changedFiles = readChangedFiles(input.repoPaths);
    const newFiles = changedFiles.filter((file) => !progressState.changedFiles.has(file));
    for (const file of changedFiles) progressState.changedFiles.add(file);
    if (newFiles.length > 0) {
      store.addAgentMessage({
        runId: input.run.id,
        agent: "BuilderAgent",
        level: "info",
        message: `Codex changed ${newFiles.length} file(s): ${newFiles.slice(0, 8).join(", ")}${newFiles.length > 8 ? " ..." : ""}`,
        metadata: { changedFiles: newFiles.slice(0, 50) }
      });
    } else if (Date.now() - progressState.lastOutputAt > 180_000) {
      progressState.lastOutputAt = Date.now();
      store.addAgentMessage({
        runId: input.run.id,
        agent: "BuilderAgent",
        level: "info",
        message: `Codex is still running after ${formatDuration(Date.now() - started)}. No new output or file changes in the last few minutes.`
      });
    }
  }, 20_000);

  const result = await runProcess({
    command,
    args,
    cwd: workingRoot,
    timeoutMs: Number(process.env.FORGE_CODEX_TIMEOUT_MS ?? 3_600_000),
    stdin: prompt,
    onOutput: (stream, output, stdout, stderr) => {
      progressState.lastOutputAt = Date.now();
      store.updateCommand(commandLog.id, {
        stdout: stdout.slice(-60_000),
        stderr: stderr.slice(-60_000),
        durationMs: Date.now() - started
      });
      const summary = summarizeCodexOutput(output, stream);
      if (summary) {
        store.addAgentMessage({
          runId: input.run.id,
          agent: "BuilderAgent",
          level: stream === "stderr" ? "warn" : "info",
          message: summary
        });
      }
    }
  });
  clearInterval(progressTimer);
  store.updateCommand(commandLog.id, {
    status: result.exitCode === 0 && !result.timedOut ? "completed" : "failed",
    exitCode: result.exitCode,
    stdout: result.stdout.slice(-60_000),
    stderr: result.stderr.slice(-60_000),
    durationMs: Date.now() - started,
    completedAt: new Date().toISOString()
  });

  const after = await snapshotRepos(input.repoPaths);
  const changedFiles = changedRepoFiles(before, after);
  store.addAgentMessage({
    runId: input.run.id,
    agent: "BuilderAgent",
    level: result.exitCode === 0 && !result.timedOut && changedFiles.length > 0 ? "info" : "warn",
    message: `Codex implementation finished with ${changedFiles.length} changed target file(s).`,
    metadata: { changedFiles: changedFiles.slice(0, 100) }
  });
  return { passed: result.exitCode === 0 && !result.timedOut, changedFiles };
}

function buildCodexPrompt(input: {
  run: Run;
  parsed: ParsedForImplementation;
  tickets: Ticket[];
  repoPaths: string[];
  docsTarget: string;
  referenceContext: string;
}): string {
  const tickets = input.tickets
    .map((ticket, index) => {
      return `${index + 1}. ${ticket.title}
Description: ${ticket.description}
Acceptance criteria:
${ticket.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}
Tests:
${ticket.testRequirements.map((test) => `- ${test}`).join("\n")}`;
    })
    .join("\n\n");

  return `You are Codex acting as a senior full-stack engineer.

Work inside these existing target repos:
${input.repoPaths.map((repoPath) => `- ${repoPath}`).join("\n")}

Run title:
${input.run.title}

User request:
${input.run.rawInput}

Reference notes:
${input.run.referenceNotes ?? "None"}

Collected reference context:
${input.referenceContext.slice(0, 35_000) || "None"}

Generated planning docs are in:
${input.docsTarget}

Tickets to implement:
${tickets}

Implementation rules:
- Inspect the existing repos first and preserve useful work.
- Do not wipe or restart either repo.
- Implement real code changes in the target repos, not only reports or plans.
- The customer surface is the native/mobile app; the staff/admin surface is the web app.
- Use local/mock providers for paid or credentialed services.
- Do not hardcode secrets, contact customers, deploy to production, or incur paid external API/vector/AI usage.
- Add or update tests/docs where practical.
- Run the relevant local checks before finishing if they are available.
- If a scope item is impossible locally, leave a concise TODO or known limitation in the appropriate repo documentation, but still implement the local structure/placeholders.
`;
}

async function snapshotRepos(repoPaths: string[]): Promise<Map<string, string>> {
  const snapshots = new Map<string, string>();
  for (const repoPath of repoPaths) {
    if (!isGitRepo(repoPath)) continue;
    const status = await runProcess({ command: "git", args: ["status", "--porcelain=v1", "-uall"], cwd: repoPath, timeoutMs: 30_000 });
    const diff = await runProcess({ command: "git", args: ["diff", "--binary", "HEAD", "--"], cwd: repoPath, timeoutMs: 120_000 });
    snapshots.set(repoPath, hash(`${status.stdout}\n${diff.stdout}`));
  }
  return snapshots;
}

function changedRepoFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed: string[] = [];
  for (const [repoPath, afterHash] of after) {
    if (before.get(repoPath) === afterHash) continue;
    const statusOutput = readGitStatus(repoPath);
    for (const line of statusOutput.split(/\r?\n/).filter(Boolean)) {
      const filePath = `${repoPath}/${line.slice(3).trim()}`;
      if (isReportableChangedFile(filePath)) changed.push(filePath);
    }
  }
  return Array.from(new Set(changed)).sort();
}

function readChangedFiles(repoPaths: string[]): string[] {
  const changed: string[] = [];
  for (const repoPath of repoPaths) {
    if (!isGitRepo(repoPath)) continue;
    const statusOutput = readGitStatus(repoPath);
    for (const line of statusOutput.split(/\r?\n/).filter(Boolean)) {
      const filePath = `${repoPath}/${line.slice(3).trim()}`;
      if (isReportableChangedFile(filePath)) changed.push(filePath);
    }
  }
  return Array.from(new Set(changed)).sort();
}

function isReportableChangedFile(filePath: string): boolean {
  return !/(^|\/)(\.next|node_modules|build|dist|coverage|\.dart_tool|Pods|DerivedData|\.turbo|\.cache)(\/|$)/.test(filePath);
}

function readGitStatus(repoPath: string): string {
  try {
    const result = execFileSync("git", ["status", "--porcelain=v1", "-uall"], {
      cwd: repoPath,
      encoding: "utf8"
    }) as string;
    return result;
  } catch {
    return "";
  }
}

function runProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  stdin?: string;
  onOutput?: (stream: "stdout" | "stderr", output: string, stdout: string, stderr: string) => void;
}): Promise<{ exitCode?: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { exitCode?: number; stdout: string; stderr: string; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: [input.stdin ? "pipe" : "ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);

    if (input.stdin && child.stdin) {
      child.stdin.end(input.stdin);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      const output = chunk.toString();
      stdout += output;
      input.onOutput?.("stdout", output, stdout, stderr);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const output = chunk.toString();
      stderr += output;
      input.onOutput?.("stderr", output, stdout, stderr);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      finish({ stdout, stderr: `${stderr}\n${error.message}`, timedOut, exitCode: 127 });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      finish({
        exitCode: code ?? undefined,
        stdout,
        stderr: timedOut ? `${stderr}\nCommand timed out after ${input.timeoutMs}ms.` : stderr,
        timedOut
      });
    });
  });
}

function summarizeCodexOutput(output: string, stream: "stdout" | "stderr"): string | undefined {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");
  const lines = output
    .replace(ansiPattern, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonSummaries = lines.map(summarizeCodexJsonLine).filter(Boolean);
  if (jsonSummaries.length > 0) return `Codex event: ${jsonSummaries.slice(-4).join(" | ")}`;

  const relevantLines = lines.filter((line) => !isNoisyCodexLine(line));
  if (relevantLines.length === 0) return undefined;

  if (stream === "stdout") return undefined;

  const clean = relevantLines
    .slice(-6)
    .join(" | ")
    .replace(/\s+/g, " ")
    .slice(0, 500);
  if (!clean) return undefined;
  return `Codex warning: ${clean}`;
}

function summarizeCodexJsonLine(line: string): string | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const type = firstString(record.type, record.event, record.kind, record.name);
    const itemType = nestedString(record, ["item", "type"]);
    if (type === "item.started" || type === "item.completed") {
      const command = nestedString(record, ["item", "command"]);
      if (itemType === "command_execution" && command) return `ran command ${summarizeCommand(command)}`;
      const text = firstString(
        nestedString(record, ["item", "text"]),
        nestedString(record, ["item", "content"]),
        nestedContentText(record)
      );
      return text ? text.slice(0, 500) : undefined;
    }

    const message = firstString(
      record.message,
      record.msg,
      record.status,
      record.summary,
      nestedString(record, ["item", "text"]),
      nestedString(record, ["item", "content"]),
      nestedString(record, ["delta", "text"]),
      nestedString(record, ["delta", "content"])
    );
    if (!message || looksLikeCodeDump(message)) return undefined;
    return [type, message].filter(Boolean).join(": ").slice(0, 500) || undefined;
  } catch {
    return undefined;
  }
}

function isNoisyCodexLine(line: string): boolean {
  return (
    line.includes("codex_core_plugins::manifest") ||
    line.includes("ignoring interface.defaultPrompt") ||
    line.includes("/.codex/.tmp/plugins/") ||
    looksLikeCodeDump(line)
  );
}

function looksLikeCodeDump(value: string): boolean {
  const text = value.trim();
  if (text.length > 700) return true;
  const codeSignals = [
    /import\s+.+\s+from\s+['"]/,
    /export\s+(function|const|type|interface|\{)/,
    /className=/,
    /\{[\s\S]*\}\s*;?$/,
    /=>\s*\(/,
    /<\/?[A-Za-z][^>]*>/
  ];
  return codeSignals.filter((pattern) => pattern.test(text)).length >= 2;
}

function summarizeCommand(command: string): string {
  return command.replace(/\s+/g, " ").slice(0, 180);
}

function nestedContentText(value: Record<string, unknown>): string | undefined {
  const item = value.item;
  if (!item || typeof item !== "object") return undefined;
  const content = (item as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((part) => {
      if (!part || typeof part !== "object") return undefined;
      const record = part as Record<string, unknown>;
      return firstString(record.text, record.content);
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function nestedString(value: Record<string, unknown>, pathParts: string[]): string | undefined {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function commonParent(paths: string[]): string {
  if (paths.length === 0) return forgeRoot;
  const parts = paths.map((item) => path.resolve(item).split(path.sep));
  const first = parts[0] ?? [];
  const shared: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    if (parts.every((part) => part[index] === first[index])) shared.push(first[index] ?? "");
    else break;
  }
  return shared.length <= 1 ? path.sep : shared.join(path.sep) || path.sep;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveCodexBinary(): string | undefined {
  const explicit = process.env.FORGE_CODEX_BIN?.trim();
  if (explicit && existsSync(resolveWorkspacePath(explicit))) return resolveWorkspacePath(explicit);

  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, "codex");
    if (existsSync(candidate)) return candidate;
  }

  const extensionRoot = path.join(process.env.HOME ?? "", ".vscode", "extensions");
  let extensionNames: string[] = [];
  try {
    extensionNames = readdirSync(extensionRoot)
      .filter((entry) => entry.startsWith("openai.chatgpt-"))
      .sort()
      .reverse();
  } catch {
    return undefined;
  }

  const platformDirs = ["macos-aarch64", "macos-x64", "linux-x64", "linux-aarch64"];
  for (const extensionName of extensionNames) {
    for (const platformDir of platformDirs) {
      const candidate = path.join(extensionRoot, extensionName, "bin", platformDir, "codex");
      if (existsSync(candidate)) return candidate;
    }
  }

  return undefined;
}

function resolveTargetRepoPaths(repoPath: string, referenceNotes: string, runId: string): string[] {
  const candidates = [
    ...extractAbsolutePaths(referenceNotes),
    ...(repoPath.trim() ? [repoPath.trim()] : [])
  ];
  const resolved = new Set<string>();

  for (const candidate of candidates) {
    const direct = resolveTargetCandidate(candidate, runId);
    if (!direct) continue;
    for (const projectRoot of discoverProjectRoots(direct)) {
      resolved.add(projectRoot);
    }
  }

  const roots = Array.from(resolved).filter((root) => root !== forgeRoot);
  if (roots.length > 0) {
    store.addAgentMessage({
      runId,
      agent: "Worker",
      level: "info",
      message: `Detected ${roots.length} executable project root(s): ${roots.join(", ")}`
    });
  }
  return roots;
}

function resolveTargetCandidate(repoPath: string, runId: string): string | undefined {
  const raw = repoPath.trim();
  if (!raw) {
    store.addAgentMessage({
      runId,
      agent: "Worker",
      level: "warn",
      message: "No local repo path was provided. Forge Agent will keep generated documents in artifacts and skip target-repo checks."
    });
    return undefined;
  }

  if (/YOUR_|\/path\/to\/repo|YOUR_MAC_USERNAME/i.test(raw)) {
    store.addAgentMessage({
      runId,
      agent: "Worker",
      level: "warn",
      message: `Repo path looks like a placeholder, so target-repo execution was skipped: ${raw}`
    });
    return undefined;
  }

  const resolved = path.resolve(resolveWorkspacePath(raw));
  if (resolved === forgeRoot) {
    store.addAgentMessage({
      runId,
      agent: "Worker",
      level: "warn",
      message: "Refusing to use the Forge Agent control repo as the target project. Provide the actual client repo path in New Run."
    });
    return undefined;
  }

  if (!existsSync(resolved)) {
    store.addAgentMessage({
      runId,
      agent: "Worker",
      level: "warn",
      message: `Target repo path does not exist, so target-repo execution was skipped: ${resolved}`
    });
    return undefined;
  }

  return resolved;
}

function discoverProjectRoots(candidate: string): string[] {
  if (isProjectRoot(candidate)) return [candidate];

  const roots: string[] = [];
  for (const child of walkDirectories(candidate, 2)) {
    if (isProjectRoot(child)) roots.push(child);
  }
  return roots;
}

function walkDirectories(root: string, maxDepth: number): string[] {
  const results: string[] = [];
  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (["node_modules", ".next", "build", ".dart_tool", ".git"].includes(entry)) continue;
      const fullPath = path.join(current, entry);
      try {
        if (!statSync(fullPath).isDirectory()) continue;
      } catch {
        continue;
      }
      results.push(fullPath);
      walk(fullPath, depth + 1);
    }
  }
  walk(root, 1);
  return results;
}

function extractAbsolutePaths(text: string): string[] {
  return Array.from(new Set(text.match(/\/Users\/[^\s\r\n]+(?:\/[^\s\r\n]+)*/g) ?? []));
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

async function main(): Promise<void> {
  console.log("Forge Agent worker started.");
  await processQueuedRuns();
  if (process.env.FORGE_WORKER_ONCE === "1") return;
  setInterval(() => {
    processQueuedRuns().catch((error) => {
      console.error(error);
    });
  }, pollMs);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
