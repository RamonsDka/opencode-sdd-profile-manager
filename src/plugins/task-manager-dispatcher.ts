import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolvePaths } from "../config";
import { createLogger } from "../logger";
import type { TaskManagerProjectIdentity } from "./task-manager-root";
import { shouldEnqueueTaskManagerMilestone } from "./task-manager-routing";
import {
  setTaskManagerErrorState,
  setTaskManagerProlongedState,
  setTaskManagerRunningState,
  setTaskManagerSyncedState,
} from "./task-manager-lifecycle";
import { syncTaskManagerTokenTelemetry } from "./task-manager-telemetry";
import { syncTaskManagerGitEvidence } from "./task-manager-git";
import { withDashboardWriteLock } from "./task-manager-writer";
import { withFileLock } from "../utils";

const log = createLogger("task-manager-dispatcher");

export interface TaskManagerProjectState {
  initialized: boolean;
  lastSyncAt?: string;
  lastMilestone?: string;
  lastError?: string;
  syncStatus?: "idle" | "running" | "prolonged" | "synced" | "error";
}

export interface TaskManagerStore {
  getProject(projectKey: string): TaskManagerProjectState;
  setProject(projectKey: string, state: Partial<TaskManagerProjectState>): void;
  isInitialized(projectKey: string): boolean;
  markInitialized(projectKey: string, timestamp?: string): void;
  markProlonged(projectKey: string): void;
  markFailed(projectKey: string, error: string): void;
}

export function sanitizeAndMigrateStateData(data: Record<string, TaskManagerProjectState>): Record<string, TaskManagerProjectState> {
  const sanitized: Record<string, TaskManagerProjectState> = {};
  for (const [rawKey, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== "object") continue;
    const key = rawKey.toLowerCase();
    if (entry.initialized && entry.syncStatus === "error") {
      sanitized[key] = {
        ...entry,
        initialized: false,
      };
    } else {
      sanitized[key] = { ...entry };
    }
  }
  return sanitized;
}

