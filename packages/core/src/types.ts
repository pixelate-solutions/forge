export type PolicyLevel = "safe_local" | "needs_approval" | "blocked";

export type TicketPriority = "V1" | "V2" | "V3" | "Backlog";
export type TicketStatus =
  | "queued"
  | "in_progress"
  | "blocked"
  | "review"
  | "done"
  | "failed";

export type RunStatus =
  | "queued"
  | "planning"
  | "running"
  | "paused"
  | "approval_required"
  | "completed"
  | "failed"
  | "cancelled";

export type Ticket = {
  id: string;
  runId: string;
  title: string;
  description: string;
  priority: TicketPriority;
  acceptanceCriteria: string[];
  dependencies: string[];
  filesLikelyTouched?: string[];
  testRequirements: string[];
  visualQaRequirements: string[];
  status: TicketStatus;
  complexity?: "low" | "medium" | "high";
  requiredScreens?: string[];
  requiredBackendEntities?: string[];
  requiredIntegrations?: string[];
  createdAt: string;
  updatedAt: string;
};

export type ParsedScope = {
  features: string[];
  tickets: Omit<Ticket, "runId" | "status" | "createdAt" | "updatedAt">[];
  architectureNotes: string[];
  risks: string[];
};

export type Project = {
  id: string;
  name: string;
  repoPath: string;
  createdAt: string;
  updatedAt: string;
};

export type Run = {
  id: string;
  projectId: string;
  title: string;
  inputType: "sow" | "task_list" | "markdown_tickets";
  rawInput: string;
  referenceNotes?: string;
  allowWebSearch: boolean;
  status: RunStatus;
  currentTicketId?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentMessage = {
  id: string;
  runId: string;
  agent: string;
  level: "debug" | "info" | "warn" | "error" | "decision";
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type CommandLog = {
  id: string;
  runId?: string;
  ticketId?: string;
  command: string;
  cwd: string;
  policyLevel: PolicyLevel;
  status: "queued" | "running" | "completed" | "failed" | "blocked" | "approval_required";
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  createdAt: string;
  completedAt?: string;
};

export type Artifact = {
  id: string;
  runId: string;
  ticketId?: string;
  type: "screenshot" | "trace" | "video" | "log" | "report" | "document" | "reference";
  path: string;
  label: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type VisualQAResult = {
  id?: string;
  runId: string;
  route: string;
  viewport: string;
  screenshotPath: string;
  consoleErrors: string[];
  networkErrors: string[];
  hasHorizontalOverflow: boolean;
  brokenImages: string[];
  missingAltImages: string[];
  notes: string[];
  passed: boolean;
  createdAt?: string;
};

export type ApprovalActionType =
  | "preview_deploy"
  | "production_deploy"
  | "paid_resource"
  | "billing_change"
  | "database_migration"
  | "destructive_action"
  | "secret_change"
  | "external_message"
  | "dns_change";

export type ApprovalRequest = {
  id: string;
  runId: string;
  title: string;
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  actionType: ApprovalActionType;
  commandPreview?: string;
  estimatedCostUsd?: number;
  affectedResources?: string[];
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  resolvedAt?: string;
};

export type ForgeSettings = {
  defaultModelProvider: "openai" | "anthropic" | "local" | "manual";
  githubTokenReference: string;
  vercelTokenReference: string;
  localWorkspaceRoot: string;
  maxIterationsPerTicket: number;
  maxRuntimeMinutesPerTicket: number;
  maxEstimatedSpendPerRun: number;
  requireApprovalForPreviewDeploys: boolean;
  requireApprovalForAllExternalServices: boolean;
  visualQaViewportList: ViewportConfig[];
  packageManagerPreference: "pnpm" | "npm" | "yarn" | "bun";
};

export type ViewportConfig = {
  name: string;
  width: number;
  height: number;
};
