import type {
  AgentMessage,
  ApprovalRequest,
  Artifact,
  CommandLog,
  ForgeSettings,
  Project,
  Run,
  Ticket,
  VisualQAResult
} from "@forge/core";

export type RunDetails = {
  run: Run;
  project?: Project;
  tickets: Ticket[];
  messages: AgentMessage[];
  commands: CommandLog[];
  approvals: ApprovalRequest[];
  artifacts: Artifact[];
  visualQaResults: VisualQAResult[];
};

export type DashboardSnapshot = {
  runs: Run[];
  approvals: ApprovalRequest[];
  commands: CommandLog[];
  messages: AgentMessage[];
  artifacts: Artifact[];
  visualQaResults: VisualQAResult[];
  settings: ForgeSettings;
};
