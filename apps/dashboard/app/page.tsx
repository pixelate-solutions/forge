import { getStore } from "@forge/core";
import DashboardClient from "../components/DashboardClient";

export const dynamic = "force-dynamic";

export default function Page() {
  const store = getStore();
  const snapshot = {
    runs: store.listRuns(),
    approvals: store.listApprovalRequests(),
    commands: store.listCommands(),
    messages: store.listAgentMessages(),
    artifacts: store.listArtifacts(),
    visualQaResults: store.listVisualQAResults(),
    settings: store.getSettings()
  };
  return <DashboardClient initialSnapshot={snapshot} />;
}
