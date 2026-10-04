import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { defaultState, type State, type ManualApiOutcome } from "./model.ts";
import { validateState } from "./policy.ts";

export function normalizeManualApiOutcome(record: any): ManualApiOutcome {
  const timestamp = typeof record.at === "number" ? record.at : Date.now();
  const deletedArr = Array.isArray(record.deleted) ? record.deleted : [];
  const deletedFamiliesCount = typeof record.deletedFamiliesCount === "number"
    ? record.deletedFamiliesCount
    : deletedArr.length;

  const deletedSessionsCount = typeof record.deletedSessionsCount === "number"
    ? record.deletedSessionsCount
    : undefined;

  const targetFamiliesCount = typeof record.targetFamiliesCount === "number"
    ? record.targetFamiliesCount
    : undefined;

  const targetSessionsCount = typeof record.targetSessionsCount === "number"
    ? record.targetSessionsCount
    : undefined;

  const error = record.error ? String(record.error) : undefined;

  let status: "success" | "partial" | "failed";
  if (record.status === "success" || record.status === "partial" || record.status === "failed") {
    status = record.status;
  } else if (error) {
    status = deletedFamiliesCount > 0 ? "partial" : "failed";
  } else {
    status = "success";
  }

  const backupVerified = typeof record.backupVerified === "boolean" ? record.backupVerified : false;
  const uncertainDescendants = typeof record.uncertainDescendants === "boolean"
    ? record.uncertainDescendants
    : Boolean(error && status !== "success");
  const archivesArr = Array.isArray(record.archives) ? record.archives : [];
  const dbSizeBytesBefore = typeof record.dbSizeBytesBefore === "number" ? record.dbSizeBytesBefore : undefined;
  const dbSizeBytesAfter = typeof record.dbSizeBytesAfter === "number" ? record.dbSizeBytesAfter : undefined;
  const dbSizeDeltaBytes = typeof record.dbSizeDeltaBytes === "number"
    ? record.dbSizeDeltaBytes
    : (dbSizeBytesBefore !== undefined && dbSizeBytesAfter !== undefined ? dbSizeBytesAfter - dbSizeBytesBefore : undefined);
  const walSizeBytesBefore = typeof record.walSizeBytesBefore === "number" ? record.walSizeBytesBefore : undefined;
  const walSizeBytesAfter = typeof record.walSizeBytesAfter === "number" ? record.walSizeBytesAfter : undefined;

  return {
    operationId: record.operationId ? String(record.operationId) : undefined,
    timestamp,
    status,
    deletedFamiliesCount,
    deletedSessionsCount,
    targetFamiliesCount,
    targetSessionsCount,
    backupVerified,
    uncertainDescendants,
    error,
    archivesCount: archivesArr.length,
    dbSizeBytesBefore,
    dbSizeBytesAfter,
    dbSizeDeltaBytes,
    walSizeBytesBefore,
    walSizeBytesAfter,
  };
}

