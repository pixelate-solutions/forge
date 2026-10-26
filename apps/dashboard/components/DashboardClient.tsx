"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Code2,
  FileText,
  Link as LinkIcon,
  ListChecks,
  Paperclip,
  Play,
  RefreshCw,
  Search,
  Terminal
} from "lucide-react";
import type { AgentMessage, ApprovalRequest, CommandLog, Run } from "@forge/core";
import type { DashboardSnapshot, RunDetails } from "../lib/api";

type Section = "run" | "logs" | "review";

type RunForm = {
  title: string;
  projectName: string;
  repoPath: string;
  rawInput: string;
  referenceUrls: string;
  referenceNotes: string;
  allowWebSearch: boolean;
};

type CodeFile = {
  path: string;
  relativePath: string;
  language: string;
  size: number;
  truncated: boolean;
  content: string;
};

const emptyForm: RunForm = {
  title: "",
  projectName: "",
  repoPath: "",
  rawInput: "",
  referenceUrls: "",
  referenceNotes: "",
  allowWebSearch: false
};

export default function DashboardClient({ initialSnapshot }: { initialSnapshot: DashboardSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [runDetails, setRunDetails] = useState<RunDetails | undefined>();
  const [activeSection, setActiveSection] = useState<Section>("run");
  const [form, setForm] = useState<RunForm>(emptyForm);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [codeFiles, setCodeFiles] = useState<CodeFile[]>([]);
  const [selectedCodePath, setSelectedCodePath] = useState<string | undefined>();
  const [isCreating, setIsCreating] = useState(false);
  const isRunAgain = Boolean(selectedRunId);

  async function refresh() {
    const response = await fetch("/api/runs", { cache: "no-store" });
    const next = (await response.json()) as DashboardSnapshot;
    setSnapshot(next);
    if (selectedRunId) {
      const detailsResponse = await fetch(`/api/runs/${selectedRunId}`, { cache: "no-store" });
      if (detailsResponse.ok) setRunDetails((await detailsResponse.json()) as RunDetails);
    }
  }

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetails(undefined);
      return;
    }
    let cancelled = false;
    fetch(`/api/runs/${selectedRunId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((details: RunDetails | undefined) => {
        if (cancelled) return;
        setRunDetails(details);
        if (details) setForm(formFromRunDetails(details));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedRunId || activeSection !== "review") return;
    let cancelled = false;
    fetch(`/api/runs/${selectedRunId}/files`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { files: [] }))
      .then((payload: { files: CodeFile[] }) => {
        if (cancelled) return;
        setCodeFiles(payload.files);
        setSelectedCodePath((current) => current ?? payload.files[0]?.path);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, activeSection, runDetails]);

  useEffect(() => {
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [selectedRunId]);

  async function submitRun(event: React.FormEvent) {
    event.preventDefault();
    setIsCreating(true);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        body: createRunFormData(form, referenceFiles, selectedRunId)
      });
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as { run: Run };
      setSelectedRunId(body.run.id);
      setReferenceFiles([]);
      setActiveSection("logs");
      await refresh();
    } finally {
      setIsCreating(false);
    }
  }

  function startNewRun() {
    setSelectedRunId(undefined);
    setRunDetails(undefined);
    setCodeFiles([]);
    setSelectedCodePath(undefined);
    setForm(emptyForm);
    setReferenceFiles([]);
    setActiveSection("run");
  }

  function selectRun(id: string) {
    setSelectedRunId(id);
    setReferenceFiles([]);
    setCodeFiles([]);
    setSelectedCodePath(undefined);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-56 border-r border-border bg-panel lg:block">
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-white">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">Forge Agent</div>
            <div className="text-xs text-foreground/60">Local runner</div>
          </div>
        </div>
        <nav className="space-y-1 p-3">
          <button
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
              activeSection === "run" ? "bg-muted text-foreground" : "text-foreground/68 hover:bg-muted"
            }`}
            onClick={() => setActiveSection("run")}
          >
            <Play className="h-4 w-4" />
            Run
          </button>
          <button
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
              activeSection === "logs" ? "bg-muted text-foreground" : "text-foreground/68 hover:bg-muted"
            }`}
            onClick={() => setActiveSection("logs")}
          >
            <Terminal className="h-4 w-4" />
            Logs
          </button>
          <button
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
              activeSection === "review" ? "bg-muted text-foreground" : "text-foreground/68 hover:bg-muted"
            }`}
            onClick={() => setActiveSection("review")}
          >
            <Code2 className="h-4 w-4" />
            Code Review
          </button>
        </nav>
      </aside>

      <main className="lg:pl-56">
        <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between border-b border-border bg-background/92 px-4 backdrop-blur md:px-8">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{activeSection === "review" ? "Code Review" : activeSection === "logs" ? "Logs" : "Run"}</h1>
            <p className="truncate text-xs text-foreground/60">
              {runDetails ? `${runDetails.run.title || "Untitled run"} · ${runDetails.run.status}` : "No run selected"}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-sm" onClick={startNewRun} type="button">
              <Play className="h-4 w-4" />
              New Run
            </button>
            <button className="inline-flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-sm" onClick={refresh} type="button">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </header>

        <div className="p-4 md:p-8">
          {activeSection === "run" ? (
            <div className="mx-auto grid max-w-6xl gap-6">
              <RunFormPanel
                form={form}
                setForm={setForm}
                referenceFiles={referenceFiles}
                setReferenceFiles={setReferenceFiles}
                isCreating={isCreating}
                isRunAgain={isRunAgain}
                onSubmit={submitRun}
              />
              <RunsTable runs={snapshot.runs} selectedRunId={selectedRunId} onSelect={selectRun} />
            </div>
          ) : activeSection === "logs" ? (
            <LogsPage
              details={runDetails}
              approvals={snapshot.approvals.filter((approval) => !selectedRunId || approval.runId === selectedRunId)}
              onOpenFile={(filePath) => {
                setSelectedCodePath(filePath);
                setActiveSection("review");
              }}
            />
          ) : (
            <CodeReviewPage
              details={runDetails}
              files={codeFiles}
              selectedPath={selectedCodePath}
              onSelectPath={setSelectedCodePath}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function RunFormPanel({
  form,
  setForm,
  referenceFiles,
  setReferenceFiles,
  isCreating,
  isRunAgain,
  onSubmit
}: {
  form: RunForm;
  setForm: React.Dispatch<React.SetStateAction<RunForm>>;
  referenceFiles: File[];
  setReferenceFiles: React.Dispatch<React.SetStateAction<File[]>>;
  isCreating: boolean;
  isRunAgain: boolean;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <Panel title={isRunAgain ? "Run Again" : "New Run"} icon={Play}>
      <form className="grid gap-3" onSubmit={onSubmit}>
        <div className="grid gap-3 md:grid-cols-3">
          <input
            className="w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Run title"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
          <input
            className="w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Project name"
            value={form.projectName}
            onChange={(event) => setForm((current) => ({ ...current, projectName: event.target.value }))}
          />
          <input
            className="w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Local repo path"
            value={form.repoPath}
            onChange={(event) => setForm((current) => ({ ...current, repoPath: event.target.value }))}
          />
        </div>
        <textarea
          className="min-h-48 w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm leading-6"
          placeholder="Paste the SOW, task, or instructions."
          value={form.rawInput}
          onChange={(event) => setForm((current) => ({ ...current, rawInput: event.target.value }))}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="rounded-md border border-border bg-background p-3">
            <span className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground/65">
              <LinkIcon className="h-4 w-4 text-accent" />
              Reference URLs
            </span>
            <textarea
              className="min-h-24 w-full min-w-0 resize-y rounded-md border border-border bg-panel px-3 py-2 text-sm leading-6"
              placeholder="https://example.com/reference"
              value={form.referenceUrls}
              onChange={(event) => setForm((current) => ({ ...current, referenceUrls: event.target.value }))}
            />
          </label>
          <label className="rounded-md border border-border bg-background p-3">
            <span className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground/65">
              <FileText className="h-4 w-4 text-accent" />
              Reference notes
            </span>
            <textarea
              className="min-h-24 w-full min-w-0 resize-y rounded-md border border-border bg-panel px-3 py-2 text-sm leading-6"
              placeholder="Paths, design notes, context, constraints."
              value={form.referenceNotes}
              onChange={(event) => setForm((current) => ({ ...current, referenceNotes: event.target.value }))}
            />
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md border border-dashed border-border bg-background p-3">
            <Paperclip className="h-5 w-5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Attach images or documents</span>
              <span className="block truncate text-xs text-foreground/55">
                {referenceFiles.length > 0 ? referenceFiles.map((file) => file.name).join(", ") : "Optional references for this new run"}
              </span>
            </span>
            <input
              className="sr-only"
              type="file"
              multiple
              accept="image/*,.pdf,.md,.markdown,.txt,.json,.csv,.tsv,.doc,.docx"
              onChange={(event) => setReferenceFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          <label className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={form.allowWebSearch}
              onChange={(event) => setForm((current) => ({ ...current, allowWebSearch: event.target.checked }))}
            />
            <span className="inline-flex items-center gap-2 whitespace-nowrap">
              <Search className="h-4 w-4 text-accent" />
              Allow web search
            </span>
          </label>
        </div>
        <div className="flex justify-end">
          <button
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={isCreating}
          >
            <Play className="h-4 w-4" />
            {isCreating ? "Submitting" : isRunAgain ? "Run Again" : "Create Run"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function LogsPage({
  details,
  approvals,
  onOpenFile
}: {
  details?: RunDetails;
  approvals: ApprovalRequest[];
  onOpenFile: (filePath: string) => void;
}) {
  return (
    <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <div className="min-w-0 space-y-6">
        <ProgressPanel details={details} approvals={approvals} onOpenFile={onOpenFile} />
      </div>
      <div className="min-w-0">
        <LogsPanel messages={details?.messages ?? []} />
      </div>
    </div>
  );
}

function CodeReviewPage({
  details,
  files,
  selectedPath,
  onSelectPath
}: {
  details?: RunDetails;
  files: CodeFile[];
  selectedPath?: string;
  onSelectPath: (filePath: string) => void;
}) {
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0];
  return (
    <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[minmax(280px,0.35fr)_minmax(0,0.65fr)]">
      <Panel title={`Changed Files (${files.length})`} icon={Code2}>
        {!details && <EmptyState label="Select a run to review changed files." />}
        {details && files.length === 0 && <EmptyState label="No changed source files are available for this run." />}
        <div className="space-y-2">
          {files.map((file) => (
            <button
              key={file.path}
              className={`block w-full rounded-md border border-border p-3 text-left text-xs ${
                selectedFile?.path === file.path ? "bg-muted" : "bg-background hover:bg-muted"
              }`}
              onClick={() => onSelectPath(file.path)}
              type="button"
            >
              <span className="block break-words font-medium [overflow-wrap:anywhere]">{file.relativePath}</span>
              <span className="mt-1 block text-foreground/55">{formatBytes(file.size)}{file.truncated ? " · truncated" : ""}</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title={selectedFile ? selectedFile.relativePath : "File"} icon={FileText}>
        {!selectedFile ? (
          <EmptyState label="Choose a changed file." />
        ) : (
          <details open className="rounded-md border border-border bg-background">
            <summary className="cursor-pointer border-b border-border px-3 py-2 text-sm font-medium">
              {selectedFile.relativePath}
            </summary>
            <pre className="max-h-[72vh] overflow-auto p-3 text-xs leading-5">
              <code className={`language-${selectedFile.language}`}>{selectedFile.content}</code>
            </pre>
          </details>
        )}
      </Panel>
    </div>
  );
}

function ProgressPanel({
  details,
  approvals,
  onOpenFile
}: {
  details?: RunDetails;
  approvals: ApprovalRequest[];
  onOpenFile: (filePath: string) => void;
}) {
  const commands = details?.commands ?? [];
  const messages = details?.messages ?? [];
  const runningCommand = commands.find((command) => command.status === "running");
  const allChangedFiles = getChangedFiles(messages);
  const changedFiles = allChangedFiles.slice(0, 20);
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending").length;
  const done = details?.tickets.filter((ticket) => ticket.status === "done").length ?? 0;
  const total = details?.tickets.length ?? 0;

  return (
    <Panel title="Progress" icon={Activity}>
      {!details ? (
        <EmptyState label="Select a run to see logs." />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Status" value={details.run.status} />
            <Metric label="Tasks" value={`${done}/${total}`} />
            <Metric label="Commands" value={String(commands.length)} />
            <Metric label="Approvals" value={String(pendingApprovals)} />
          </div>
          {runningCommand ? (
            <CommandCard command={runningCommand} title="Running now" showOutput={false} />
          ) : (
            <EmptyState label="No command is currently running." />
          )}
          {changedFiles.length > 0 && (
            <div className="rounded-md border border-border bg-background p-3">
              <div className="mb-2 text-xs font-medium text-foreground/55">Source files changed ({allChangedFiles.length})</div>
              <ul className="space-y-1 text-xs">
                {changedFiles.map((file) => (
                  <li key={file}>
                    <button
                      className="break-words text-left text-accent underline-offset-2 hover:underline [overflow-wrap:anywhere]"
                      onClick={() => onOpenFile(file)}
                      type="button"
                    >
                      {file}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function CommandCard({ command, title, showOutput = true }: { command: CommandLog; title?: string; showOutput?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-background p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2 text-foreground/55">
        <span>{title ?? command.cwd}</span>
        {command.durationMs !== undefined && <span>{formatDuration(command.durationMs)}</span>}
      </div>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{command.command}</code>
        <StatusBadge status={command.status} />
      </div>
      {showOutput && command.stdout && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-foreground/70 [overflow-wrap:anywhere]">
          {tail(command.stdout, 1600)}
        </pre>
      )}
      {showOutput && command.stderr && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-danger/10 p-2 text-danger [overflow-wrap:anywhere]">
          {tail(command.stderr, 1600)}
        </pre>
      )}
    </div>
  );
}

function LogsPanel({ messages }: { messages: AgentMessage[] }) {
  const visibleMessages = messages.filter(shouldShowLogMessage);
  return (
    <Panel title="Logs" icon={FileText}>
      <div className="space-y-2">
        {visibleMessages.length === 0 && <EmptyState label="No logs for this run." />}
        {visibleMessages.map((message) => (
          <div key={message.id} className="min-w-0 rounded-md bg-background p-3 text-sm">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-foreground/55">
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{message.agent} · {message.level}</span>
              <span className="shrink-0">{formatDate(message.createdAt)}</span>
            </div>
            <p className="mt-1 min-w-0 break-words leading-5 [overflow-wrap:anywhere]">{message.message}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RunsTable({ runs, selectedRunId, onSelect }: { runs: Run[]; selectedRunId?: string; onSelect: (id: string) => void }) {
  return (
    <Panel title="Previous Runs" icon={ListChecks}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase text-foreground/55">
            <tr>
              <th className="py-2 pr-3">Run</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Created</th>
              <th className="py-2 pr-3">Web search</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id}
                className={`cursor-pointer border-b border-border/70 ${selectedRunId === run.id ? "bg-muted" : ""}`}
                onClick={() => onSelect(run.id)}
              >
                <td className="max-w-md break-words py-3 pr-3 font-medium [overflow-wrap:anywhere]">{run.title || "Untitled run"}</td>
                <td className="py-3 pr-3"><StatusBadge status={run.status} /></td>
                <td className="py-3 pr-3 text-foreground/65">{formatDate(run.createdAt)}</td>
                <td className="py-3 pr-3 text-foreground/65">{run.allowWebSearch ? "enabled" : "disabled"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-border bg-panel shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Icon className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="min-w-0 p-4">{children}</div>
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "completed" || status === "done" || status === "approved"
      ? "bg-success"
      : status === "failed" || status === "blocked" || status === "rejected" || status === "cancelled"
        ? "bg-danger"
        : status === "approval_required" || status === "pending"
          ? "bg-amber-500"
          : "bg-accent";
  return (
    <span className="inline-flex max-w-full shrink-0 items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs">
      <span className={`status-dot ${color}`} />
      <span className="truncate">{status}</span>
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-background p-3">
      <div className="text-xs text-foreground/55">{label}</div>
      <div className="mt-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-lg font-semibold leading-tight">{value[0]?.toUpperCase() + value.slice(1)}</div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-md border border-dashed border-border bg-background p-4 text-sm text-foreground/55">{label}</div>;
}

function createRunFormData(form: RunForm, files: File[], sourceRunId?: string): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(form)) body.set(key, String(value));
  if (sourceRunId) body.set("sourceRunId", sourceRunId);
  for (const file of files) body.append("references", file);
  return body;
}

function formFromRunDetails(details: RunDetails): RunForm {
  const urls = details.artifacts
    .filter((artifact) => artifact.type === "reference" && artifact.metadata?.kind === "url")
    .map((artifact) => artifact.path)
    .join("\n");
  return {
    title: details.run.title,
    projectName: details.project?.name ?? "",
    repoPath: details.project?.repoPath ?? "",
    rawInput: details.run.rawInput,
    referenceUrls: urls,
    referenceNotes: details.run.referenceNotes ?? "",
    allowWebSearch: details.run.allowWebSearch
  };
}

function formatDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function tail(value: string, maxLength: number): string {
  return value.length > maxLength ? `...${value.slice(-maxLength)}` : value;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getChangedFiles(messages: AgentMessage[]): string[] {
  const files = new Set<string>();
  for (const message of messages) {
    const changed = message.metadata?.changedFiles;
    if (!Array.isArray(changed)) continue;
    for (const item of changed) {
      if (typeof item === "string" && isReportableChangedFile(item)) files.add(item);
    }
  }
  return Array.from(files);
}

function isReportableChangedFile(filePath: string): boolean {
  return !/(^|\/)(\.next|node_modules|build|dist|coverage|\.dart_tool|Pods|DerivedData|\.turbo|\.cache)(\/|$)/.test(filePath);
}

function shouldShowLogMessage(message: AgentMessage): boolean {
  const text = message.message;
  if (text.includes("codex_core_plugins::manifest")) return false;
  if (text.includes("ignoring interface.defaultPrompt")) return false;
  if (/^Codex event: item\.(started|completed)( \| item\.(started|completed))*$/.test(text)) return false;
  if (text.startsWith("Codex output:") && looksLikeCodeDump(text)) return false;
  return true;
}

function looksLikeCodeDump(value: string): boolean {
  const text = value.trim();
  if (text.length > 900) return true;
  const codeSignals = [
    /import\s+.+\s+from\s+['"]/,
    /export\s+(function|const|type|interface|\{)/,
    /className=/,
    /=>\s*\(/,
    /<\/?[A-Za-z][^>]*>/
  ];
  return codeSignals.filter((pattern) => pattern.test(text)).length >= 2;
}