export function createTaskManagerStore(storagePath?: string): TaskManagerStore {
  const getFilePath = () => storagePath ?? path.join(resolvePaths().configRoot, "task-manager-state.json");

  const loadData = (): Record<string, TaskManagerProjectState> => {
    const file = getFilePath();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!fs.existsSync(file)) return {};
        const raw = fs.readFileSync(file, "utf8");
        if (!raw.trim()) return {};
        const parsed = JSON.parse(raw) as Record<string, TaskManagerProjectState>;
        return sanitizeAndMigrateStateData(parsed);
      } catch (error) {
        if (attempt === 2) {
          log.warn("createTaskManagerStore: failed to load task manager state", error);
          return {};
        }
        const start = Date.now();
        while (Date.now() - start < 5) {}
      }
    }
    return {};
  };

  const updateData = (mutator: (current: Record<string, TaskManagerProjectState>) => void): void => {
    const file = getFilePath();
    withFileLock(file, () => {
      try {
        const data = loadData();
        mutator(data);

        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const randomSuffix = crypto.randomBytes(6).toString("hex");
        const temporary = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.${randomSuffix}.tmp`);
        try {
          fs.writeFileSync(temporary, JSON.stringify(data, null, 2), "utf8");
          try {
            fs.renameSync(temporary, file);
          } catch {
            fs.copyFileSync(temporary, file);
            try { fs.unlinkSync(temporary); } catch {}
          }
        } finally {
          try {
            if (fs.existsSync(temporary)) {
              fs.unlinkSync(temporary);
            }
          } catch {}
        }
      } catch (error) {
        log.warn("createTaskManagerStore: failed to save task manager state", error);
      }
    });
  };

  return {
    getProject(projectKey: string): TaskManagerProjectState {
      const data = loadData();
      return data[projectKey.toLowerCase()] ?? { initialized: false, syncStatus: "idle" };
    },
    setProject(projectKey: string, partial: Partial<TaskManagerProjectState>): void {
      const key = projectKey.toLowerCase();
      updateData((data) => {
        const existing = data[key] ?? { initialized: false, syncStatus: "idle" };
        data[key] = { ...existing, ...partial };
      });
    },
    isInitialized(projectKey: string): boolean {
      return this.getProject(projectKey).initialized === true;
    },
    markInitialized(projectKey: string, timestamp = new Date().toISOString()): void {
      this.setProject(projectKey, {
        initialized: true,
        lastSyncAt: timestamp,
        syncStatus: "idle",
        lastError: undefined,
      });
    },
    markProlonged(projectKey: string): void {
      this.setProject(projectKey, {
        syncStatus: "prolonged",
        lastError: undefined,
      });
    },
    markFailed(projectKey: string, error: string): void {
      this.setProject(projectKey, {
        syncStatus: "error",
        lastError: error,
      });
    },
  };
}

export function buildTaskManagerInitPrompt(project: TaskManagerProjectIdentity, dashboardPath: string): string {
  return [
    `You are Agent Task Manager, the direct execution authority for maintaining and synchronizing the single-file portable HTML task dashboard.`,
    ``,
    `Task: Perform evidence-based initialization of the Task Manager dashboard for the project.`,
    `- Project canonical root: ${project.canonicalRoot}`,
    `- Dashboard file path: ${dashboardPath}`,
    ``,
    `Instructions:`,
    `1. Inspect the project workspace to discover existing context (Git status/branch/commits, directory structure, package manifests, open specs/tasks).`,
    `2. Read the dashboard HTML file at "${dashboardPath}" and locate the JSON state island: <script type="application/json" id="tm-state">...</script>.`,
    `3. Initialize the state island with schemaVersion: "1.0", project metadata, and structured phases and tasks derived from project evidence. If tasks or custom notes already exist in the island, preserve them and additively merge new evidence.`,
    `4. STRICT SAFETY RULES:`,
    `   - Edit ONLY the JSON inside <script type="application/json" id="tm-state">. Never modify HTML markup, CSS styling, or JavaScript logic outside the island.`,
    `   - Never delegate tasks to subagents or workers; execute all state updates directly.`,
    `   - Ensure all occurrences of "</script>" inside JSON strings are escaped as "\\u003c/script\\u003e".`,
    `   - The "tokenUsage" property is host-managed telemetry. PRESERVE the tokenUsage object intact if present; NEVER fabricate, estimate, or overwrite tokenUsage.`,
    `   - Valid task/phase statuses: "pending", "in-progress", "completed", "blocked".`,
    `   - Final state contract: Upon successfully writing the updated state island, set meta.syncStatus to "synced", and set meta.lastSyncCompletedAt, meta.lastSyncAt, and meta.lastUpdated to the current ISO timestamp (new Date().toISOString()).`,
    `   - Dashboard must remain fully functional offline over file:// without external dependencies.`,
    `5. Write the updated state back to the dashboard file and report a concise summary of the initialized phases and tasks.`,
  ].join("\n");
}

export function buildTaskManagerRefreshPrompt(project: TaskManagerProjectIdentity, dashboardPath: string, milestone?: string): string {
  const trigger = milestone ? `Milestone reached: ${milestone}` : "User requested dashboard refresh";
  return [
    `You are Agent Task Manager, the direct execution authority for maintaining and synchronizing the single-file portable HTML task dashboard.`,
    ``,
    `Task: Perform an incremental refresh of the Task Manager dashboard.`,
    `- Project canonical root: ${project.canonicalRoot}`,
    `- Dashboard file path: ${dashboardPath}`,
    `- Trigger: ${trigger}`,
    ``,
    `Instructions:`,
    `1. Read the dashboard HTML file at "${dashboardPath}" and extract the JSON state island: <script type="application/json" id="tm-state">...</script>.`,
    `2. Inspect recent project activity and verifiable evidence (Git changes, tests, milestone progress).`,
    `3. Apply additive, status-oriented updates to phases and tasks:`,
    `   - PRESERVE all existing task IDs, custom user notes, tags, owners, and manual customizations.`,
    `   - Update task and phase statuses ("pending", "in-progress", "completed", "blocked") to reflect current progress.`,
    `   - Update metadata (lastUpdated ISO timestamp).`,
    `4. STRICT SAFETY RULES:`,
    `   - Edit ONLY the JSON inside <script type="application/json" id="tm-state">. Never modify HTML markup, CSS styling, or JavaScript logic outside the island.`,
    `   - Never delegate tasks to subagents or workers; execute all state updates directly.`,
    `   - Escape all "</script>" occurrences inside JSON strings as "\\u003c/script\\u003e".`,
    `   - The "tokenUsage" property is host-managed telemetry. PRESERVE the tokenUsage object intact if present; NEVER fabricate, estimate, or overwrite tokenUsage.`,
    `   - Valid task/phase statuses: "pending", "in-progress", "completed", "blocked".`,
    `   - Final state contract: Upon successfully writing the updated state island, set meta.syncStatus to "synced", and set meta.lastSyncCompletedAt, meta.lastSyncAt, and meta.lastUpdated to the current ISO timestamp (new Date().toISOString()).`,
    `   - Dashboard must remain fully functional offline over file:// without external dependencies.`,
    `5. Write the updated state back to the dashboard file and provide a concise receipt of changes.`,
  ].join("\n");
}

export function captureTaskManagerIslandFingerprint(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return null;
    const parsed = JSON.parse(match[1]);
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

export interface VerifyDashboardUpdatedOptions {
  maxAttempts?: number;
  pollIntervalMs?: number;
  readFingerprint?: (filePath: string) => string | null;
  sleep?: (ms: number) => Promise<void>;
}

export async function verifyDashboardUpdated(
  filePath: string,
  initialFingerprint: string | null,
  options: VerifyDashboardUpdatedOptions = {}
): Promise<boolean> {
  const maxAttempts = options.maxAttempts ?? 3;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const readFingerprint = options.readFingerprint ?? captureTaskManagerIslandFingerprint;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (pollIntervalMs > 0) {
      await sleep(pollIntervalMs);
    }
    const currentFingerprint = readFingerprint(filePath);
    if (currentFingerprint !== null) {
      if (initialFingerprint === null) {
        return true;
      }
      if (currentFingerprint !== initialFingerprint) {
        return true;
      }
    }
  }
  return false;
}

export type TaskManagerAgentRunner = (params: {
  project: TaskManagerProjectIdentity;
  prompt: string;
  mode: "init" | "refresh";
  milestone?: string;
  dashboardPath: string;
  client?: any;
  verifyTimeoutMs?: number;
  pollIntervalMs?: number;
  verifyDashboard?: (dashboardPath: string, initialFingerprint: string | null) => Promise<boolean>;
}) => Promise<{ success: boolean; prolonged?: boolean; error?: string }>;

export const defaultTaskManagerAgentRunner: TaskManagerAgentRunner = async ({
  project,
  prompt,
  client,
  dashboardPath,
  verifyTimeoutMs = 3000,
  pollIntervalMs = 1000,
  verifyDashboard,
}) => {
  if (client?.session?.create && (client?.session?.promptAsync || client?.session?.prompt)) {
    try {
      const session = await client.session.create({ title: `[Task Manager] ${project.root}` });
      const sessionID = session?.data?.id ?? session?.id;
      if (!sessionID) {
        throw new Error("Failed to create background session for Task Manager");
      }

      const initialFingerprint = captureTaskManagerIslandFingerprint(dashboardPath);

      const promptPayload = {
        sessionID,
        agent: "agent-task-manager",
        directory: project.canonicalRoot,
        parts: [{ type: "text" as const, text: prompt }],
      };

      if (typeof client.session.promptAsync === "function") {
        await client.session.promptAsync(promptPayload);
      } else {
        await client.session.prompt(promptPayload);
      }

      const checkDashboard = verifyDashboard ?? ((targetPath, initial) => {
        const maxAttempts = 3;
        const interval = pollIntervalMs > 0 ? pollIntervalMs : Math.floor(verifyTimeoutMs / maxAttempts);
        return verifyDashboardUpdated(targetPath, initial, { maxAttempts, pollIntervalMs: interval });
      });

      const updated = await checkDashboard(dashboardPath, initialFingerprint);
      if (!updated) {
        // Prompt was accepted by the runtime, but Agent Task Manager is still executing in background.
        // Transition to prolonged state (accepted/running) rather than writing a false red error.
        return {
          success: true,
          prolonged: true,
        };
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }
  // Standalone or client-free runtime environment: must not claim success so initialization retries later
  return {
    success: false,
    error: "OpenCode client/session API is unavailable; skipping dispatch until client is connected",
  };
};

export interface ProlongedMonitorOptions {
  project: TaskManagerProjectIdentity;
  dashboardPath: string;
  initialFingerprint: string | null;
  store: TaskManagerStore;
  maxPolls?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  readFingerprint?: (filePath: string) => string | null;
  onStatusChange?: (status: "synced" | "prolonged" | "error") => void;
}

export class TaskManagerProlongedMonitor {
  private cancelled = false;
  private promise: Promise<"synced" | "prolonged" | "error">;

  constructor(options: ProlongedMonitorOptions) {
    this.promise = this.run(options);
  }

  public cancel(): void {
    this.cancelled = true;
  }

  public async wait(): Promise<"synced" | "prolonged" | "error"> {
    return this.promise;
  }

  private async run(options: ProlongedMonitorOptions): Promise<"synced" | "prolonged" | "error"> {
    const {
      project,
      dashboardPath,
      initialFingerprint,
      store,
      maxPolls = 3,
      pollIntervalMs = 15_000,
      sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      readFingerprint = captureTaskManagerIslandFingerprint,
      onStatusChange,
    } = options;

    for (let attempt = 0; attempt < maxPolls; attempt++) {
      if (this.cancelled) return "prolonged";
      if (pollIntervalMs > 0) {
        await sleep(pollIntervalMs);
      }
      if (this.cancelled) return "prolonged";

      const current = readFingerprint(dashboardPath);
      if (current !== null) {
        if (initialFingerprint === null || current !== initialFingerprint) {
          // Agent successfully updated the dashboard!
          store.markInitialized(project.key);
          await withDashboardWriteLock(dashboardPath, () => {
            setTaskManagerSyncedState(dashboardPath, "agent-task-manager");
          });
          onStatusChange?.("synced");
          return "synced";
        }
      }
    }

    // No update observed within bounded window -> remain prolonged (not error)
    onStatusChange?.("prolonged");
    return "prolonged";
  }
}

export interface TaskManagerDispatchParams {
  project: TaskManagerProjectIdentity;
  dashboardPath: string;
  reason?: "opening" | "milestone" | "manual";
  milestone?: string;
  sourceAgent?: string;
  client?: any;
  runner?: TaskManagerAgentRunner;
  store?: TaskManagerStore;
  debounceMs?: number;
  monitorOptions?: Partial<ProlongedMonitorOptions>;
}

export interface TaskManagerDispatchResult {
  success: boolean;
  prolonged?: boolean;
  mode?: "init" | "refresh";
  skipped?: boolean;
  reason?: string;
  error?: string;
}

export const DEFAULT_MILESTONE_DEBOUNCE_MS = 60_000;

export class TaskManagerDispatcher {
  private activeJobs = new Map<string, Promise<TaskManagerDispatchResult>>();
  private pendingRequests = new Map<
    string,
    {
      params: TaskManagerDispatchParams;
      resolvers: Array<{
        resolve: (val: TaskManagerDispatchResult) => void;
        reject: (err: any) => void;
      }>;
    }
  >();
  private lastDispatchTimes = new Map<string, number>();
  private activeMonitors = new Map<string, TaskManagerProlongedMonitor>();
  private store: TaskManagerStore;
  private runner: TaskManagerAgentRunner;
  private defaultDebounceMs: number;

  constructor(options: {
    store?: TaskManagerStore;
    runner?: TaskManagerAgentRunner;
    debounceMs?: number;
  } = {}) {
    this.store = options.store ?? createTaskManagerStore();
    this.runner = options.runner ?? defaultTaskManagerAgentRunner;
    this.defaultDebounceMs = options.debounceMs ?? DEFAULT_MILESTONE_DEBOUNCE_MS;
  }

  public getActiveMonitor(projectKey: string): TaskManagerProlongedMonitor | undefined {
    return this.activeMonitors.get(projectKey.toLowerCase());
  }

  public async dispatch(params: TaskManagerDispatchParams): Promise<TaskManagerDispatchResult> {
    const { project, dashboardPath, reason = "opening", milestone, sourceAgent } = params;
    const store = params.store ?? this.store;
    const runner = params.runner ?? this.runner;
    const debounceMs = params.debounceMs ?? this.defaultDebounceMs;

    // Self-write / recursion protection
    if (sourceAgent === "agent-task-manager" || milestone === "task-manager-self") {
      return { success: true, skipped: true, reason: "self-recursion protection" };
    }

    // Milestone validity check when triggered by milestone
    if (reason === "milestone" && milestone && !shouldEnqueueTaskManagerMilestone(milestone)) {
      return { success: true, skipped: true, reason: `milestone '${milestone}' ignored` };
    }

    // Debounce check for rapid milestone triggers on the same project (manual/opening always dispatch)
    const now = Date.now();
    const lastTime = this.lastDispatchTimes.get(project.key) ?? 0;
    if (reason === "milestone" && now - lastTime < debounceMs) {
      return { success: true, skipped: true, reason: "debounced" };
    }

    // One-active-job-per-project coordination
    const running = this.activeJobs.get(project.key);
    if (running) {
      return new Promise<TaskManagerDispatchResult>((resolve, reject) => {
        const existing = this.pendingRequests.get(project.key);
        if (existing) {
          existing.params = params;
          existing.resolvers.push({ resolve, reject });
        } else {
          this.pendingRequests.set(project.key, {
            params,
            resolvers: [{ resolve, reject }],
          });
        }
      });
    }

    const execute = async (): Promise<TaskManagerDispatchResult> => {
      this.lastDispatchTimes.set(project.key, Date.now());
      store.setProject(project.key, { syncStatus: "running" });
      await withDashboardWriteLock(dashboardPath, () => {
        setTaskManagerRunningState(dashboardPath, reason);
      });

      // Collect and sync host-side git evidence
      try {
        await syncTaskManagerGitEvidence({ project, dashboardPath });
      } catch (gitErr) {
        log.warn(`TaskManagerDispatcher: git evidence sync failed for ${project.key}`, gitErr);
      }

      if (params.client) {
        try {
          await syncTaskManagerTokenTelemetry({
            client: params.client,
            project,
            dashboardPath,
          });
        } catch (telemetryErr) {
          log.warn(`TaskManagerDispatcher: token telemetry sync failed for ${project.key}`, telemetryErr);
        }
      }

      const initialized = store.isInitialized(project.key);
      const mode: "init" | "refresh" = initialized ? "refresh" : "init";
      const prompt = mode === "init"
        ? buildTaskManagerInitPrompt(project, dashboardPath)
        : buildTaskManagerRefreshPrompt(project, dashboardPath, milestone);

      try {
        const runResult = await runner({
          project,
          prompt,
          mode,
          milestone,
          dashboardPath,
          client: params.client,
        });

        if (runResult.success) {
          if (runResult.prolonged) {
            // Prompt accepted, agent is processing in background.
            // Mark prolonged without marking initialized (keeps project eligible for safe retry on later openings).
            store.markProlonged(project.key);
            await withDashboardWriteLock(dashboardPath, () => {
              setTaskManagerProlongedState(dashboardPath, "agent-task-manager");
            });

            // Baseline fingerprint is captured after writing prolonged state
            const prolongedBaselineFingerprint = captureTaskManagerIslandFingerprint(dashboardPath);

            // Launch detached bounded monitor (sparse polling, max 3 checks)
            this.activeMonitors.get(project.key)?.cancel();
            const monitor = new TaskManagerProlongedMonitor({
              project,
              dashboardPath,
              initialFingerprint: prolongedBaselineFingerprint,
              store,
              ...params.monitorOptions,
              onStatusChange: (status) => {
                this.activeMonitors.delete(project.key);
                params.monitorOptions?.onStatusChange?.(status);
              },
            });
            this.activeMonitors.set(project.key, monitor);

            return { success: true, mode, prolonged: true };
          }

          if (params.client) {
            try {
              await syncTaskManagerTokenTelemetry({
                client: params.client,
                project,
                dashboardPath,
              });
            } catch {
              // Non-fatal
            }
          }
          store.markInitialized(project.key);
          if (milestone) {
            store.setProject(project.key, { lastMilestone: milestone });
          }
          await withDashboardWriteLock(dashboardPath, () => {
            setTaskManagerSyncedState(dashboardPath, "agent-task-manager");
          });
          return { success: true, mode };
        }

        // On failure, do NOT mark initialized if it was an init attempt (ensures safe retry)
        const errorMessage = runResult.error ?? "Unknown runner failure";
        store.markFailed(project.key, errorMessage);
        await withDashboardWriteLock(dashboardPath, () => {
          setTaskManagerErrorState(dashboardPath, errorMessage, "agent-task-manager");
        });
        log.warn(`TaskManagerDispatcher: sync failed for project ${project.key}: ${errorMessage}`);
        return { success: false, mode, error: runResult.error };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        store.markFailed(project.key, message);
        await withDashboardWriteLock(dashboardPath, () => {
          setTaskManagerErrorState(dashboardPath, message, "agent-task-manager");
        });
        log.warn(`TaskManagerDispatcher: unexpected error for project ${project.key}`, error);
        return { success: false, mode, error: message };
      } finally {
        this.activeJobs.delete(project.key);
        const pending = this.pendingRequests.get(project.key);
        this.pendingRequests.delete(project.key);
        if (pending) {
          this.dispatch(pending.params).then(
            (res) => {
              for (const { resolve } of pending.resolvers) resolve(res);
            },
            (err) => {
              for (const { reject } of pending.resolvers) reject(err);
            }
          );
        }
      }
    };

    const job = execute();
    this.activeJobs.set(project.key, job);
    return job;
  }
}

let globalDispatcher: TaskManagerDispatcher | null = null;

export function getGlobalTaskManagerDispatcher(): TaskManagerDispatcher {
  if (!globalDispatcher) {
    globalDispatcher = new TaskManagerDispatcher();
  }
  return globalDispatcher;
}

export function setTaskManagerDispatcherForTests(dispatcher: TaskManagerDispatcher | null): void {
  globalDispatcher = dispatcher;
}

export async function dispatchTaskManagerSync(params: TaskManagerDispatchParams): Promise<TaskManagerDispatchResult> {
  const dispatcher = globalDispatcher ?? getGlobalTaskManagerDispatcher();
  return dispatcher.dispatch(params);
}
