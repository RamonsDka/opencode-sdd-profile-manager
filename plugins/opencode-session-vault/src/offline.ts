import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import {
  PROFILES,
  type Config,
  type Family,
  type Quota,
  type Session,
  type State,
} from "./model.ts";
import { familiesOf, resolveQuota, isFamilyActiveProject, validateState } from "./policy.ts";
import { atomicWrite, type Store } from "./store.ts";

const execFileAsync = promisify(execFile);

export { defaultDatabasePath } from "./db-path.ts";

export {
  type OfflineFamilySummary,
  type OfflinePlan,
  type InspectResult,
  type ArmedPlan,
  type MaintenanceReceipt,
  type PidLiveness,
  type ClaimedStateReport,
  ARMED_PLAN_FILE,
  CLAIMED_PLAN_FILE,
  RECEIPT_FILE,
  armOfflinePlan,
  cancelArmedPlan,
  getArmedPlan,
  getClaimedPlan,
  inspectClaimedState,
  checkPidLiveness,
  writeReceipt,
  getReceipt,
  clearReceipt,
} from "./coordination.ts";

import {
  type OfflineFamilySummary,
  type OfflinePlan,
  type InspectResult,
  type ArmedPlan,
  type MaintenanceReceipt,
  type PidLiveness,
  type ClaimedStateReport,
  ARMED_PLAN_FILE,
  CLAIMED_PLAN_FILE,
  RECEIPT_FILE,
  armOfflinePlan,
  cancelArmedPlan,
  getArmedPlan,
  getClaimedPlan,
  inspectClaimedState,
  checkPidLiveness,
  writeReceipt,
  getReceipt,
  clearReceipt,
} from "./coordination.ts";

export interface OfflineApplyResult {
  status: "success" | "partial_success";
  deletedFamilies: string[];
  deletedSessions: string[];
  backupPath: string;
  initialSizeBytes: number;
  finalSizeBytes?: number;
  spaceFreedBytes?: number;
  vacuumError?: string;
  vacuumSkipped?: boolean;
}

/**
 * Check if OpenCode process is running (fail-closed).
 * Throws if running or if process check fails.
 */
export async function checkOpenCodeProcessRunning(options?: {
  checker?: () => boolean | Promise<boolean>;
}): Promise<void> {
  if (options?.checker) {
    const isRunning = await options.checker();
    if (isRunning) {
      throw new Error(
        "OpenCode se encuentra en ejecución (proceso activo detectado). Cierra todas las instancias de OpenCode para realizar el mantenimiento fuera de línea."
      );
    }
    return;
  }

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq opencode.exe", "/NH"], {
        windowsHide: true,
      });
      if (stdout.toLowerCase().includes("opencode.exe")) {
        throw new Error(
          "OpenCode se encuentra en ejecución (opencode.exe detectado). Cierra todas las instancias de OpenCode para realizar el mantenimiento fuera de línea."
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("OpenCode se encuentra en ejecución")) {
        throw err;
      }
      throw new Error(`No se pudo comprobar si OpenCode está abierto: ${String(err)}`);
    }
  } else {
    try {
      const { stdout } = await execFileAsync("pgrep", ["-x", "opencode"]);
      if (stdout.trim().length > 0) {
        throw new Error(
          "OpenCode se encuentra en ejecución (proceso activo detectado). Cierra todas las instancias de OpenCode para realizar el mantenimiento fuera de línea."
        );
      }
    } catch (err: unknown) {
      const execErr = err as { code?: number };
      if (execErr.code === 1) {
        // pgrep returns 1 when no processes matched -> safe
        return;
      }
      if (err instanceof Error && err.message.includes("OpenCode se encuentra en ejecución")) {
        throw err;
      }
      throw new Error(`No se pudo comprobar si OpenCode está abierto: ${String(err)}`);
    }
  }
}

/**
 * Validates known dependent tables and rejects unknown tables with session_id/message_id lacking FK CASCADE.
 * Does not assume foreign_key_check detects relations without FK constraints.
 */
export function validateDestructiveSchema(db: DatabaseSync): void {
  const userTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;

  const KNOWN_DEPENDENTS = new Set(["message", "part", "todo", "session_share"]);

  for (const t of userTables) {
    const tableName = t.name;
    const lowerName = tableName.toLowerCase();
    if (lowerName === "session") continue;

    const tableCols = (
      db.prepare(`PRAGMA table_info('${tableName.replace(/'/g, "''")}')`).all() as Array<{ name: string }>
    ).map(c => c.name.toLowerCase());

    const fks = db.prepare(`PRAGMA foreign_key_list('${tableName.replace(/'/g, "''")}')`).all() as Array<{
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>;

    const isKnown = KNOWN_DEPENDENTS.has(lowerName) || lowerName.startsWith("session_");

    if (isKnown) {
      if (lowerName === "message") {
        const hasSessionFk = fks.some(
          fk =>
            fk.table.toLowerCase() === "session" &&
            (fk.from.toLowerCase() === "session_id" || fk.from.toLowerCase() === "sessionid") &&
            fk.on_delete.toUpperCase() === "CASCADE"
        );
        if (!hasSessionFk) {
          throw new Error(
            `La tabla dependiente 'message' no tiene clave foránea ON DELETE CASCADE hacia session(id).`
          );
        }
      } else if (lowerName === "part") {
        const hasCascadeFk = fks.some(
          fk =>
            ((fk.table.toLowerCase() === "message" &&
              (fk.from.toLowerCase() === "message_id" || fk.from.toLowerCase() === "messageid")) ||
              (fk.table.toLowerCase() === "session" &&
                (fk.from.toLowerCase() === "session_id" || fk.from.toLowerCase() === "sessionid"))) &&
            fk.on_delete.toUpperCase() === "CASCADE"
        );
        if (!hasCascadeFk) {
          throw new Error(
            `La tabla dependiente 'part' no tiene clave foránea ON DELETE CASCADE hacia message/session.`
          );
        }
      } else if (lowerName === "todo" || lowerName.startsWith("session_")) {
        if (tableCols.includes("session_id") || tableCols.includes("sessionid")) {
          const hasSessionFk = fks.some(
            fk =>
              fk.table.toLowerCase() === "session" &&
              (fk.from.toLowerCase() === "session_id" || fk.from.toLowerCase() === "sessionid") &&
              fk.on_delete.toUpperCase() === "CASCADE"
          );
          if (!hasSessionFk) {
            throw new Error(
              `La tabla dependiente '${tableName}' no tiene clave foránea ON DELETE CASCADE hacia session(id).`
            );
          }
        }
      }
    } else {
      // Unknown table: reject if it has session_id or message_id without expected FK CASCADE
      const relatedCol = tableCols.find(c =>
        ["session_id", "sessionid", "message_id", "messageid"].includes(c)
      );
      if (relatedCol) {
        const hasValidCascade = fks.some(fk => {
          const target = fk.table.toLowerCase();
          const from = fk.from.toLowerCase();
          const isCascade = fk.on_delete.toUpperCase() === "CASCADE";
          if (target === "session" && (from === "session_id" || from === "sessionid") && isCascade) return true;
          if (target === "message" && (from === "message_id" || from === "messageid") && isCascade) return true;
          return false;
        });
        if (!hasValidCascade) {
          throw new Error(
            `Tabla desconocida '${tableName}' contiene columna relacionada ('${relatedCol}') sin clave foránea ON DELETE CASCADE hacia session/message. Riesgo de orfandad; esquema incompatible.`
          );
        }
      }
    }
  }
}

function serializeSnapshotValue(val: unknown): string {
  if (val === null || val === undefined) return "N";
  if (typeof val === "bigint") return `B:${val.toString()}`;
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
    return `X:${Buffer.from(val).toString("hex")}`;
  }
  if (typeof val === "number") {
    return Number.isFinite(val) ? `D:${val}` : "N";
  }
  if (typeof val === "boolean") return val ? "T" : "F";
  if (typeof val === "string") {
    return `S:${Buffer.byteLength(val, "utf8")}:${val}`;
  }
  const json = JSON.stringify(val, (_, v) =>
    typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v
  );
  return `J:${Buffer.byteLength(json ?? "", "utf8")}:${json ?? ""}`;
}

