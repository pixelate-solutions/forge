import type { ForgeSettings, ViewportConfig } from "./types.js";

export const VIEWPORTS: ViewportConfig[] = [
  { name: "mobile-small", width: 390, height: 844 },
  { name: "mobile-large", width: 430, height: 932 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "wide", width: 1920, height: 1080 }
];

export const DEFAULT_LIMITS = {
  maxIterationsPerTicket: 5,
  maxRuntimeMinutesPerTicket: 60,
  maxRepeatedErrorCount: 3,
  maxVisualQaRunsPerTicket: 5
} as const;

export const DEFAULT_SETTINGS: ForgeSettings = {
  defaultModelProvider: "manual",
  githubTokenReference: "GITHUB_TOKEN",
  vercelTokenReference: "VERCEL_TOKEN",
  localWorkspaceRoot: "~/ForgeWorkspaces",
  maxIterationsPerTicket: DEFAULT_LIMITS.maxIterationsPerTicket,
  maxRuntimeMinutesPerTicket: DEFAULT_LIMITS.maxRuntimeMinutesPerTicket,
  maxEstimatedSpendPerRun: 0,
  requireApprovalForPreviewDeploys: true,
  requireApprovalForAllExternalServices: true,
  visualQaViewportList: VIEWPORTS,
  packageManagerPreference: "pnpm"
};
