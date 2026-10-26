import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SETTINGS } from "./constants.js";
import { createId, nowIso } from "./id.js";
import { redactSecrets } from "./secrets.js";
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
} from "./types.js";

type Row = Record<string, unknown>;

const WORKSPACE_ROOT = findWorkspaceRoot(process.cwd());
const DEFAULT_DB_PATH = path.resolve(WORKSPACE_ROOT, "forge-agent.sqlite");

function json<T>(value: T): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function plain<T>(row: unknown): T {
  return { ...(row as Record<string, unknown>) } as T;
}

export class ForgeStore {
  private db: DatabaseSync;

  constructor(dbPath = resolveDatabasePath(process.env.FORGE_DATABASE_PATH)) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
    this.ensureDefaultSettings();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        repoPath TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        title TEXT NOT NULL,
        inputType TEXT NOT NULL,
        rawInput TEXT NOT NULL,
        referenceNotes TEXT,
        allowWebSearch INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        currentTicketId TEXT,
        summary TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY(projectId) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        priority TEXT NOT NULL,
        acceptanceCriteria TEXT NOT NULL,
        dependencies TEXT NOT NULL,
        filesLikelyTouched TEXT NOT NULL,
        testRequirements TEXT NOT NULL,
        visualQaRequirements TEXT NOT NULL,
        status TEXT NOT NULL,
        complexity TEXT,
        requiredScreens TEXT NOT NULL,
        requiredBackendEntities TEXT NOT NULL,
        requiredIntegrations TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY(runId) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        agent TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY(runId) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY,
        runId TEXT,
        ticketId TEXT,
        command TEXT NOT NULL,
        cwd TEXT NOT NULL,
        policyLevel TEXT NOT NULL,
        status TEXT NOT NULL,
        exitCode INTEGER,
        stdout TEXT,
        stderr TEXT,
        durationMs INTEGER,
        createdAt TEXT NOT NULL,
        completedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        ticketId TEXT,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        label TEXT NOT NULL,
        metadata TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY(runId) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS visual_qa_results (
        id TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        route TEXT NOT NULL,
        viewport TEXT NOT NULL,
        screenshotPath TEXT NOT NULL,
        consoleErrors TEXT NOT NULL,
        networkErrors TEXT NOT NULL,
        hasHorizontalOverflow INTEGER NOT NULL,
        brokenImages TEXT NOT NULL,
        missingAltImages TEXT NOT NULL,
        notes TEXT NOT NULL,
        passed INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY(runId) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS test_runs (
        id TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        ticketId TEXT,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        output TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY(runId) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        riskLevel TEXT NOT NULL,
        actionType TEXT NOT NULL,
        commandPreview TEXT,
        estimatedCostUsd REAL,
        affectedResources TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        resolvedAt TEXT,
        FOREIGN KEY(runId) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS secret_references (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        envVarName TEXT NOT NULL,
        description TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
    `);
    this.addColumnIfMissing("runs", "referenceNotes", "TEXT");
    this.addColumnIfMissing("runs", "allowWebSearch", "INTEGER NOT NULL DEFAULT 0");
  }

  close(): void {
    this.db.close();
  }

  createProject(input: { name: string; repoPath: string }): Project {
    const item: Project = {
      id: createId("proj"),
      name: input.name,
      repoPath: input.repoPath,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.db
      .prepare("INSERT INTO projects VALUES (?, ?, ?, ?, ?)")
      .run(item.id, item.name, item.repoPath, item.createdAt, item.updatedAt);
    return item;
  }

  listProjects(): Project[] {
    return this.db
      .prepare("SELECT * FROM projects ORDER BY createdAt DESC")
      .all()
      .map((row) => plain<Project>(row));
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return row ? plain<Project>(row) : undefined;
  }

  createRun(input: {
    projectName: string;
    repoPath: string;
    title: string;
    inputType: Run["inputType"];
    rawInput: string;
    referenceNotes?: string;
    allowWebSearch?: boolean;
  }): Run {
    const project = this.createProject({ name: input.projectName, repoPath: input.repoPath });
    const item: Run = {
      id: createId("run"),
      projectId: project.id,
      title: input.title,
      inputType: input.inputType,
      rawInput: input.rawInput,
      referenceNotes: input.referenceNotes,
      allowWebSearch: input.allowWebSearch ?? false,
      status: "queued",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.db
      .prepare(`
        INSERT INTO runs (
          id,
          projectId,
          title,
          inputType,
          rawInput,
          referenceNotes,
          allowWebSearch,
          status,
          currentTicketId,
          summary,
          createdAt,
          updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        item.id,
        item.projectId,
        item.title,
        item.inputType,
        item.rawInput,
        item.referenceNotes ?? null,
        item.allowWebSearch ? 1 : 0,
        item.status,
        item.currentTicketId ?? null,
        item.summary ?? null,
        item.createdAt,
        item.updatedAt
      );
    return item;
  }

  listRuns(): Run[] {
    return this.db
      .prepare("SELECT * FROM runs ORDER BY createdAt DESC")
      .all()
      .map((row) => this.mapRun(row as Row));
  }

  getRun(id: string): Run | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
    return row ? this.mapRun(row as Row) : undefined;
  }

  updateRun(id: string, patch: Partial<Pick<Run, "status" | "currentTicketId" | "summary">>): void {
    const existing = this.getRun(id);
    if (!existing) return;
    const next = { ...existing, ...patch, updatedAt: nowIso() };
    this.db
      .prepare(
        "UPDATE runs SET status = ?, currentTicketId = ?, summary = ?, updatedAt = ? WHERE id = ?"
      )
      .run(next.status, next.currentTicketId ?? null, next.summary ?? null, next.updatedAt, id);
  }

  upsertTickets(runId: string, tickets: Omit<Ticket, "runId" | "createdAt" | "updatedAt">[]): Ticket[] {
    const now = nowIso();
    const stmt = this.db.prepare(`
      INSERT INTO tickets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        priority = excluded.priority,
        acceptanceCriteria = excluded.acceptanceCriteria,
        dependencies = excluded.dependencies,
        filesLikelyTouched = excluded.filesLikelyTouched,
        testRequirements = excluded.testRequirements,
        visualQaRequirements = excluded.visualQaRequirements,
        status = excluded.status,
        complexity = excluded.complexity,
        requiredScreens = excluded.requiredScreens,
        requiredBackendEntities = excluded.requiredBackendEntities,
        requiredIntegrations = excluded.requiredIntegrations,
        updatedAt = excluded.updatedAt
    `);
    const saved = tickets.map((ticket) => ({
      ...ticket,
      runId,
      createdAt: now,
      updatedAt: now
    }));
    this.db.exec("BEGIN");
    try {
      for (const item of saved) {
        stmt.run(
          item.id,
          item.runId,
          item.title,
          item.description,
          item.priority,
          json(item.acceptanceCriteria),
          json(item.dependencies),
          json(item.filesLikelyTouched ?? []),
          json(item.testRequirements),
          json(item.visualQaRequirements),
          item.status,
          item.complexity ?? null,
          json(item.requiredScreens ?? []),
          json(item.requiredBackendEntities ?? []),
          json(item.requiredIntegrations ?? []),
          item.createdAt,
          item.updatedAt
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return saved;
  }

  listTickets(runId?: string): Ticket[] {
    const rows = runId
      ? this.db.prepare("SELECT * FROM tickets WHERE runId = ? ORDER BY createdAt ASC").all(runId)
      : this.db.prepare("SELECT * FROM tickets ORDER BY createdAt ASC").all();
    return rows.map((row) => this.mapTicket(row as Row));
  }

  updateTicketStatus(id: string, status: Ticket["status"]): void {
    this.db
      .prepare("UPDATE tickets SET status = ?, updatedAt = ? WHERE id = ?")
      .run(status, nowIso(), id);
  }

  addAgentMessage(input: Omit<AgentMessage, "id" | "createdAt">): AgentMessage {
    const item: AgentMessage = {
      ...input,
      id: createId("msg"),
      message: redactSecrets(input.message),
      metadata: input.metadata ?? {},
      createdAt: nowIso()
    };
    this.db
      .prepare("INSERT INTO agent_messages VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, item.runId, item.agent, item.level, item.message, json(item.metadata), item.createdAt);
    return item;
  }

  listAgentMessages(runId?: string): AgentMessage[] {
    const rows = runId
      ? this.db.prepare("SELECT * FROM agent_messages WHERE runId = ? ORDER BY createdAt DESC").all(runId)
      : this.db.prepare("SELECT * FROM agent_messages ORDER BY createdAt DESC LIMIT 200").all();
    return rows.map((row) => ({
      ...plain<AgentMessage>(row),
      metadata: parseJson<Record<string, unknown>>((row as Row).metadata, {})
    }));
  }

  addCommand(input: Omit<CommandLog, "id" | "createdAt">): CommandLog {
    const item: CommandLog = {
      ...input,
      id: createId("cmd"),
      stdout: redactSecrets(input.stdout),
      stderr: redactSecrets(input.stderr),
      createdAt: nowIso()
    };
    this.db
      .prepare("INSERT INTO commands VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        item.id,
        item.runId ?? null,
        item.ticketId ?? null,
        item.command,
        item.cwd,
        item.policyLevel,
        item.status,
        item.exitCode ?? null,
        item.stdout ?? null,
        item.stderr ?? null,
        item.durationMs ?? null,
        item.createdAt,
        item.completedAt ?? null
      );
    return item;
  }

  updateCommand(id: string, patch: Partial<CommandLog>): void {
    const currentRow = this.db.prepare("SELECT * FROM commands WHERE id = ?").get(id);
    const current = currentRow ? plain<CommandLog>(currentRow) : undefined;
    if (!current) return;
    const next = {
      ...current,
      ...patch,
      stdout: redactSecrets(patch.stdout ?? current.stdout),
      stderr: redactSecrets(patch.stderr ?? current.stderr)
    };
    this.db
      .prepare(
        "UPDATE commands SET status = ?, exitCode = ?, stdout = ?, stderr = ?, durationMs = ?, completedAt = ? WHERE id = ?"
      )
      .run(
        next.status,
        next.exitCode ?? null,
        next.stdout ?? null,
        next.stderr ?? null,
        next.durationMs ?? null,
        next.completedAt ?? null,
        id
      );
  }

  listCommands(runId?: string): CommandLog[] {
    const rows = runId
      ? this.db.prepare("SELECT * FROM commands WHERE runId = ? ORDER BY createdAt DESC").all(runId)
      : this.db.prepare("SELECT * FROM commands ORDER BY createdAt DESC LIMIT 200").all();
    return rows.map((row) => plain<CommandLog>(row));
  }

  addArtifact(input: Omit<Artifact, "id" | "createdAt">): Artifact {
    const item: Artifact = { ...input, id: createId("art"), metadata: input.metadata ?? {}, createdAt: nowIso() };
    this.db
      .prepare("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        item.id,
        item.runId,
        item.ticketId ?? null,
        item.type,
        item.path,
        item.label,
        json(item.metadata),
        item.createdAt
      );
    return item;
  }

  listArtifacts(runId?: string): Artifact[] {
    const rows = runId
      ? this.db.prepare("SELECT * FROM artifacts WHERE runId = ? ORDER BY createdAt DESC").all(runId)
      : this.db.prepare("SELECT * FROM artifacts ORDER BY createdAt DESC LIMIT 200").all();
    return rows.map((row) => ({
      ...plain<Artifact>(row),
      metadata: parseJson<Record<string, unknown>>((row as Row).metadata, {})
    }));
  }

  addVisualQAResult(input: VisualQAResult): VisualQAResult {
    const item: VisualQAResult & { id: string; createdAt: string } = {
      ...input,
      id: input.id ?? createId("vqa"),
      createdAt: input.createdAt ?? nowIso()
    };
    this.db
      .prepare("INSERT INTO visual_qa_results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        item.id,
        item.runId,
        item.route,
        item.viewport,
        item.screenshotPath,
        json(item.consoleErrors),
        json(item.networkErrors),
        item.hasHorizontalOverflow ? 1 : 0,
        json(item.brokenImages),
        json(item.missingAltImages),
        json(item.notes),
        item.passed ? 1 : 0,
        item.createdAt
      );
    return item;
  }

  listVisualQAResults(runId?: string): VisualQAResult[] {
    const rows = runId
      ? this.db.prepare("SELECT * FROM visual_qa_results WHERE runId = ? ORDER BY createdAt DESC").all(runId)
      : this.db.prepare("SELECT * FROM visual_qa_results ORDER BY createdAt DESC LIMIT 300").all();
    return rows.map((row) => this.mapVisualQAResult(row as Row));
  }

  addApprovalRequest(input: Omit<ApprovalRequest, "id" | "createdAt" | "status">): ApprovalRequest {
    const item: ApprovalRequest = {
      ...input,
      id: createId("appr"),
      status: "pending",
      affectedResources: input.affectedResources ?? [],
      commandPreview: input.commandPreview ? redactSecrets(input.commandPreview) : undefined,
      createdAt: nowIso()
    };
    this.db
      .prepare("INSERT INTO approval_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        item.id,
        item.runId,
        item.title,
        item.description,
        item.riskLevel,
        item.actionType,
        item.commandPreview ?? null,
        item.estimatedCostUsd ?? null,
        json(item.affectedResources),
        item.status,
        item.createdAt,
        item.resolvedAt ?? null
      );
    return item;
  }

  listApprovalRequests(runId?: string): ApprovalRequest[] {
    const rows = runId
      ? this.db
          .prepare("SELECT * FROM approval_requests WHERE runId = ? ORDER BY createdAt DESC")
          .all(runId)
      : this.db.prepare("SELECT * FROM approval_requests ORDER BY createdAt DESC").all();
    return rows.map((row) => ({
      ...plain<ApprovalRequest>(row),
      affectedResources: parseJson<string[]>((row as Row).affectedResources, [])
    }));
  }

  resolveApproval(id: string, status: "approved" | "rejected"): ApprovalRequest | undefined {
    this.db
      .prepare("UPDATE approval_requests SET status = ?, resolvedAt = ? WHERE id = ?")
      .run(status, nowIso(), id);
    const row = this.db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id);
    return row
      ? ({
          ...plain<ApprovalRequest>(row),
          affectedResources: parseJson<string[]>((row as Row).affectedResources, [])
        } satisfies ApprovalRequest)
      : undefined;
  }

  getSettings(): ForgeSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'global'").get() as
      | { value: string }
      | undefined;
    return row ? parseJson<ForgeSettings>(row.value, DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
  }

  saveSettings(settings: ForgeSettings): ForgeSettings {
    this.db
      .prepare(
        "INSERT INTO settings VALUES ('global', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt"
      )
      .run(json(settings), nowIso());
    return settings;
  }

  getRunDetails(id: string) {
    const run = this.getRun(id);
    if (!run) return undefined;
    return {
      run,
      project: this.getProject(run.projectId),
      tickets: this.listTickets(id),
      messages: this.listAgentMessages(id),
      commands: this.listCommands(id),
      approvals: this.listApprovalRequests(id),
      artifacts: this.listArtifacts(id),
      visualQaResults: this.listVisualQAResults(id)
    };
  }

  private ensureDefaultSettings(): void {
    if (!this.db.prepare("SELECT key FROM settings WHERE key = 'global'").get()) {
      this.saveSettings(DEFAULT_SETTINGS);
    }
  }

  private mapRun(row: Row): Run {
    return {
      id: String(row.id),
      projectId: String(row.projectId),
      title: String(row.title),
      inputType: row.inputType as Run["inputType"],
      rawInput: String(row.rawInput),
      referenceNotes: optionalString(row.referenceNotes),
      allowWebSearch: Number(row.allowWebSearch ?? 0) === 1,
      status: row.status as Run["status"],
      currentTicketId: optionalString(row.currentTicketId),
      summary: optionalString(row.summary),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt)
    };
  }

  private addColumnIfMissing(tableName: string, columnName: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  private mapTicket(row: Row): Ticket {
    return {
      id: String(row.id),
      runId: String(row.runId),
      title: String(row.title),
      description: String(row.description),
      priority: row.priority as Ticket["priority"],
      acceptanceCriteria: parseJson<string[]>(row.acceptanceCriteria, []),
      dependencies: parseJson<string[]>(row.dependencies, []),
      filesLikelyTouched: parseJson<string[]>(row.filesLikelyTouched, []),
      testRequirements: parseJson<string[]>(row.testRequirements, []),
      visualQaRequirements: parseJson<string[]>(row.visualQaRequirements, []),
      status: row.status as Ticket["status"],
      complexity: row.complexity as Ticket["complexity"],
      requiredScreens: parseJson<string[]>(row.requiredScreens, []),
      requiredBackendEntities: parseJson<string[]>(row.requiredBackendEntities, []),
      requiredIntegrations: parseJson<string[]>(row.requiredIntegrations, []),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt)
    };
  }

  private mapVisualQAResult(row: Row): VisualQAResult {
    return {
      id: String(row.id),
      runId: String(row.runId),
      route: String(row.route),
      viewport: String(row.viewport),
      screenshotPath: String(row.screenshotPath),
      consoleErrors: parseJson<string[]>(row.consoleErrors, []),
      networkErrors: parseJson<string[]>(row.networkErrors, []),
      hasHorizontalOverflow: Number(row.hasHorizontalOverflow) === 1,
      brokenImages: parseJson<string[]>(row.brokenImages, []),
      missingAltImages: parseJson<string[]>(row.missingAltImages, []),
      notes: parseJson<string[]>(row.notes, []),
      passed: Number(row.passed) === 1,
      createdAt: String(row.createdAt)
    };
  }
}

function resolveDatabasePath(input?: string): string {
  if (!input || input.trim().length === 0) return DEFAULT_DB_PATH;
  const expanded = input.replace(/^~(?=$|\/|\\)/, process.env.HOME ?? "");
  return path.isAbsolute(expanded) ? expanded : path.resolve(WORKSPACE_ROOT, expanded);
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

let singleton: ForgeStore | undefined;

export function getStore(): ForgeStore {
  singleton ??= new ForgeStore();
  return singleton;
}