/**
 * Computes snapshot checksum fingerprint and data_version covering target sessions,
 * child messages, message parts, and dependent session entities across selected families.
 * Uses bounded row-by-row streaming iterator (no global memory hydration) to safely handle
 * multi-gigabyte databases without holding tables in memory.
 * Handles deterministic BLOB and BigInt serialization, and adapts to schema columns fail-closed.
 * Note: This produces an integrity checksum / hash of candidate content, not a cryptographic signature.
 */
export function computeCandidateSnapshot(
  db: DatabaseSync,
  sessionIds: string[]
): { snapshotHash: string; dataVersion: number } {
  const dataVersionRow = db.prepare("PRAGMA data_version").get() as { data_version?: number } | undefined;
  const dataVersion = dataVersionRow?.data_version ?? 0;
  if (sessionIds.length === 0) {
    return { snapshotHash: "", dataVersion };
  }

  const hasher = createHash("sha256");
  const placeholders = sessionIds.map(() => "?").join(", ");

  // 1. Session table (required)
  const sessionTableCheck = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'")
    .get();
  if (!sessionTableCheck) {
    throw new Error("La base de datos no contiene la tabla requerida 'session'.");
  }

  const sessionCols = (db.prepare("PRAGMA table_info('session')").all() as Array<{ name: string }>).map(c => c.name);
  if (!sessionCols.includes("id")) {
    throw new Error("La tabla 'session' no contiene la columna clave 'id'.");
  }
  const sortedSessionCols = [...sessionCols].sort();
  hasher.update(`table:session:${sortedSessionCols.join(",")}\n`);

  const sessionStmt = db.prepare(
    `SELECT ${sortedSessionCols.map(c => `"${c.replace(/"/g, '""')}"`).join(", ")} FROM session WHERE id IN (${placeholders}) ORDER BY id ASC`
  );
  sessionStmt.setReadBigInts(true);
  for (const row of sessionStmt.iterate(...sessionIds)) {
    const line = sortedSessionCols.map(c => serializeSnapshotValue((row as Record<string, unknown>)[c])).join("\x1f");
    hasher.update(`r:${line}\n`);
  }

  // 2. Message table (if exists)
  const messageTableCheck = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message'")
    .get();

  let hasMessageTable = false;
  let messageSessionCol: string | undefined;

  if (messageTableCheck) {
    hasMessageTable = true;
    const msgCols = (db.prepare("PRAGMA table_info('message')").all() as Array<{ name: string }>).map(c => c.name);
    messageSessionCol = msgCols.find(c => c.toLowerCase() === "session_id" || c.toLowerCase() === "sessionid");
    if (!messageSessionCol || !msgCols.includes("id")) {
      throw new Error("La tabla dependiente 'message' no contiene columnas requeridas 'id' y 'session_id'.");
    }
    const sortedMsgCols = [...msgCols].sort();
    hasher.update(`table:message:${sortedMsgCols.join(",")}\n`);

    const msgStmt = db.prepare(
      `SELECT ${sortedMsgCols.map(c => `"${c.replace(/"/g, '""')}"`).join(", ")} FROM message WHERE "${messageSessionCol}" IN (${placeholders}) ORDER BY id ASC`
    );
    msgStmt.setReadBigInts(true);
    for (const row of msgStmt.iterate(...sessionIds)) {
      const line = sortedMsgCols.map(c => serializeSnapshotValue((row as Record<string, unknown>)[c])).join("\x1f");
      hasher.update(`r:${line}\n`);
    }
  }

  // 3. Part table (if exists)
  const partTableCheck = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'part'")
    .get();

  if (partTableCheck) {
    const partCols = (db.prepare("PRAGMA table_info('part')").all() as Array<{ name: string }>).map(c => c.name);
    const partSessionCol = partCols.find(c => c.toLowerCase() === "session_id" || c.toLowerCase() === "sessionid");
    const partMessageCol = partCols.find(c => c.toLowerCase() === "message_id" || c.toLowerCase() === "messageid");

    if (!partSessionCol && !partMessageCol) {
      throw new Error(
        "La tabla dependiente 'part' existe pero no posee columna 'session_id' ni 'message_id' para asociar a sesiones candidatas."
      );
    }

    const sortedPartCols = [...partCols].sort();
    hasher.update(`table:part:${sortedPartCols.join(",")}\n`);

    const orderCol = partCols.includes("id") ? 'ORDER BY "id" ASC' : "ORDER BY rowid ASC";

    let partStmt;
    if (partSessionCol && partMessageCol && hasMessageTable && messageSessionCol) {
      partStmt = db.prepare(
        `SELECT ${sortedPartCols.map(c => `"${c.replace(/"/g, '""')}"`).join(", ")} FROM part WHERE "${partSessionCol}" IN (${placeholders}) OR "${partMessageCol}" IN (SELECT id FROM message WHERE "${messageSessionCol}" IN (${placeholders})) ${orderCol}`
      );
    } else if (partSessionCol) {
      partStmt = db.prepare(
        `SELECT ${sortedPartCols.map(c => `"${c.replace(/"/g, '""')}"`).join(", ")} FROM part WHERE "${partSessionCol}" IN (${placeholders}) ${orderCol}`
      );
    } else if (partMessageCol && hasMessageTable && messageSessionCol) {
      partStmt = db.prepare(
        `SELECT ${sortedPartCols.map(c => `"${c.replace(/"/g, '""')}"`).join(", ")} FROM part WHERE "${partMessageCol}" IN (SELECT id FROM message WHERE "${messageSessionCol}" IN (${placeholders})) ${orderCol}`
      );
    } else {
      throw new Error(
        "La tabla dependiente 'part' se asocia vía 'message_id' pero la tabla 'message' no está disponible en la base de datos."
      );
    }

    partStmt.setReadBigInts(true);
    for (const row of partStmt.iterate(...sessionIds)) {
      const line = sortedPartCols.map(c => serializeSnapshotValue((row as Record<string, unknown>)[c])).join("\x1f");
      hasher.update(`r:${line}\n`);
    }
  }

  // 4. Other known session-dependent tables (e.g. todo, session_share)
  for (const depTableName of ["todo", "session_share"]) {
    const depTableCheck = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${depTableName}'`)
      .get();
    if (depTableCheck) {
      const depCols = (db.prepare(`PRAGMA table_info('${depTableName}')`).all() as Array<{ name: string }>).map(c => c.name);
      const depSessionCol = depCols.find(c => c.toLowerCase() === "session_id" || c.toLowerCase() === "sessionid");
      if (depSessionCol) {
        const sortedDepCols = [...depCols].sort();
        hasher.update(`table:${depTableName}:${sortedDepCols.join(",")}\n`);
        const orderCol = depCols.includes("id") ? 'ORDER BY "id" ASC' : "ORDER BY rowid ASC";
        const depStmt = db.prepare(
          `SELECT ${sortedDepCols.map(c => `"${c.replace(/"/g, '""')}"`).join(", ")} FROM ${depTableName} WHERE "${depSessionCol}" IN (${placeholders}) ${orderCol}`
        );
        depStmt.setReadBigInts(true);
        for (const row of depStmt.iterate(...sessionIds)) {
          const line = sortedDepCols.map(c => serializeSnapshotValue((row as Record<string, unknown>)[c])).join("\x1f");
          hasher.update(`r:${line}\n`);
        }
      }
    }
  }

  const hash = hasher.digest("hex");
  return { snapshotHash: hash, dataVersion };
}

