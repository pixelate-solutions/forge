import { existsSync } from "node:fs";
import path from "node:path";
import type { ForgeStore } from "@forge/core";
import { SafeCommandRunner } from "@forge/project-runner";

export function isGitRepo(repoPath: string): boolean {
  return existsSync(path.join(repoPath, ".git"));
}

export function branchNameForRun(runId: string, ticketTitle?: string): string {
  const slug = (ticketTitle ?? "run")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);
  return `forge/${runId.slice(0, 10)}-${slug}`;
}

export async function prepareBranch(input: {
  store: ForgeStore;
  runId: string;
  repoPath: string;
  branchName: string;
}): Promise<void> {
  if (!isGitRepo(input.repoPath)) {
    input.store.addAgentMessage({
      runId: input.runId,
      agent: "GitHelper",
      level: "warn",
      message: "Target path is not a git repository; branch creation skipped."
    });
    return;
  }
  const runner = new SafeCommandRunner(input.store);
  await runner.run({
    runId: input.runId,
    cwd: input.repoPath,
    command: `git checkout -b ${input.branchName}`,
    timeoutMs: 30_000
  });
}

export function preparePrBody(input: {
  summary: string[];
  acceptanceCriteria: string[];
  tests: string[];
  visualQaViewports: string[];
}): string {
  return `## Summary
${input.summary.map((item) => `- ${item}`).join("\n")}

## Acceptance Criteria Covered
${input.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}

## Tests
${input.tests.map((item) => `- ${item}`).join("\n")}

## Visual QA
Screenshots captured for:
${input.visualQaViewports.map((item) => `- ${item}`).join("\n")}

## Approval Notes
- No cost-incurring actions performed
- Production deploy not executed
`;
}
