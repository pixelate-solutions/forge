import type { ApprovalActionType, ApprovalRequest, ForgeStore } from "@forge/core";

export function requestApproval(
  store: ForgeStore,
  input: {
    runId: string;
    title: string;
    description: string;
    actionType: ApprovalActionType;
    commandPreview?: string;
    riskLevel?: ApprovalRequest["riskLevel"];
    estimatedCostUsd?: number;
    affectedResources?: string[];
  }
): ApprovalRequest {
  store.updateRun(input.runId, { status: "approval_required" });
  store.addAgentMessage({
    runId: input.runId,
    agent: "ApprovalSystem",
    level: "warn",
    message: `Approval required: ${input.title}`,
    metadata: { actionType: input.actionType }
  });
  return store.addApprovalRequest({
    runId: input.runId,
    title: input.title,
    description: input.description,
    actionType: input.actionType,
    riskLevel: input.riskLevel ?? "medium",
    commandPreview: input.commandPreview,
    estimatedCostUsd: input.estimatedCostUsd,
    affectedResources: input.affectedResources ?? []
  });
}