/**
 * Computes plan fingerprint binding canonical path, state revision, scope, project, profile, selected families and snapshot hash.
 */
export function computePlanFingerprint(
  canonicalPath: string,
  stateRevision: number,
  scope: "global" | "project",
  projectID: string | undefined,
  profile: string,
  selectedFamilies: OfflineFamilySummary[],
  snapshotHash: string
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        canonicalPath,
        stateRevision,
        scope,
        projectID ?? "",
        profile,
        selectedFamilies.map(s => [s.rootId, s.memberIds.slice().sort(), s.updated]),
        snapshotHash,
      ])
    )
    .digest("hex");
}

/**
 * Validates canonical DB path, magic bytes and schema prerequisites.
 */
export function validateCanonicalDatabase(
  dbPath: string,
  options?: { checkSchema?: boolean; existingDb?: DatabaseSync }
): { canonicalPath: string; stat: fsSync.Stats; columns: string[] } {
  const resolved = path.resolve(String(dbPath).trim());
  const canonicalPath = process.platform === "win32" ? resolved.toLowerCase() : resolved;

  if (!fsSync.existsSync(canonicalPath)) {
    throw new Error(`El archivo de base de datos no existe: ${canonicalPath}`);
  }

  const stat = fsSync.statSync(canonicalPath);
  if (!stat.isFile()) {
    throw new Error(`La ruta indicada no es un archivo regular: ${canonicalPath}`);
  }

  // Check SQLite 3 magic header (16 bytes: "SQLite format 3\0")
  const fd = fsSync.openSync(canonicalPath, "r");
  const buffer = Buffer.alloc(16);
  try {
    fsSync.readSync(fd, buffer, 0, 16, 0);
  } finally {
    fsSync.closeSync(fd);
  }

  if (buffer.toString("utf8", 0, 15) !== "SQLite format 3" || buffer[15] !== 0) {
    throw new Error(`El archivo no es una base de datos SQLite válida: ${canonicalPath}`);
  }

  if (options?.checkSchema !== false) {
    const db = options?.existingDb ?? new DatabaseSync(canonicalPath, { readOnly: true });
    try {
      const tableCheck = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'")
        .get();
      if (!tableCheck) {
        throw new Error("No existe la tabla session en la base de datos. Esquema incompatible.");
      }

      const tableInfo = db.prepare("PRAGMA table_info(session)").all() as Array<{ name: string }>;
      const columns = tableInfo.map(c => c.name.toLowerCase());
      const required = ["id", "directory", "parent_id", "time_updated"];
      for (const req of required) {
        if (!columns.includes(req) && !columns.includes(req.replace("_", ""))) {
          throw new Error(`Falta la columna requerida '${req}' en la tabla session.`);
        }
      }

      validateDestructiveSchema(db);

      return { canonicalPath, stat, columns };
    } finally {
      if (!options?.existingDb) {
        db.close();
      }
    }
  }

  return { canonicalPath, stat, columns: [] };
}