export function stateDirectory() {
  return process.env.OPENCODE_SESSION_VAULT_HOME || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "opencode-session-vault");
}
export async function atomicWrite(file: string, text: string | Uint8Array) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, "wx", 0o600);
  try { await handle.writeFile(text); await handle.sync(); }
  finally { await handle.close(); }
  try { await fs.rename(temp, file); } catch (e) { await fs.rm(temp, { force: true }); throw e; }
}
export class Store {
  dir: string;
  constructor(dir = stateDirectory()) { this.dir = dir; }
  async read(): Promise<State> {
    try { return validateState(JSON.parse(await fs.readFile(path.join(this.dir, "state.json"), "utf8"))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return defaultState(); throw e; }
  }
  async save(state: State) { validateState(state); await atomicWrite(path.join(this.dir, "state.json"), JSON.stringify(state, null, 2)); }
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const lock = path.join(this.dir, "operation.lock");
    let handle;
    try { handle = await fs.open(lock, "wx", 0o600); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Otra operación está en curso. Si OpenCode se cerró de golpe, usa el reparador de bloqueo incluido con todas las instancias cerradas.");
      throw e;
    }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() })); await handle.sync(); return await fn(); }
    finally { await handle.close(); await fs.unlink(lock); }
  }
  async update(fn: (state: State) => void) {
    return this.exclusive(async () => { const state = await this.read(); fn(state); state.revision++; await this.save(state); return state; });
  }
  async migrate(): Promise<{ migrated: boolean; state: State }> {
    const file = path.join(this.dir, "state.json");
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return this.exclusive(async () => {
          try {
            const recheck = await fs.readFile(file, "utf8");
            const parsed = JSON.parse(recheck);
            return { migrated: false, state: validateState(parsed) };
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
              return { migrated: false, state: defaultState() };
            }
            throw err;
          }
        });
      }
      throw e;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Configuración corrupta. Se detuvo la migración para no sobrescribir el archivo.");
    }

    if (parsed && typeof parsed === "object" && parsed.schema === 2) {
      const validated = validateState(parsed);
      return { migrated: false, state: validated };
    }

    if (!parsed || typeof parsed !== "object" || parsed.schema !== 1) {
      throw new Error("Configuración corrupta. Se detuvo la migración para no sobrescribir el archivo.");
    }

    return this.exclusive(async () => {
      const rawUnderLock = await fs.readFile(file, "utf8");
      let parsedUnderLock: any;
      try {
        parsedUnderLock = JSON.parse(rawUnderLock);
      } catch {
        throw new Error("Configuración corrupta. Se detuvo la migración para no sobrescribir el archivo.");
      }
      if (parsedUnderLock && typeof parsedUnderLock === "object" && parsedUnderLock.schema === 2) {
        return { migrated: false, state: validateState(parsedUnderLock) };
      }
      validateState(parsedUnderLock);
      const migratedState: State = {
        schema: 2,
        revision: (Number.isSafeInteger(parsedUnderLock.revision) ? parsedUnderLock.revision : 0) + 1,
        config: {
          ...parsedUnderLock.config,
          scope: "global",
          automatic: false,
        },
        pins: Array.isArray(parsedUnderLock.pins) ? [...parsedUnderLock.pins] : [],
        quotas: parsedUnderLock.quotas && typeof parsedUnderLock.quotas === "object" ? { ...parsedUnderLock.quotas } : {},
        lastRun: Number.isFinite(parsedUnderLock.lastRun) ? parsedUnderLock.lastRun : 0,
      };
      delete migratedState.quotas["global"];
      validateState(migratedState);
      await atomicWrite(file, JSON.stringify(migratedState, null, 2));
      return { migrated: true, state: migratedState };
    });
  }
  async audit(record: Record<string, unknown>) {
    // One file per run: no concurrent append or unbounded log in memory.
    await atomicWrite(path.join(this.dir, "history", `${Date.now()}-${randomUUID()}.json`), JSON.stringify(record, null, 2));
  }
  async getLastManualApiOutcome(): Promise<ManualApiOutcome | null> {
    const historyDir = path.join(this.dir, "history");
    let entries: string[];
    try {
      entries = await fs.readdir(historyDir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    const jsonFiles = entries
      .filter(f => f.endsWith(".json"))
      .sort((a, b) => {
        const timeA = parseInt(a.split("-")[0], 10) || 0;
        const timeB = parseInt(b.split("-")[0], 10) || 0;
        return timeB - timeA;
      });

    for (const file of jsonFiles) {
      try {
        const raw = await fs.readFile(path.join(historyDir, file), "utf8");
        const record = JSON.parse(raw);
        if (record && typeof record === "object" && record.mode === "manual-api") {
          return normalizeManualApiOutcome(record);
        }
      } catch {
        // Corrupted file should be ignored without aborting
      }
    }
    return null;
  }
}
