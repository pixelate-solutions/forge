import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ForgeStore } from "@forge/core";
import { redactSecrets } from "@forge/core";
import { requestApproval } from "@forge/approvals";
import { PolicyEngine, policyEngine } from "@forge/policies";

export type CommandRunInput = {
  command: string;
  cwd: string;
  runId?: string;
  ticketId?: string;
  timeoutMs?: number;
};

export type CommandRunResult = {
  status: "completed" | "failed" | "blocked" | "approval_required";
  exitCode?: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export class SafeCommandRunner {
  constructor(
    private readonly store: ForgeStore,
    private readonly policy: PolicyEngine = policyEngine
  ) {}

  async run(input: CommandRunInput): Promise<CommandRunResult> {
    const decision = this.policy.classify({ kind: "command", command: input.command });
    const started = Date.now();
    const commandLog = this.store.addCommand({
      runId: input.runId,
      ticketId: input.ticketId,
      command: redactSecrets(input.command),
      cwd: input.cwd,
      policyLevel: decision.level,
      status:
        decision.level === "safe_local"
          ? "running"
          : decision.level === "needs_approval"
            ? "approval_required"
            : "blocked",
      stdout: "",
      stderr: ""
    });

    if (decision.level === "blocked") {
      const result: CommandRunResult = {
        status: "blocked",
        stdout: "",
        stderr: decision.reason,
        durationMs: Date.now() - started
      };
      this.store.updateCommand(commandLog.id, {
        status: "blocked",
        stderr: decision.reason,
        durationMs: result.durationMs,
        completedAt: new Date().toISOString()
      });
      return result;
    }

    if (decision.level === "needs_approval") {
      if (input.runId && decision.actionType) {
        requestApproval(this.store, {
          runId: input.runId,
          title: "Approve command execution",
          description: decision.reason,
          actionType: decision.actionType,
          riskLevel: decision.riskLevel,
          commandPreview: input.command,
          affectedResources: [input.cwd]
        });
      }
      const result: CommandRunResult = {
        status: "approval_required",
        stdout: "",
        stderr: decision.reason,
        durationMs: Date.now() - started
      };
      this.store.updateCommand(commandLog.id, {
        status: "approval_required",
        stderr: decision.reason,
        durationMs: result.durationMs,
        completedAt: new Date().toISOString()
      });
      return result;
    }

    return new Promise<CommandRunResult>((resolve) => {
      const child = spawn(input.command, {
        cwd: input.cwd,
        shell: true,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, input.timeoutMs ?? 120_000);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        const durationMs = Date.now() - started;
        const cleanStdout = redactSecrets(stdout);
        const cleanStderr = redactSecrets(
          timedOut ? `${stderr}\nCommand timed out after ${input.timeoutMs ?? 120_000}ms.` : stderr
        );
        const status = code === 0 && !timedOut ? "completed" : "failed";
        this.store.updateCommand(commandLog.id, {
          status,
          exitCode: code ?? undefined,
          stdout: cleanStdout.slice(-60_000),
          stderr: cleanStderr.slice(-60_000),
          durationMs,
          completedAt: new Date().toISOString()
        });
        resolve({
          status,
          exitCode: code ?? undefined,
          stdout: cleanStdout,
          stderr: cleanStderr,
          durationMs
        });
      });
    });
  }
}

export function detectPackageManager(projectPath: string): "pnpm" | "npm" | "yarn" | "bun" {
  if (existsSync(path.join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(projectPath, "bun.lockb")) || existsSync(path.join(projectPath, "bun.lock"))) return "bun";
  if (existsSync(path.join(projectPath, "yarn.lock"))) return "yarn";
  return "npm";
}

export function detectProjectCommands(projectPath: string): string[] {
  const packageJsonPath = path.join(projectPath, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const pm = detectPackageManager(projectPath);
    const scripts = packageJson.scripts ?? {};
    return ["lint", "typecheck", "test", "build"]
      .filter((scriptName) => scripts[scriptName])
      .map((scriptName) =>
        `${pm} ${scriptName === "test" && pm === "npm" ? "test" : `run ${scriptName}`}`.replace("pnpm run", "pnpm")
      );
  }

  if (existsSync(path.join(projectPath, "pubspec.yaml"))) {
    return ["flutter pub get", "flutter analyze", "flutter test"];
  }

  return [];
}

export function resolveWorkspacePath(repoPath: string): string {
  return repoPath.replace(/^~(?=$|\/|\\)/, process.env.HOME ?? "");
}

export function isProjectRoot(projectPath: string): boolean {
  return existsSync(path.join(projectPath, "package.json")) || existsSync(path.join(projectPath, "pubspec.yaml"));
}