/**
 * Pure inspection of the SQLite database. Read-only.
 * By default, skips destructive schema scans and skips heavy b-tree PRAGMA quick_check
 * to guarantee bounded execution on multi-gigabyte databases.
 * Integrity check can be explicitly requested via options.checkIntegrity.
 */
export async function inspectDatabase(
  dbPath: string,
  options?: { checkIntegrity?: boolean }
): Promise<InspectResult> {
  const { canonicalPath, stat } = validateCanonicalDatabase(dbPath, { checkSchema: false });
  const db = new DatabaseSync(canonicalPath, { readOnly: true });
  try {
    let integrity = "pending";
    if (options?.checkIntegrity) {
      const quickCheck = db.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
      integrity = quickCheck?.quick_check ?? "unknown";
      if (integrity !== "ok") {
        throw new Error(`La integridad de la base de datos no es correcta: ${integrity}`);
      }
    }

    const sessionTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'")
      .get();
    if (!sessionTable) {
      throw new Error("No existe la tabla session en la base de datos.");
    }

    const pageSizeRow = db.prepare("PRAGMA page_size").get() as { page_size?: number };
    const freelistRow = db.prepare("PRAGMA freelist_count").get() as { freelist_count?: number };
    const countRow = db.prepare("SELECT count(*) as cnt FROM session").get() as { cnt?: number };
    const tablesRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
      name: string;
    }>;

    const pageSize = pageSizeRow?.page_size ?? 4096;
    const freelistCount = freelistRow?.freelist_count ?? 0;
    const sessionCount = countRow?.cnt ?? 0;
    const tables = tablesRows.map(t => t.name);

    return {
      dbPath: canonicalPath,
      sizeBytes: stat.size,
      pageSize,
      freelistCount,
      freeBytes: freelistCount * pageSize,
      sessionCount,
      tables,
      integrity,
    };
  } finally {
    db.close();
  }
}

export interface OfflinePlanOptions {
  dbPath: string;
  store: Store;
  projectID?: string;
  batchLimit?: number;
  now?: number;
  processChecker?: () => boolean | Promise<boolean>;
  allowRunningProcess?: boolean;
}

/**
 * Generates an offline reviewable plan bound to canonical DB, profile, pins and complete session families.
 */
export async function generateOfflinePlan(options: OfflinePlanOptions): Promise<OfflinePlan> {
  // Fail-closed process check when not in explicit read-only planning mode
  if (!options.allowRunningProcess) {
    await checkOpenCodeProcessRunning({ checker: options.processChecker });
  }

  const { canonicalPath, stat } = validateCanonicalDatabase(options.dbPath, { checkSchema: true });
  const state = await options.store.read();
  validateState(state);

  const now = options.now ?? Date.now();
  const db = new DatabaseSync(canonicalPath, { readOnly: true });
  let sessions: Session[] = [];

  try {
    // Read session columns dynamically
    const tableInfo = db.prepare("PRAGMA table_info(session)").all() as Array<{ name: string }>;
    const cols = new Set(tableInfo.map(c => c.name.toLowerCase()));

    const idCol = "id";
    const titleCol = cols.has("title") ? "title" : "'' as title";
    const projCol = cols.has("project_id") ? "project_id" : cols.has("projectid") ? "projectid" : "'' as project_id";
    const dirCol = "directory";
    const parentCol = cols.has("parent_id") ? "parent_id" : cols.has("parentid") ? "parentid" : "NULL as parent_id";
    const createdCol = cols.has("time_created") ? "time_created" : cols.has("created") ? "created" : "0 as time_created";
    const updatedCol = cols.has("time_updated") ? "time_updated" : cols.has("updated") ? "updated" : "0 as time_updated";
    const archivedCol = cols.has("time_archived") ? "time_archived" : cols.has("archived") ? "archived" : "NULL as time_archived";

    const rows = db
      .prepare(
        `SELECT ${idCol} as id, ${titleCol} as title, ${projCol} as project_id, ${dirCol} as directory,
                ${parentCol} as parent_id, ${createdCol} as time_created, ${updatedCol} as time_updated,
                ${archivedCol} as time_archived FROM session`
      )
      .all() as Array<{
      id: string;
      title: string;
      project_id: string;
      directory: string;
      parent_id: string | null;
      time_created: number;
      time_updated: number;
      time_archived: number | null;
    }>;

    sessions = rows.map(r => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      projectID: String(r.project_id ?? ""),
      directory: String(r.directory ?? ""),
      parentID: r.parent_id ? String(r.parent_id) : undefined,
      time: {
        created: Number(r.time_created) || Number(r.time_updated) || now,
        updated: Number(r.time_updated) || Number(r.time_created) || now,
        archived: r.time_archived ? Number(r.time_archived) : undefined,
      },
    }));
  } finally {
    db.close();
  }

  // Group into complete families
  const families = familiesOf(sessions);
  const isGlobal = state.config.scope === "global";
  const activeProject = options.projectID?.trim() ?? "";
  const pins = new Set(state.pins);

  if (!isGlobal && !activeProject) {
    throw new Error(
      "El alcance configurado en Vault es 'project'. Se requiere especificar 'projectID' para generar el plan."
    );
  }

  const eligibleFamilies = isGlobal
    ? families
    : activeProject
    ? families.filter(f => isFamilyActiveProject(f, activeProject))
    : [];

  const unpinned = eligibleFamilies.filter(f => !f.members.some(s => pins.has(s.id)));
  const scopeKey = isGlobal ? "global" : `project:${activeProject}`;
  const quota = resolveQuota(state.config, unpinned.length, state.quotas[scopeKey], now);
  const keepIDs = new Set(unpinned.slice(0, quota.keep).map(f => f.root.id));

  for (const f of families) {
    if (!isGlobal && (!activeProject || !isFamilyActiveProject(f, activeProject))) {
      f.reasons.push("Otro proyecto");
    }
    if (f.members.some(s => pins.has(s.id))) f.reasons.push("Candado");
    if (!state.config.includeArchived && f.members.some(s => s.time.archived)) f.reasons.push("Archivada");
    if (f.updated > now - state.config.graceHours * 3600000) f.reasons.push("Actividad reciente");
    if (keepIDs.has(f.root.id)) f.reasons.push("Dentro del cupo");
    f.reasons = [...new Set(f.reasons)];
  }

  const candidates = families.filter(f => !f.reasons.length);
  const retained = families.filter(f => f.reasons.length);

  const batchLimit = Math.min(
    candidates.length,
    state.config.maxDeletePerRun,
    options.batchLimit ?? 100
  );

  // Oldest first for deletion
  const selected = [...candidates].reverse().slice(0, batchLimit);

  const selectedSummaries: OfflineFamilySummary[] = selected.map(f => ({
    rootId: f.root.id,
    memberIds: f.members.map(m => m.id),
    updated: f.updated,
    title: f.root.title,
    members: f.members.map(m => ({
      id: m.id,
      parentId: m.parentID,
      timeUpdated: m.time.updated,
    })),
  }));

  const targetMemberIds = selectedSummaries.flatMap(s => s.memberIds);
  const snapDb = new DatabaseSync(canonicalPath, { readOnly: true });
  let snapshotHash = "";
  let dataVersion = 0;
  try {
    const snap = computeCandidateSnapshot(snapDb, targetMemberIds);
    snapshotHash = snap.snapshotHash;
    dataVersion = snap.dataVersion;
  } finally {
    snapDb.close();
  }

  const fingerprint = computePlanFingerprint(
    canonicalPath,
    state.revision,
    state.config.scope,
    activeProject || undefined,
    state.config.profile,
    selectedSummaries,
    snapshotHash
  );

  return {
    version: 1,
    createdAt: now,
    expiresAt: now + 30 * 60 * 1000, // 30 min expiration
    canonicalDbPath: canonicalPath,
    dbStat: { size: stat.size, mtimeMs: stat.mtimeMs },
    stateRevision: state.revision,
    statePins: [...state.pins],
    scope: state.config.scope,
    projectID: activeProject || undefined,
    profile: state.config.profile,
    totalSessions: sessions.length,
    totalFamilies: families.length,
    candidateFamiliesCount: candidates.length,
    retainedFamiliesCount: retained.length,
    selectedFamilies: selectedSummaries,
    quota,
    snapshotHash,
    dataVersion,
    fingerprint,
  };
}

