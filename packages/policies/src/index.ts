import type { ApprovalActionType, PolicyLevel } from "@forge/core";

export type PolicyDecision = {
  level: PolicyLevel;
  reason: string;
  actionType?: ApprovalActionType;
  riskLevel?: "low" | "medium" | "high" | "critical";
};

export type PolicyAction = {
  kind: "command" | "git" | "deployment" | "external_service" | "file" | "database" | "message" | "web_search";
  command?: string;
  description?: string;
  affectsProduction?: boolean;
  estimatedCostUsd?: number;
  modifiesSecrets?: boolean;
  sendsExternalMessage?: boolean;
};

const blockedCommandPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\s+\/(?:\s|$)/i, reason: "Refuses recursive deletion of root." },
  { pattern: /\brm\s+-rf\s+~(?:\s|$)/i, reason: "Refuses recursive deletion of the home directory." },
  { pattern: /^\s*sudo\b/i, reason: "Refuses privilege escalation." },
  { pattern: /\bchmod\s+-R\s+777\s+\/(?:\s|$)/i, reason: "Refuses unsafe recursive permissions on root." },
  { pattern: /\b(curl|wget)\b.+\|\s*(sh|bash|zsh)\b/i, reason: "Refuses piping remote scripts into a shell." },
  { pattern: /\baws\b.+\b(delete|terminate|destroy)\b/i, reason: "Refuses destructive AWS command." },
  { pattern: /\bterraform\s+destroy\b/i, reason: "Refuses terraform destroy." },
  { pattern: /\bdrop\s+database\b/i, reason: "Refuses database drop." },
  { pattern: /\bgit\s+push\b.+\b(main|master)\b/i, reason: "Refuses direct push to main/master." },
  { pattern: /\bgh\s+pr\s+merge\b/i, reason: "Refuses merging pull requests." }
];

const approvalCommandPatterns: Array<{
  pattern: RegExp;
  reason: string;
  actionType: ApprovalActionType;
  riskLevel: PolicyDecision["riskLevel"];
}> = [
  {
    pattern: /\bvercel\b.*--prod\b/i,
    reason: "Production deployment requires human approval.",
    actionType: "production_deploy",
    riskLevel: "critical"
  },
  {
    pattern: /\bvercel\b(?!.*--prod)/i,
    reason: "Preview deployment requires approval by default.",
    actionType: "preview_deploy",
    riskLevel: "medium"
  },
  {
    pattern: /\b(docker|fly|railway|render|aws|gcloud|az)\b.+\b(deploy|create|apply|run)\b/i,
    reason: "Cloud or external service action requires approval.",
    actionType: "paid_resource",
    riskLevel: "high"
  },
  {
    pattern: /\b(prisma|drizzle|sequelize)\b.+\b(migrate|push|deploy)\b/i,
    reason: "Database migration requires approval unless explicitly local.",
    actionType: "database_migration",
    riskLevel: "high"
  },
  {
    pattern: /\b(dig|route53|cloudflare)\b.+\b(update|create|delete|set)\b/i,
    reason: "DNS changes require approval.",
    actionType: "dns_change",
    riskLevel: "critical"
  }
];

const safeCommandPatterns = [
  /^\s*pnpm\s+(install|lint|typecheck|test|build|dev|playwright|exec|dlx)\b/i,
  /^\s*npm\s+(install|run|test|exec)\b/i,
  /^\s*yarn\s+(install|lint|test|build|dev)\b/i,
  /^\s*bun\s+(install|run|test)\b/i,
  /^\s*git\s+(status|diff|checkout|switch|branch|add|commit|log|show|worktree|rev-parse)\b/i,
  /^\s*node\b/i,
  /^\s*tsx\b/i,
  /^\s*npx\s+playwright\b/i,
  /^\s*flutter\s+(pub\s+get|analyze|test)\b/i,
  /^\s*dart\s+(analyze|test)\b/i
];

export class PolicyEngine {
  classify(action: PolicyAction): PolicyDecision {
    if (action.modifiesSecrets) {
      return {
        level: "needs_approval",
        reason: "Secret reference or environment mutation requires approval.",
        actionType: "secret_change",
        riskLevel: "critical"
      };
    }

    if (action.sendsExternalMessage) {
      return {
        level: "needs_approval",
        reason: "External customer communication requires approval.",
        actionType: "external_message",
        riskLevel: "high"
      };
    }

    if (action.affectsProduction) {
      return {
        level: "needs_approval",
        reason: "Production-affecting action requires approval.",
        actionType: "production_deploy",
        riskLevel: "critical"
      };
    }

    if ((action.estimatedCostUsd ?? 0) > 0) {
      return {
        level: "needs_approval",
        reason: "Cost-incurring action requires approval.",
        actionType: "paid_resource",
        riskLevel: "high"
      };
    }

    if (action.command) {
      return this.classifyCommand(action.command);
    }

    if (action.kind === "web_search") {
      return {
        level: "safe_local",
        reason: "User-enabled external research request with no spending, credential, production, or destructive effect."
      };
    }

    if (action.kind === "file" || action.kind === "git") {
      return { level: "safe_local", reason: "Local development action." };
    }

    return {
      level: "needs_approval",
      reason: "Unknown or external action requires approval.",
      actionType: "paid_resource",
      riskLevel: "medium"
    };
  }

  classifyCommand(command: string): PolicyDecision {
    for (const blocked of blockedCommandPatterns) {
      if (blocked.pattern.test(command)) return { level: "blocked", reason: blocked.reason };
    }

    for (const approval of approvalCommandPatterns) {
      if (approval.pattern.test(command)) {
        if (/\b(local|localhost|127\.0\.0\.1|sqlite|dev)\b/i.test(command) && approval.actionType === "database_migration") {
          return { level: "safe_local", reason: "Local database migration command." };
        }
        return {
          level: "needs_approval",
          reason: approval.reason,
          actionType: approval.actionType,
          riskLevel: approval.riskLevel
        };
      }
    }

    if (safeCommandPatterns.some((pattern) => pattern.test(command))) {
      return { level: "safe_local", reason: "Allowed local project command." };
    }

    return {
      level: "needs_approval",
      reason: "Command is not on the safe local allow-list.",
      actionType: "destructive_action",
      riskLevel: "medium"
    };
  }
}

export const policyEngine = new PolicyEngine();
