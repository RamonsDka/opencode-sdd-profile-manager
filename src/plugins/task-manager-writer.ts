import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

type Task = { id: string; status?: string; [key: string]: unknown };
type State = { tasks?: Task[]; [key: string]: unknown };

const STATE_ISLAND = /(<script\b[^>]*\bid=["']tm-state["'][^>]*>)([\s\S]*?)(<\/script>)/i;
const VALID_STATUS = new Set(["pending", "in-progress", "completed", "blocked"]);
const SYNC_META_FIELDS = new Set([
  "signature",
  "templateVersion",
  "schemaVersion",
  "stateVersion",
  "pluginVersion",
  "lastSyncAt",
  "lastSyncCompletedAt",
  "lastSyncSource",
  "syncStatus",
  "lastUpdated",
  "branch",
  "commit",
]);

function mergeSyncMetadata(prior: State, evidence: State): Record<string, unknown> | undefined {
  const sources = [prior.meta, evidence.meta].filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object");
  const metadata = Object.fromEntries(sources.flatMap((source) => Object.entries(source).filter(([key]) => SYNC_META_FIELDS.has(key))));
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function mergeTaskManagerState(prior: State, evidence: State): State {
  const updates = new Map((evidence.tasks ?? []).map((task) => [task.id, task]));
  const existing = (prior.tasks ?? []).map((task) => {
    const update = updates.get(task.id);
    if (!update) return { ...task, possiblyStale: true };
    updates.delete(task.id);
    const { possiblyStale: _, ...preservedTask } = task;
    return { ...preservedTask, ...Object.fromEntries(Object.entries(update).filter(([key]) => key === "status")) };
  });
  const { meta: _priorMeta, conversation: _conversation, ...preservedPrior } = prior;
  const metadata = mergeSyncMetadata(prior, evidence);
  const tokenUsage = (evidence.tokenUsage !== undefined ? evidence.tokenUsage : prior.tokenUsage) as unknown;
  const git = (evidence.git !== undefined ? evidence.git : prior.git) as unknown;
  return {
    ...preservedPrior,
    ...(git !== undefined ? { git } : {}),
    ...(tokenUsage !== undefined ? { tokenUsage } : {}),
    ...(metadata ? { meta: metadata } : {}),
    tasks: [...existing, ...updates.values()],
  };
}

function validateState(state: State): void {
  for (const task of state.tasks ?? []) {
    if (!task.id || (task.status !== undefined && !VALID_STATUS.has(task.status))) throw new Error("Task Manager state contains an invalid task status.");
  }
}

export function replaceTaskManagerState(html: string, state: State): string {
  validateState(state);
  const json = JSON.stringify(state).replaceAll("</script>", "\\u003c/script>");
  if (!STATE_ISLAND.test(html)) throw new Error("Managed Task Manager state island is missing.");
  return html.replace(STATE_ISLAND, (_match, open, _current, close) => `${open}${json}${close}`);
}

export type AtomicFilePort = {
  write(file: string, content: string): void;
  flush(file: string): void;
  rename(from: string, to: string): void;
};

const nodeAtomicFilePort: AtomicFilePort = {
  write: (file, content) => {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(file, content, "utf8");
  },
  flush: (file) => {
    try {
      const descriptor = fs.openSync(file, "r+");
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    } catch {
      // Best-effort flush across platforms
    }
  },
  rename: (from, to) => {
    try {
      fs.renameSync(from, to);
    } catch {
      // Fallback for Windows lock / antivirus contention
      fs.copyFileSync(from, to);
      try { fs.unlinkSync(from); } catch {}
    }
  },
};

export function generateUniqueTempPath(file: string): string {
  const dir = path.dirname(file);
  const basename = path.basename(file);
  const randomSuffix = crypto.randomBytes(6).toString("hex");
  return path.join(dir, `.${basename}.${process.pid}.${Date.now()}.${randomSuffix}.tmp`);
}

export function writeTaskManagerStateAtomically(file: string, html: string, port: AtomicFilePort = nodeAtomicFilePort): void {
  const isCustomPort = port !== nodeAtomicFilePort;
  const temporary = isCustomPort ? `${file}.tmp` : generateUniqueTempPath(file);

  try {
    port.write(temporary, html);
    port.flush(temporary);
    try {
      port.rename(temporary, file);
    } catch (error) {
      try {
        port.rename(temporary, file);
      } catch {
        throw error;
      }
    }
  } finally {
    if (!isCustomPort) {
      try {
        if (fs.existsSync(temporary)) {
          fs.unlinkSync(temporary);
        }
      } catch {}
    }
  }
}

export class KeyedWriteQueue {
  private queues = new Map<string, Promise<unknown>>();

  public async runExclusive<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const canonicalKey = path.win32.normalize(key).replaceAll("\\", "/").toLowerCase();
    const previous = this.queues.get(canonicalKey) ?? Promise.resolve();
    let resolveCurrent!: () => void;
    const current = new Promise<void>((r) => {
      resolveCurrent = r;
    });
    this.queues.set(canonicalKey, current);

    try {
      await previous.catch(() => {});
      return await fn();
    } finally {
      resolveCurrent();
      if (this.queues.get(canonicalKey) === current) {
        this.queues.delete(canonicalKey);
      }
    }
  }
}

export const globalDashboardWriteQueue = new KeyedWriteQueue();

export async function withDashboardWriteLock<T>(filePath: string, fn: () => Promise<T> | T): Promise<T> {
  return globalDashboardWriteQueue.runExclusive(filePath, fn);
}

export async function updateTaskManagerStateIsland(
  filePath: string,
  updater: (currentState: Record<string, any>) => Record<string, any> | void
): Promise<boolean> {
  return withDashboardWriteLock(filePath, async () => {
    if (!fs.existsSync(filePath)) return false;
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const match = content.match(STATE_ISLAND);
      if (!match) return false;

      let state: Record<string, any>;
      try {
        state = JSON.parse(match[2]);
      } catch {
        return false;
      }

      const result = updater(state);
      const finalState = result ?? state;
      const json = JSON.stringify(finalState).replaceAll("</script>", "\\u003c/script>");
      const updatedHtml = content.replace(STATE_ISLAND, (_match, open, _current, close) => `${open}${json}${close}`);
      writeTaskManagerStateAtomically(filePath, updatedHtml);
      return true;
    } catch {
      return false;
    }
  });
}