export interface ApplyOfflinePlanOptions {
  plan: OfflinePlan;
  dbPath: string;
  store: Store;
  confirmed: boolean;
  skipVacuum?: boolean;
  processChecker?: () => boolean | Promise<boolean>;
  _simulateErrorInTransaction?: boolean;
  _simulateBackupFailure?: boolean;
  _simulateVacuumFailure?: boolean;
  _simulateMutationAfterBackup?: boolean;
  _trustedTestExecution?: boolean;
  _claimedArmId?: string;
}

/**
 * Revalidates under transaction and applies offline cleanup + verifiable backup + vacuum.
 */
export async function applyOfflinePlan(options: ApplyOfflinePlanOptions): Promise<OfflineApplyResult> {
  // Production protective gate: centrally disallow destructive execution in production
  // without exclusive host coordination. Rejects pre-writable DB and pre-backup.
  if (!options._trustedTestExecution) {
    throw new Error(
      "Mantenimiento suspendido: operación interrumpida / exclusión no garantizada (coordinación exclusiva de host no disponible en producción)."
    );
  }

  // Incident containment gate: pending claim blocks execution
  const pendingClaim = await getClaimedPlan(options.store);
  if (pendingClaim && pendingClaim.id !== options._claimedArmId) {
    throw new Error(
      "Mantenimiento suspendido: operación interrumpida / exclusión no garantizada (se detectó un plan reclamado previo sin resolver)."
    );
  }

  if (!options.confirmed) {
    throw new Error("Operación destructiva no confirmada. Se requiere confirmación explícita para borrar.");
  }

  // 1. Process check (fail-closed)
  await checkOpenCodeProcessRunning({ checker: options.processChecker });

  // 2. Check plan expiration (freshness gate)
  if (Date.now() > options.plan.expiresAt) {
    throw new Error("El plan ha expirado (más de 30 minutos). Genera un plan nuevo antes de aplicar.");
  }

  // 3. Validate plan structure, limits, unique IDs and complete family members
  if (options.plan.version !== 1 || !Array.isArray(options.plan.selectedFamilies)) {
    throw new Error("Estructura de plan no válida.");
  }

  if (options.plan.selectedFamilies.length > 100) {
    throw new Error("El plan supera el límite máximo permitido de 100 familias por ejecución.");
  }

  const allTargetMemberIds: string[] = [];
  const seenMemberIds = new Set<string>();
  for (const fam of options.plan.selectedFamilies) {
    if (!fam.rootId || !Array.isArray(fam.memberIds) || !Array.isArray(fam.members)) {
      throw new Error("Familia en plan con formato inválido.");
    }
    if (!fam.memberIds.includes(fam.rootId)) {
      throw new Error(`La familia con raíz '${fam.rootId}' no incluye su raíz en memberIds.`);
    }
    if (fam.memberIds.length !== fam.members.length) {
      throw new Error(`Discrepancia en miembros de la familia '${fam.rootId}'.`);
    }
    const memberSet = new Set(fam.members.map(m => m.id));
    for (const mid of fam.memberIds) {
      if (!memberSet.has(mid)) {
        throw new Error(`Discrepancia de miembros en familia '${fam.rootId}': '${mid}' ausente en members.`);
      }
      if (seenMemberIds.has(mid)) {
        throw new Error(`ID de sesión duplicado detectado en el plan: '${mid}'.`);
      }
      seenMemberIds.add(mid);
      allTargetMemberIds.push(mid);
    }
  }

  // 4. Recompute and verify fingerprint to prevent plan manipulation
  const expectedFingerprint = computePlanFingerprint(
    options.plan.canonicalDbPath,
    options.plan.stateRevision,
    options.plan.scope,
    options.plan.projectID,
    options.plan.profile,
    options.plan.selectedFamilies,
    options.plan.snapshotHash
  );
  if (options.plan.fingerprint !== expectedFingerprint) {
    throw new Error(
      "La huella digital (fingerprint) del plan no coincide con su contenido. Plan manipulado o inválido rechazado."
    );
  }

  // 5. Check canonical DB path
  const { canonicalPath, stat } = validateCanonicalDatabase(options.dbPath, { checkSchema: true });
  if (canonicalPath !== options.plan.canonicalDbPath) {
    throw new Error(
      `La base de datos actual (${canonicalPath}) no coincide con la base del plan (${options.plan.canonicalDbPath}).`
    );
  }

  // 6. Re-check state from store: revision, scope, profile and pins
  const currentState = await options.store.read();
  validateState(currentState);
  if (currentState.revision !== options.plan.stateRevision) {
    throw new Error("La configuración de Vault ha cambiado (revisión diferente). Plan rechazado.");
  }
  if (currentState.config.scope !== options.plan.scope) {
    throw new Error("El alcance configurado en Vault ha cambiado. Plan rechazado.");
  }
  if (currentState.config.profile !== options.plan.profile) {
    throw new Error("El perfil configurado en Vault ha cambiado. Plan rechazado.");
  }

  const currentPins = new Set(currentState.pins);
  for (const id of allTargetMemberIds) {
    if (currentPins.has(id)) {
      throw new Error(`Se detectó un candado agregado a la sesión '${id}'. Plan rechazado.`);
    }
  }

  // 7. Preflight disk space check: DB size + backup + vacuum headroom (at least 2x db size)
  try {
    const fsStats = fsSync.statfsSync(path.dirname(canonicalPath));
    const freeBytes = fsStats.bavail * fsStats.bsize;
    const requiredBytes = stat.size * 2 + 16 * 1024 * 1024;
    if (freeBytes < requiredBytes) {
      throw new Error(
        `Espacio en disco insuficiente. Tamaño BD: ${(stat.size / 1024 ** 2).toFixed(1)} MiB; libres: ${(
          freeBytes / 1024 ** 2
        ).toFixed(1)} MiB (se requieren aprox. ${(requiredBytes / 1024 ** 2).toFixed(1)} MiB para respaldo y compactación).`
      );
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Espacio en disco insuficiente")) throw err;
    // If statfs is not supported on this specific OS volume, continue best effort
  }

  // 8. Pre-backup snapshot verification
  const preCheckDb = new DatabaseSync(canonicalPath, { readOnly: true });
  try {
    const preSnap = computeCandidateSnapshot(preCheckDb, allTargetMemberIds);
    if (preSnap.snapshotHash !== options.plan.snapshotHash) {
      throw new Error(
        "El contenido de las sesiones o mensajes cambió antes del respaldo. Plan stale rechazado."
      );
    }
  } finally {
    preCheckDb.close();
  }

  // 9. Verifiable SQLite backup prior to delete
  if (options._simulateBackupFailure) {
    throw new Error("simulated backup_failure");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${canonicalPath}.before-cleanup-${stamp}.sqlite`;

  const backupDb = new DatabaseSync(canonicalPath, { readOnly: true });
  try {
    // Note: VACUUM INTO creates a consistent SQLite snapshot
    backupDb.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}';`);
  } catch (err) {
    throw new Error(`Fallo al crear el respaldo previo de SQLite: ${String(err)}`);
  } finally {
    backupDb.close();
  }

  // Verify backup integrity
  if (!fsSync.existsSync(backupPath) || fsSync.statSync(backupPath).size === 0) {
    throw new Error("El archivo de respaldo no se creó correctamente o está vacío. Limpieza suspendida.");
  }

  const checkDb = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const backupIntegrity = checkDb.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
    if (backupIntegrity?.quick_check !== "ok") {
      throw new Error(`El respaldo no pasó la verificación de integridad: ${backupIntegrity?.quick_check}`);
    }
  } finally {
    checkDb.close();
  }

  // Hook for testing race condition: database mutated right after backup but before lock
  if (options._simulateMutationAfterBackup) {
    const mutDb = new DatabaseSync(canonicalPath);
    try {
      mutDb
        .prepare("INSERT INTO message (id, session_id, content, time_created) VALUES (?, ?, ?, ?)")
        .run(
          "msg_race_mutation",
          options.plan.selectedFamilies[0].rootId,
          "Race payload",
          Date.now()
        );
    } finally {
      mutDb.close();
    }
  }

  // 10. Transactional deletion under EXCLUSIVE lock
  // NOTE: In WAL mode, BEGIN EXCLUSIVE prevents concurrent writes, but does NOT block external
  // readers and does not cover the window between COMMIT and VACUUM. Offline single-writer discipline
  // with process checking before commit and vacuum is mandatory.
  const writableDb = new DatabaseSync(canonicalPath);
  const deletedFamilies: string[] = [];
  const deletedSessions: string[] = [];
  let finalSize = stat.size;
  let vacuumError: string | undefined;

  try {
    try {
      // Enforce foreign keys and acquire exclusive write transaction
      writableDb.exec("PRAGMA foreign_keys = ON;");
      writableDb.exec("BEGIN EXCLUSIVE;");

      // Revalidate state revision & pins under lock (guards against post-backup state mutations)
      const lockedState = await options.store.read();
      if (lockedState.revision !== options.plan.stateRevision) {
        throw new Error(
          "La configuración de Vault cambió durante o tras el respaldo. Plan stale rechazado."
        );
      }
      const lockedPins = new Set(lockedState.pins);
      for (const id of allTargetMemberIds) {
        if (lockedPins.has(id)) {
          throw new Error(`Se detectó un candado agregado a la sesión '${id}' tras el respaldo. Plan rechazado.`);
        }
      }

      // Revalidate snapshot hash under lock (verifies no mutation between backup and lock)
      const lockedSnap = computeCandidateSnapshot(writableDb, allTargetMemberIds);
      if (lockedSnap.snapshotHash !== options.plan.snapshotHash) {
        throw new Error(
          "Mutación detectada en las sesiones o mensajes entre el respaldo y la adquisición del bloqueo exclusivo. Plan stale rechazado."
        );
      }

      // Revalidate target sessions under transaction
      const placeholders = allTargetMemberIds.map(() => "?").join(", ");
      const currentRows = writableDb
        .prepare(
          `SELECT id, parent_id, time_updated FROM session WHERE id IN (${placeholders})`
        )
        .all(...allTargetMemberIds) as Array<{ id: string; parent_id: string | null; time_updated: number }>;

      if (currentRows.length !== allTargetMemberIds.length) {
        throw new Error("Las sesiones en la base de datos ya no existen o fueron eliminadas. Plan stale rechazado.");
      }

      const rowMap = new Map(currentRows.map(r => [r.id, r]));
      for (const fam of options.plan.selectedFamilies) {
        for (const expectedMember of fam.members) {
          const live = rowMap.get(expectedMember.id);
          if (!live) {
            throw new Error(`La sesión '${expectedMember.id}' ya no existe. Plan stale rechazado.`);
          }
          if (live.time_updated !== expectedMember.timeUpdated) {
            throw new Error(
              `Las sesiones fueron modificadas desde la creación del plan (sesión ${expectedMember.id} alterada). Plan stale rechazado.`
            );
          }
          const liveParent = live.parent_id ?? undefined;
          if (liveParent !== expectedMember.parentId) {
            throw new Error(
              `La jerarquía de sesiones cambió (parent_id de ${expectedMember.id} alterado). Plan stale rechazado.`
            );
          }
        }
      }

      // Check for new children under any member of target families
      const childCheck = writableDb
        .prepare(
          `SELECT id FROM session WHERE parent_id IN (${placeholders}) AND id NOT IN (${placeholders})`
        )
        .all(...allTargetMemberIds, ...allTargetMemberIds) as Array<{ id: string }>;

      if (childCheck.length > 0) {
        throw new Error(
          `Nueva sesión hija detectada (${childCheck.map(c => c.id).join(", ")}) en familias del plan. Plan stale rechazado.`
        );
      }

      if (options._simulateErrorInTransaction) {
        throw new Error("simulated_transaction_error");
      }

      // Delete session rows
      writableDb.prepare(`DELETE FROM session WHERE id IN (${placeholders})`).run(...allTargetMemberIds);

      // Foreign key check
      const fkViolations = writableDb.prepare("PRAGMA foreign_key_check").all();
      if (fkViolations.length > 0) {
        throw new Error(`Violación de claves foráneas al eliminar sesiones: ${JSON.stringify(fkViolations)}`);
      }

      // Integrity check
      const quickCheck = writableDb.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
      if (quickCheck?.quick_check !== "ok") {
        throw new Error(`Error de integridad tras borrado: ${quickCheck?.quick_check}`);
      }

      // Fail-closed process recheck right before COMMIT
      await checkOpenCodeProcessRunning({ checker: options.processChecker });

      writableDb.exec("COMMIT;");

      for (const f of options.plan.selectedFamilies) {
        deletedFamilies.push(f.rootId);
        for (const m of f.memberIds) deletedSessions.push(m);
      }
    } catch (err) {
      try {
        writableDb.exec("ROLLBACK;");
      } catch {}
      throw err;
    }

    // 11. Compaction / VACUUM (Separable result)
    // Fail-closed process recheck before VACUUM
    await checkOpenCodeProcessRunning({ checker: options.processChecker });

    if (!options.skipVacuum) {
      try {
        if (options._simulateVacuumFailure) {
          throw new Error("simulated_vacuum_failure");
        }
        writableDb.exec("VACUUM;");
        writableDb.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        finalSize = fsSync.statSync(canonicalPath).size;
      } catch (err: unknown) {
        vacuumError = err instanceof Error ? err.message : String(err);
      }
    }
  } finally {
    try {
      writableDb.close();
    } catch {}
  }

  if (vacuumError) {
    return {
      status: "partial_success",
      deletedFamilies,
      deletedSessions,
      backupPath,
      initialSizeBytes: stat.size,
      vacuumError,
    };
  }

  return {
    status: "success",
    deletedFamilies,
    deletedSessions,
    backupPath,
    initialSizeBytes: stat.size,
    finalSizeBytes: finalSize,
    spaceFreedBytes: Math.max(0, stat.size - finalSize),
    vacuumSkipped: Boolean(options.skipVacuum),
  };
}

export interface RunArmedOptions {
  store: Store;
  ownerPid?: number;
  dbPath?: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  processChecker?: () => boolean | Promise<boolean>;
  isOwnerAlive?: (pid: number) => boolean;
  isMonitorAlive?: (pid: number) => boolean;
  sleepFn?: (ms: number) => Promise<void>;
  skipVacuum?: boolean;
  _trustedTestExecution?: boolean;
}

/**
 * Runs armed offline maintenance following strict coordination invariants:
 * 1. Bounded wait for owner process exit.
 * 2. Fail-closed check: exactly 3 separated polls ensuring ALL OpenCode instances are closed.
 * 3. Atomic single-worker claim before execution.
 * 4. Transactional revalidation and apply with no destructive retry.
 * 5. Structured receipt recording.
 */
export async function runArmedMaintenance(options: RunArmedOptions): Promise<MaintenanceReceipt> {
  // Production protective gate: centrally disallow destructive execution in production
  if (!options._trustedTestExecution) {
    throw new Error(
      "Mantenimiento suspendido: operación interrumpida / exclusión no garantizada (coordinación exclusiva de host no disponible en producción)."
    );
  }

  const { store } = options;
  const armed = await getArmedPlan(store);
  if (!armed) {
    throw new Error("No hay ningún plan de mantenimiento armado en curso.");
  }

  const sleep = options.sleepFn ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const pollInterval = options.pollIntervalMs ?? 1000;
  const ownerPid = options.ownerPid ?? armed.ownerPid;

  const isAlive =
    options.isOwnerAlive ??
    ((pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });

  const isMonitorAlive =
    options.isMonitorAlive ??
    ((pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });

  // Check monitor liveness before anything else (fail closed if monitor closed by user)
  if (armed.monitorPid && !isMonitorAlive(armed.monitorPid)) {
    const receipt: MaintenanceReceipt = {
      version: 1,
      id: armed.id,
      planFingerprint: armed.plan.fingerprint,
      completedAt: Date.now(),
      status: "cancelled",
      deletedFamilies: [],
      deletedSessions: [],
      error: "El monitor de mantenimiento fue cerrado antes de iniciar la limpieza.",
      workerPid: process.pid,
    };
    await writeReceipt(store, receipt);
    await fs.rm(path.join(store.dir, ARMED_PLAN_FILE), { force: true });
    return receipt;
  }

  // Check TTL freshness immediately
  if (Date.now() > armed.expiresAt) {
    const receipt: MaintenanceReceipt = {
      version: 1,
      id: armed.id,
      planFingerprint: armed.plan.fingerprint,
      completedAt: Date.now(),
      status: "expired",
      deletedFamilies: [],
      deletedSessions: [],
      error: "El plan expiró antes de iniciar la espera del proceso.",
      workerPid: process.pid,
    };
    await writeReceipt(store, receipt);
    await fs.rm(path.join(store.dir, ARMED_PLAN_FILE), { force: true });
    return receipt;
  }

  // 1. Wait for owner process to exit (bounded wait)
  const maxWaitMs = options.maxWaitMs ?? Math.max(1000, armed.expiresAt - Date.now());
  const deadline = Date.now() + maxWaitMs;

  while (isAlive(ownerPid)) {
    if (armed.monitorPid && !isMonitorAlive(armed.monitorPid)) {
      const receipt: MaintenanceReceipt = {
        version: 1,
        id: armed.id,
        planFingerprint: armed.plan.fingerprint,
        completedAt: Date.now(),
        status: "cancelled",
        deletedFamilies: [],
        deletedSessions: [],
        error: "El monitor de mantenimiento fue cerrado antes de iniciar la limpieza.",
        workerPid: process.pid,
      };
      await writeReceipt(store, receipt);
      await fs.rm(path.join(store.dir, ARMED_PLAN_FILE), { force: true });
      return receipt;
    }

    if (Date.now() > deadline || Date.now() > armed.expiresAt) {
      const receipt: MaintenanceReceipt = {
        version: 1,
        id: armed.id,
        planFingerprint: armed.plan.fingerprint,
        completedAt: Date.now(),
        status: "expired",
        deletedFamilies: [],
        deletedSessions: [],
        error: "El plan expiró antes de que finalizara el proceso OpenCode propietario.",
        workerPid: process.pid,
      };
      await writeReceipt(store, receipt);
      await fs.rm(path.join(store.dir, ARMED_PLAN_FILE), { force: true });
      return receipt;
    }

    const currentArmed = await getArmedPlan(store);
    if (!currentArmed || currentArmed.status === "cancelled") {
      return {
        version: 1,
        id: armed.id,
        planFingerprint: armed.plan.fingerprint,
        completedAt: Date.now(),
        status: "cancelled",
        deletedFamilies: [],
        deletedSessions: [],
        workerPid: process.pid,
      };
    }

    await sleep(pollInterval);
  }

  // Final monitor check before claiming
  if (armed.monitorPid && !isMonitorAlive(armed.monitorPid)) {
    const receipt: MaintenanceReceipt = {
      version: 1,
      id: armed.id,
      planFingerprint: armed.plan.fingerprint,
      completedAt: Date.now(),
      status: "cancelled",
      deletedFamilies: [],
      deletedSessions: [],
      error: "El monitor de mantenimiento fue cerrado antes de iniciar la limpieza.",
      workerPid: process.pid,
    };
    await writeReceipt(store, receipt);
    await fs.rm(path.join(store.dir, ARMED_PLAN_FILE), { force: true });
    return receipt;
  }

  // 2. Owner is dead. Now verify ALL OpenCode instances are closed.
  // Exactly 3 polls separated by wait (fail-closed)
  for (let poll = 1; poll <= 3; poll++) {
    try {
      await checkOpenCodeProcessRunning({ checker: options.processChecker });
    } catch (err: unknown) {
      const receipt: MaintenanceReceipt = {
        version: 1,
        id: armed.id,
        planFingerprint: armed.plan.fingerprint,
        completedAt: Date.now(),
        status: "failed",
        deletedFamilies: [],
        deletedSessions: [],
        error: `Verificación de instancias de OpenCode falló (intento ${poll}/3): ${err instanceof Error ? err.message : String(err)}`,
        workerPid: process.pid,
      };
      await writeReceipt(store, receipt);
      await fs.rm(path.join(store.dir, ARMED_PLAN_FILE), { force: true });
      return receipt;
    }
    if (poll < 3) {
      await sleep(pollInterval);
    }
  }

  // 3. Single worker atomic claim
  const armedPath = path.join(store.dir, ARMED_PLAN_FILE);
  const claimedPath = path.join(store.dir, CLAIMED_PLAN_FILE);
  try {
    await fs.rename(armedPath, claimedPath);
  } catch {
    return {
      version: 1,
      id: armed.id,
      planFingerprint: armed.plan.fingerprint,
      completedAt: Date.now(),
      status: "failed",
      deletedFamilies: [],
      deletedSessions: [],
      error: "No se pudo reclamar el plan de forma atómica (ya reclamado o cancelado).",
      workerPid: process.pid,
    };
  }

  // 4. Apply plan with transactional revalidation
  try {
    const applyResult = await applyOfflinePlan({
      plan: armed.plan,
      dbPath: options.dbPath ?? armed.plan.canonicalDbPath,
      store,
      confirmed: true,
      processChecker: options.processChecker,
      skipVacuum: options.skipVacuum,
      _trustedTestExecution: true,
      _claimedArmId: armed.id,
    });

    const receipt: MaintenanceReceipt = {
      version: 1,
      id: armed.id,
      planFingerprint: armed.plan.fingerprint,
      completedAt: Date.now(),
      status: applyResult.status,
      deletedFamilies: applyResult.deletedFamilies,
      deletedSessions: applyResult.deletedSessions,
      backupPath: applyResult.backupPath,
      initialSizeBytes: applyResult.initialSizeBytes,
      finalSizeBytes: applyResult.finalSizeBytes,
      spaceFreedBytes: applyResult.spaceFreedBytes,
      vacuumError: applyResult.vacuumError,
      revalidated: true,
      workerPid: process.pid,
    };
    await writeReceipt(store, receipt);
    await fs.rm(claimedPath, { force: true });
    return receipt;
  } catch (err: unknown) {
    const receipt: MaintenanceReceipt = {
      version: 1,
      id: armed.id,
      planFingerprint: armed.plan.fingerprint,
      completedAt: Date.now(),
      status: "failed",
      deletedFamilies: [],
      deletedSessions: [],
      error: err instanceof Error ? err.message : String(err),
      workerPid: process.pid,
    };
    await writeReceipt(store, receipt);
    await fs.rm(claimedPath, { force: true });
    return receipt;
  }
}
