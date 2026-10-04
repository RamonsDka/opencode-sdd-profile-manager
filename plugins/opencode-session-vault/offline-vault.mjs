#!/usr/bin/env node

// scripts/offline-vault.ts
import * as readline from "node:readline/promises";
import * as fs4 from "node:fs/promises";
import * as fsSync2 from "node:fs";
import path4 from "node:path";

// src/store.ts
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

// src/model.ts
var PROFILES = {
  ten: { label: "\xDAltimas 10" },
  basic: { label: "B\xE1sico \xB7 15%", percent: 15 },
  moderate: { label: "Moderado \xB7 25%", percent: 25 },
  conservative: { label: "Conservador \xB7 40%", percent: 40 },
  mod: { label: "Mod \xB7 personalizado" }
};
var defaultState = () => ({
  schema: 2,
  revision: 0,
  config: {
    profile: "ten",
    percent: 25,
    scope: "global",
    automatic: false,
    graceHours: 24,
    includeArchived: false,
    intervalMinutes: 30,
    maxDeletePerRun: 10
  },
  pins: [],
  quotas: {},
  lastRun: 0
});

// src/policy.ts
function validateState(value) {
  if (!value || typeof value !== "object") throw new Error("Configuraci\xF3n inv\xE1lida. Se detuvo la limpieza.");
  const s = value;
  const c = s.config;
  if (s.schema !== 1 && s.schema !== 2 || !Number.isSafeInteger(s.revision) || s.revision < 0 || !c || !Object.hasOwn(PROFILES, c.profile) || !["project", "global"].includes(c.scope) || typeof c.automatic !== "boolean" || typeof c.includeArchived !== "boolean" || !Number.isInteger(c.percent) || c.percent < 1 || c.percent > 100 || !Number.isFinite(c.graceHours) || c.graceHours < 1 || c.graceHours > 8760 || !Number.isInteger(c.intervalMinutes) || c.intervalMinutes < 5 || c.intervalMinutes > 10080 || !Number.isInteger(c.maxDeletePerRun) || c.maxDeletePerRun < 1 || c.maxDeletePerRun > 100 || !Array.isArray(s.pins) || s.pins.some((id) => typeof id !== "string" || !/^ses_[a-zA-Z0-9]+$/.test(id)) || !s.quotas || typeof s.quotas !== "object" || Array.isArray(s.quotas) || !Number.isFinite(s.lastRun)) {
    throw new Error("Configuraci\xF3n inv\xE1lida. Conserva el archivo y corr\xEDgelo antes de limpiar.");
  }
  for (const q of Object.values(s.quotas)) {
    if (!q || typeof q.signature !== "string" || !Number.isInteger(q.keep) || q.keep < 1 || !Number.isInteger(q.baseline) || q.baseline < 0 || !Number.isFinite(q.at)) throw new Error("Cupo inv\xE1lido.");
  }
  return s;
}
function validateSessions(sessions) {
  const ids = /* @__PURE__ */ new Set();
  for (const s of sessions) {
    if (!s || !/^ses_[a-zA-Z0-9]+$/.test(s.id) || ids.has(s.id) || typeof s.title !== "string" || typeof s.projectID !== "string" || typeof s.directory !== "string" || !Number.isSafeInteger(s.time?.updated) || s.time.updated <= 0 || s.parentID !== void 0 && typeof s.parentID !== "string") throw new Error("Inventario inv\xE1lido o duplicado; no se borrar\xE1 nada.");
    ids.add(s.id);
  }
}
var quotaSignature = (c) => `${c.profile}:${c.profile === "mod" ? c.percent : PROFILES[c.profile].percent ?? 10}`;
function resolveQuota(c, total, previous, now = Date.now()) {
  const signature = quotaSignature(c);
  if (previous?.signature === signature) return previous;
  const percent = c.profile === "mod" ? c.percent : PROFILES[c.profile].percent;
  return { signature, baseline: total, keep: c.profile === "ten" ? 10 : Math.max(1, Math.ceil(total * percent / 100)), at: now };
}
function familiesOf(sessions) {
  validateSessions(sessions);
  const byID = new Map(sessions.map((s) => [s.id, s]));
  const groups = /* @__PURE__ */ new Map();
  for (const session of sessions) {
    const visited = /* @__PURE__ */ new Set();
    let root = session;
    while (root.parentID) {
      if (visited.has(root.id)) throw new Error("Jerarqu\xEDa circular; se detuvo la limpieza.");
      visited.add(root.id);
      const parent = byID.get(root.parentID);
      if (!parent) throw new Error("Inventario incompleto: falta una sesi\xF3n padre. No se borrar\xE1 nada.");
      root = parent;
    }
    let family = groups.get(root.id);
    if (!family) {
      family = { root, members: [], updated: 0, reasons: [] };
      groups.set(root.id, family);
    }
    family.members.push(session);
    family.updated = Math.max(family.updated, session.time.updated);
  }
  return [...groups.values()].sort((a, b) => b.updated - a.updated || b.root.id.localeCompare(a.root.id));
}
function isFamilyActiveProject(family, projectID) {
  if (!projectID || typeof projectID !== "string" || !projectID.trim()) return false;
  if (!family?.root || !Array.isArray(family.members) || family.members.length === 0) return false;
  if (family.root.projectID !== projectID) return false;
  return family.members.every((m) => Boolean(m && typeof m.projectID === "string" && m.projectID.trim() !== "" && m.projectID === projectID));
}

// src/store.ts
function stateDirectory() {
  return process.env.OPENCODE_SESSION_VAULT_HOME || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "opencode-session-vault");
}
async function atomicWrite(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 448 });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, "wx", 384);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temp, file);
  } catch (e) {
    await fs.rm(temp, { force: true });
    throw e;
  }
}
var Store = class {
  dir;
  constructor(dir = stateDirectory()) {
    this.dir = dir;
  }
  async read() {
    try {
      return validateState(JSON.parse(await fs.readFile(path.join(this.dir, "state.json"), "utf8")));
    } catch (e) {
      if (e.code === "ENOENT") return defaultState();
      throw e;
    }
  }
  async save(state) {
    validateState(state);
    await atomicWrite(path.join(this.dir, "state.json"), JSON.stringify(state, null, 2));
  }
  async exclusive(fn) {
    await fs.mkdir(this.dir, { recursive: true, mode: 448 });
    const lock = path.join(this.dir, "operation.lock");
    let handle;
    try {
      handle = await fs.open(lock, "wx", 384);
    } catch (e) {
      if (e.code === "EEXIST") throw new Error("Otra operaci\xF3n est\xE1 en curso. Si OpenCode se cerr\xF3 de golpe, usa el reparador de bloqueo incluido con todas las instancias cerradas.");
      throw e;
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      await handle.sync();
      return await fn();
    } finally {
      await handle.close();
      await fs.unlink(lock);
    }
  }
  async update(fn) {
    return this.exclusive(async () => {
      const state = await this.read();
      fn(state);
      state.revision++;
      await this.save(state);
      return state;
    });
  }
  async migrate() {
    const file = path.join(this.dir, "state.json");
    let raw;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") {
        return this.exclusive(async () => {
          try {
            const recheck = await fs.readFile(file, "utf8");
            const parsed2 = JSON.parse(recheck);
            return { migrated: false, state: validateState(parsed2) };
          } catch (err) {
            if (err.code === "ENOENT") {
              return { migrated: false, state: defaultState() };
            }
            throw err;
          }
        });
      }
      throw e;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Configuraci\xF3n corrupta. Se detuvo la migraci\xF3n para no sobrescribir el archivo.");
    }
    if (parsed && typeof parsed === "object" && parsed.schema === 2) {
      const validated = validateState(parsed);
      return { migrated: false, state: validated };
    }
    if (!parsed || typeof parsed !== "object" || parsed.schema !== 1) {
      throw new Error("Configuraci\xF3n corrupta. Se detuvo la migraci\xF3n para no sobrescribir el archivo.");
    }
    return this.exclusive(async () => {
      const rawUnderLock = await fs.readFile(file, "utf8");
      let parsedUnderLock;
      try {
        parsedUnderLock = JSON.parse(rawUnderLock);
      } catch {
        throw new Error("Configuraci\xF3n corrupta. Se detuvo la migraci\xF3n para no sobrescribir el archivo.");
      }
      if (parsedUnderLock && typeof parsedUnderLock === "object" && parsedUnderLock.schema === 2) {
        return { migrated: false, state: validateState(parsedUnderLock) };
      }
      validateState(parsedUnderLock);
      const migratedState = {
        schema: 2,
        revision: (Number.isSafeInteger(parsedUnderLock.revision) ? parsedUnderLock.revision : 0) + 1,
        config: {
          ...parsedUnderLock.config,
          scope: "global",
          automatic: false
        },
        pins: Array.isArray(parsedUnderLock.pins) ? [...parsedUnderLock.pins] : [],
        quotas: parsedUnderLock.quotas && typeof parsedUnderLock.quotas === "object" ? { ...parsedUnderLock.quotas } : {},
        lastRun: Number.isFinite(parsedUnderLock.lastRun) ? parsedUnderLock.lastRun : 0
      };
      delete migratedState.quotas["global"];
      validateState(migratedState);
      await atomicWrite(file, JSON.stringify(migratedState, null, 2));
      return { migrated: true, state: migratedState };
    });
  }
  async audit(record) {
    await atomicWrite(path.join(this.dir, "history", `${Date.now()}-${randomUUID()}.json`), JSON.stringify(record, null, 2));
  }
};

// src/offline.ts
import { createHash } from "node:crypto";
import * as fs3 from "node:fs/promises";
import * as fsSync from "node:fs";
import path3 from "node:path";
import os2 from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

// src/coordination.ts
import * as fs2 from "node:fs/promises";
import path2 from "node:path";
var ARMED_PLAN_FILE = "armed-plan.json";
var CLAIMED_PLAN_FILE = "claimed-plan.json";
var RECEIPT_FILE = "maintenance-receipt.json";
async function cancelArmedPlan(store) {
  const armedFile = path2.join(store.dir, ARMED_PLAN_FILE);
  try {
    const raw = await fs2.readFile(armedFile, "utf8");
    const armed = JSON.parse(raw);
    if (armed.status === "claimed") {
      return false;
    }
    await fs2.unlink(armedFile);
    const receipt = {
      version: 1,
      id: armed.id,
      planFingerprint: armed.plan.fingerprint,
      completedAt: Date.now(),
      status: "cancelled",
      deletedFamilies: [],
      deletedSessions: []
    };
    await writeReceipt(store, receipt);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
async function getArmedPlan(store) {
  const armedFile = path2.join(store.dir, ARMED_PLAN_FILE);
  try {
    const raw = await fs2.readFile(armedFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeReceipt(store, receipt) {
  const receiptFile = path2.join(store.dir, RECEIPT_FILE);
  await atomicWrite(receiptFile, JSON.stringify(receipt, null, 2));
}
async function getReceipt(store) {
  const receiptFile = path2.join(store.dir, RECEIPT_FILE);
  try {
    const raw = await fs2.readFile(receiptFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function clearReceipt(store) {
  const receiptFile = path2.join(store.dir, RECEIPT_FILE);
  await fs2.rm(receiptFile, { force: true });
}

// src/offline.ts
var execFileAsync = promisify(execFile);
function defaultDatabasePath() {
  if (process.env.OPENCODE_DB_PATH) return path3.resolve(process.env.OPENCODE_DB_PATH);
  if (process.env.XDG_DATA_HOME) {
    const xdgPath = path3.join(process.env.XDG_DATA_HOME, "opencode", "opencode.db");
    if (fsSync.existsSync(xdgPath)) return path3.resolve(xdgPath);
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const p1 = path3.join(localAppData, "opencode", "opencode.db");
      if (fsSync.existsSync(p1)) return path3.resolve(p1);
    }
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      const p2 = path3.join(userProfile, ".local", "share", "opencode", "opencode.db");
      if (fsSync.existsSync(p2)) return path3.resolve(p2);
    }
  }
  return path3.resolve(path3.join(os2.homedir(), ".local", "share", "opencode", "opencode.db"));
}
async function checkOpenCodeProcessRunning(options) {
  if (options?.checker) {
    const isRunning = await options.checker();
    if (isRunning) {
      throw new Error(
        "OpenCode se encuentra en ejecuci\xF3n (proceso activo detectado). Cierra todas las instancias de OpenCode para realizar el mantenimiento fuera de l\xEDnea."
      );
    }
    return;
  }
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq opencode.exe", "/NH"], {
        windowsHide: true
      });
      if (stdout.toLowerCase().includes("opencode.exe")) {
        throw new Error(
          "OpenCode se encuentra en ejecuci\xF3n (opencode.exe detectado). Cierra todas las instancias de OpenCode para realizar el mantenimiento fuera de l\xEDnea."
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("OpenCode se encuentra en ejecuci\xF3n")) {
        throw err;
      }
      throw new Error(`No se pudo comprobar si OpenCode est\xE1 abierto: ${String(err)}`);
    }
  } else {
    try {
      const { stdout } = await execFileAsync("pgrep", ["-x", "opencode"]);
      if (stdout.trim().length > 0) {
        throw new Error(
          "OpenCode se encuentra en ejecuci\xF3n (proceso activo detectado). Cierra todas las instancias de OpenCode para realizar el mantenimiento fuera de l\xEDnea."
        );
      }
    } catch (err) {
      const execErr = err;
      if (execErr.code === 1) {
        return;
      }
      if (err instanceof Error && err.message.includes("OpenCode se encuentra en ejecuci\xF3n")) {
        throw err;
      }
      throw new Error(`No se pudo comprobar si OpenCode est\xE1 abierto: ${String(err)}`);
    }
  }
}
function validateDestructiveSchema(db) {
  const userTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  const KNOWN_DEPENDENTS = /* @__PURE__ */ new Set(["message", "part", "todo", "session_share"]);
  for (const t of userTables) {
    const tableName = t.name;
    const lowerName = tableName.toLowerCase();
    if (lowerName === "session") continue;
    const tableCols = db.prepare(`PRAGMA table_info('${tableName.replace(/'/g, "''")}')`).all().map((c) => c.name.toLowerCase());
    const fks = db.prepare(`PRAGMA foreign_key_list('${tableName.replace(/'/g, "''")}')`).all();
    const isKnown = KNOWN_DEPENDENTS.has(lowerName) || lowerName.startsWith("session_");
    if (isKnown) {
      if (lowerName === "message") {
        const hasSessionFk = fks.some(
          (fk) => fk.table.toLowerCase() === "session" && (fk.from.toLowerCase() === "session_id" || fk.from.toLowerCase() === "sessionid") && fk.on_delete.toUpperCase() === "CASCADE"
        );
        if (!hasSessionFk) {
          throw new Error(
            `La tabla dependiente 'message' no tiene clave for\xE1nea ON DELETE CASCADE hacia session(id).`
          );
        }
      } else if (lowerName === "part") {
        const hasCascadeFk = fks.some(
          (fk) => (fk.table.toLowerCase() === "message" && (fk.from.toLowerCase() === "message_id" || fk.from.toLowerCase() === "messageid") || fk.table.toLowerCase() === "session" && (fk.from.toLowerCase() === "session_id" || fk.from.toLowerCase() === "sessionid")) && fk.on_delete.toUpperCase() === "CASCADE"
        );
        if (!hasCascadeFk) {
          throw new Error(
            `La tabla dependiente 'part' no tiene clave for\xE1nea ON DELETE CASCADE hacia message/session.`
          );
        }
      } else if (lowerName === "todo" || lowerName.startsWith("session_")) {
        if (tableCols.includes("session_id") || tableCols.includes("sessionid")) {
          const hasSessionFk = fks.some(
            (fk) => fk.table.toLowerCase() === "session" && (fk.from.toLowerCase() === "session_id" || fk.from.toLowerCase() === "sessionid") && fk.on_delete.toUpperCase() === "CASCADE"
          );
          if (!hasSessionFk) {
            throw new Error(
              `La tabla dependiente '${tableName}' no tiene clave for\xE1nea ON DELETE CASCADE hacia session(id).`
            );
          }
        }
      }
    } else {
      const relatedCol = tableCols.find(
        (c) => ["session_id", "sessionid", "message_id", "messageid"].includes(c)
      );
      if (relatedCol) {
        const hasValidCascade = fks.some((fk) => {
          const target = fk.table.toLowerCase();
          const from = fk.from.toLowerCase();
          const isCascade = fk.on_delete.toUpperCase() === "CASCADE";
          if (target === "session" && (from === "session_id" || from === "sessionid") && isCascade) return true;
          if (target === "message" && (from === "message_id" || from === "messageid") && isCascade) return true;
          return false;
        });
        if (!hasValidCascade) {
          throw new Error(
            `Tabla desconocida '${tableName}' contiene columna relacionada ('${relatedCol}') sin clave for\xE1nea ON DELETE CASCADE hacia session/message. Riesgo de orfandad; esquema incompatible.`
          );
        }
      }
    }
  }
}
function serializeSnapshotValue(val) {
  if (val === null || val === void 0) return "N";
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
  const json = JSON.stringify(
    val,
    (_, v) => typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v
  );
  return `J:${Buffer.byteLength(json ?? "", "utf8")}:${json ?? ""}`;
}
function computeCandidateSnapshot(db, sessionIds) {
  const dataVersionRow = db.prepare("PRAGMA data_version").get();
  const dataVersion = dataVersionRow?.data_version ?? 0;
  if (sessionIds.length === 0) {
    return { snapshotHash: "", dataVersion };
  }
  const hasher = createHash("sha256");
  const placeholders = sessionIds.map(() => "?").join(", ");
  const sessionTableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'").get();
  if (!sessionTableCheck) {
    throw new Error("La base de datos no contiene la tabla requerida 'session'.");
  }
  const sessionCols = db.prepare("PRAGMA table_info('session')").all().map((c) => c.name);
  if (!sessionCols.includes("id")) {
    throw new Error("La tabla 'session' no contiene la columna clave 'id'.");
  }
  const sortedSessionCols = [...sessionCols].sort();
  hasher.update(`table:session:${sortedSessionCols.join(",")}
`);
  const sessionStmt = db.prepare(
    `SELECT ${sortedSessionCols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ")} FROM session WHERE id IN (${placeholders}) ORDER BY id ASC`
  );
  sessionStmt.setReadBigInts(true);
  for (const row of sessionStmt.iterate(...sessionIds)) {
    const line = sortedSessionCols.map((c) => serializeSnapshotValue(row[c])).join("");
    hasher.update(`r:${line}
`);
  }
  const messageTableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message'").get();
  let hasMessageTable = false;
  let messageSessionCol;
  if (messageTableCheck) {
    hasMessageTable = true;
    const msgCols = db.prepare("PRAGMA table_info('message')").all().map((c) => c.name);
    messageSessionCol = msgCols.find((c) => c.toLowerCase() === "session_id" || c.toLowerCase() === "sessionid");
    if (!messageSessionCol || !msgCols.includes("id")) {
      throw new Error("La tabla dependiente 'message' no contiene columnas requeridas 'id' y 'session_id'.");
    }
    const sortedMsgCols = [...msgCols].sort();
    hasher.update(`table:message:${sortedMsgCols.join(",")}
`);
    const msgStmt = db.prepare(
      `SELECT ${sortedMsgCols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ")} FROM message WHERE "${messageSessionCol}" IN (${placeholders}) ORDER BY id ASC`
    );
    msgStmt.setReadBigInts(true);
    for (const row of msgStmt.iterate(...sessionIds)) {
      const line = sortedMsgCols.map((c) => serializeSnapshotValue(row[c])).join("");
      hasher.update(`r:${line}
`);
    }
  }
  const partTableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'part'").get();
  if (partTableCheck) {
    const partCols = db.prepare("PRAGMA table_info('part')").all().map((c) => c.name);
    const partSessionCol = partCols.find((c) => c.toLowerCase() === "session_id" || c.toLowerCase() === "sessionid");
    const partMessageCol = partCols.find((c) => c.toLowerCase() === "message_id" || c.toLowerCase() === "messageid");
    if (!partSessionCol && !partMessageCol) {
      throw new Error(
        "La tabla dependiente 'part' existe pero no posee columna 'session_id' ni 'message_id' para asociar a sesiones candidatas."
      );
    }
    const sortedPartCols = [...partCols].sort();
    hasher.update(`table:part:${sortedPartCols.join(",")}
`);
    const orderCol = partCols.includes("id") ? 'ORDER BY "id" ASC' : "ORDER BY rowid ASC";
    let partStmt;
    if (partSessionCol && partMessageCol && hasMessageTable && messageSessionCol) {
      partStmt = db.prepare(
        `SELECT ${sortedPartCols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ")} FROM part WHERE "${partSessionCol}" IN (${placeholders}) OR "${partMessageCol}" IN (SELECT id FROM message WHERE "${messageSessionCol}" IN (${placeholders})) ${orderCol}`
      );
    } else if (partSessionCol) {
      partStmt = db.prepare(
        `SELECT ${sortedPartCols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ")} FROM part WHERE "${partSessionCol}" IN (${placeholders}) ${orderCol}`
      );
    } else if (partMessageCol && hasMessageTable && messageSessionCol) {
      partStmt = db.prepare(
        `SELECT ${sortedPartCols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ")} FROM part WHERE "${partMessageCol}" IN (SELECT id FROM message WHERE "${messageSessionCol}" IN (${placeholders})) ${orderCol}`
      );
    } else {
      throw new Error(
        "La tabla dependiente 'part' se asocia v\xEDa 'message_id' pero la tabla 'message' no est\xE1 disponible en la base de datos."
      );
    }
    partStmt.setReadBigInts(true);
    for (const row of partStmt.iterate(...sessionIds)) {
      const line = sortedPartCols.map((c) => serializeSnapshotValue(row[c])).join("");
      hasher.update(`r:${line}
`);
    }
  }
  for (const depTableName of ["todo", "session_share"]) {
    const depTableCheck = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${depTableName}'`).get();
    if (depTableCheck) {
      const depCols = db.prepare(`PRAGMA table_info('${depTableName}')`).all().map((c) => c.name);
      const depSessionCol = depCols.find((c) => c.toLowerCase() === "session_id" || c.toLowerCase() === "sessionid");
      if (depSessionCol) {
        const sortedDepCols = [...depCols].sort();
        hasher.update(`table:${depTableName}:${sortedDepCols.join(",")}
`);
        const orderCol = depCols.includes("id") ? 'ORDER BY "id" ASC' : "ORDER BY rowid ASC";
        const depStmt = db.prepare(
          `SELECT ${sortedDepCols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ")} FROM ${depTableName} WHERE "${depSessionCol}" IN (${placeholders}) ${orderCol}`
        );
        depStmt.setReadBigInts(true);
        for (const row of depStmt.iterate(...sessionIds)) {
          const line = sortedDepCols.map((c) => serializeSnapshotValue(row[c])).join("");
          hasher.update(`r:${line}
`);
        }
      }
    }
  }
  const hash = hasher.digest("hex");
  return { snapshotHash: hash, dataVersion };
}
function computePlanFingerprint(canonicalPath, stateRevision, scope, projectID, profile, selectedFamilies, snapshotHash) {
  return createHash("sha256").update(
    JSON.stringify([
      canonicalPath,
      stateRevision,
      scope,
      projectID ?? "",
      profile,
      selectedFamilies.map((s) => [s.rootId, s.memberIds.slice().sort(), s.updated]),
      snapshotHash
    ])
  ).digest("hex");
}
function validateCanonicalDatabase(dbPath, options) {
  const resolved = path3.resolve(String(dbPath).trim());
  const canonicalPath = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  if (!fsSync.existsSync(canonicalPath)) {
    throw new Error(`El archivo de base de datos no existe: ${canonicalPath}`);
  }
  const stat = fsSync.statSync(canonicalPath);
  if (!stat.isFile()) {
    throw new Error(`La ruta indicada no es un archivo regular: ${canonicalPath}`);
  }
  const fd = fsSync.openSync(canonicalPath, "r");
  const buffer = Buffer.alloc(16);
  try {
    fsSync.readSync(fd, buffer, 0, 16, 0);
  } finally {
    fsSync.closeSync(fd);
  }
  if (buffer.toString("utf8", 0, 15) !== "SQLite format 3" || buffer[15] !== 0) {
    throw new Error(`El archivo no es una base de datos SQLite v\xE1lida: ${canonicalPath}`);
  }
  if (options?.checkSchema !== false) {
    const db = options?.existingDb ?? new DatabaseSync(canonicalPath, { readOnly: true });
    try {
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'").get();
      if (!tableCheck) {
        throw new Error("No existe la tabla session en la base de datos. Esquema incompatible.");
      }
      const tableInfo = db.prepare("PRAGMA table_info(session)").all();
      const columns = tableInfo.map((c) => c.name.toLowerCase());
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
async function inspectDatabase(dbPath, options) {
  const { canonicalPath, stat } = validateCanonicalDatabase(dbPath, { checkSchema: false });
  const db = new DatabaseSync(canonicalPath, { readOnly: true });
  try {
    let integrity = "pending";
    if (options?.checkIntegrity) {
      const quickCheck = db.prepare("PRAGMA quick_check").get();
      integrity = quickCheck?.quick_check ?? "unknown";
      if (integrity !== "ok") {
        throw new Error(`La integridad de la base de datos no es correcta: ${integrity}`);
      }
    }
    const sessionTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'").get();
    if (!sessionTable) {
      throw new Error("No existe la tabla session en la base de datos.");
    }
    const pageSizeRow = db.prepare("PRAGMA page_size").get();
    const freelistRow = db.prepare("PRAGMA freelist_count").get();
    const countRow = db.prepare("SELECT count(*) as cnt FROM session").get();
    const tablesRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    const pageSize = pageSizeRow?.page_size ?? 4096;
    const freelistCount = freelistRow?.freelist_count ?? 0;
    const sessionCount = countRow?.cnt ?? 0;
    const tables = tablesRows.map((t) => t.name);
    return {
      dbPath: canonicalPath,
      sizeBytes: stat.size,
      pageSize,
      freelistCount,
      freeBytes: freelistCount * pageSize,
      sessionCount,
      tables,
      integrity
    };
  } finally {
    db.close();
  }
}
async function generateOfflinePlan(options) {
  if (!options.allowRunningProcess) {
    await checkOpenCodeProcessRunning({ checker: options.processChecker });
  }
  const { canonicalPath, stat } = validateCanonicalDatabase(options.dbPath, { checkSchema: true });
  const state = await options.store.read();
  validateState(state);
  const now = options.now ?? Date.now();
  const db = new DatabaseSync(canonicalPath, { readOnly: true });
  let sessions = [];
  try {
    const tableInfo = db.prepare("PRAGMA table_info(session)").all();
    const cols = new Set(tableInfo.map((c) => c.name.toLowerCase()));
    const idCol = "id";
    const titleCol = cols.has("title") ? "title" : "'' as title";
    const projCol = cols.has("project_id") ? "project_id" : cols.has("projectid") ? "projectid" : "'' as project_id";
    const dirCol = "directory";
    const parentCol = cols.has("parent_id") ? "parent_id" : cols.has("parentid") ? "parentid" : "NULL as parent_id";
    const createdCol = cols.has("time_created") ? "time_created" : cols.has("created") ? "created" : "0 as time_created";
    const updatedCol = cols.has("time_updated") ? "time_updated" : cols.has("updated") ? "updated" : "0 as time_updated";
    const archivedCol = cols.has("time_archived") ? "time_archived" : cols.has("archived") ? "archived" : "NULL as time_archived";
    const rows = db.prepare(
      `SELECT ${idCol} as id, ${titleCol} as title, ${projCol} as project_id, ${dirCol} as directory,
                ${parentCol} as parent_id, ${createdCol} as time_created, ${updatedCol} as time_updated,
                ${archivedCol} as time_archived FROM session`
    ).all();
    sessions = rows.map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      projectID: String(r.project_id ?? ""),
      directory: String(r.directory ?? ""),
      parentID: r.parent_id ? String(r.parent_id) : void 0,
      time: {
        created: Number(r.time_created) || Number(r.time_updated) || now,
        updated: Number(r.time_updated) || Number(r.time_created) || now,
        archived: r.time_archived ? Number(r.time_archived) : void 0
      }
    }));
  } finally {
    db.close();
  }
  const families = familiesOf(sessions);
  const isGlobal = state.config.scope === "global";
  const activeProject = options.projectID?.trim() ?? "";
  const pins = new Set(state.pins);
  if (!isGlobal && !activeProject) {
    throw new Error(
      "El alcance configurado en Vault es 'project'. Se requiere especificar 'projectID' para generar el plan."
    );
  }
  const eligibleFamilies = isGlobal ? families : activeProject ? families.filter((f) => isFamilyActiveProject(f, activeProject)) : [];
  const unpinned = eligibleFamilies.filter((f) => !f.members.some((s) => pins.has(s.id)));
  const scopeKey = isGlobal ? "global" : `project:${activeProject}`;
  const quota = resolveQuota(state.config, unpinned.length, state.quotas[scopeKey], now);
  const keepIDs = new Set(unpinned.slice(0, quota.keep).map((f) => f.root.id));
  for (const f of families) {
    if (!isGlobal && (!activeProject || !isFamilyActiveProject(f, activeProject))) {
      f.reasons.push("Otro proyecto");
    }
    if (f.members.some((s) => pins.has(s.id))) f.reasons.push("Candado");
    if (!state.config.includeArchived && f.members.some((s) => s.time.archived)) f.reasons.push("Archivada");
    if (f.updated > now - state.config.graceHours * 36e5) f.reasons.push("Actividad reciente");
    if (keepIDs.has(f.root.id)) f.reasons.push("Dentro del cupo");
    f.reasons = [...new Set(f.reasons)];
  }
  const candidates = families.filter((f) => !f.reasons.length);
  const retained = families.filter((f) => f.reasons.length);
  const batchLimit = Math.min(
    candidates.length,
    state.config.maxDeletePerRun,
    options.batchLimit ?? 100
  );
  const selected = [...candidates].reverse().slice(0, batchLimit);
  const selectedSummaries = selected.map((f) => ({
    rootId: f.root.id,
    memberIds: f.members.map((m) => m.id),
    updated: f.updated,
    title: f.root.title,
    members: f.members.map((m) => ({
      id: m.id,
      parentId: m.parentID,
      timeUpdated: m.time.updated
    }))
  }));
  const targetMemberIds = selectedSummaries.flatMap((s) => s.memberIds);
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
    activeProject || void 0,
    state.config.profile,
    selectedSummaries,
    snapshotHash
  );
  return {
    version: 1,
    createdAt: now,
    expiresAt: now + 30 * 60 * 1e3,
    // 30 min expiration
    canonicalDbPath: canonicalPath,
    dbStat: { size: stat.size, mtimeMs: stat.mtimeMs },
    stateRevision: state.revision,
    statePins: [...state.pins],
    scope: state.config.scope,
    projectID: activeProject || void 0,
    profile: state.config.profile,
    totalSessions: sessions.length,
    totalFamilies: families.length,
    candidateFamiliesCount: candidates.length,
    retainedFamiliesCount: retained.length,
    selectedFamilies: selectedSummaries,
    quota,
    snapshotHash,
    dataVersion,
    fingerprint
  };
}
async function applyOfflinePlan(options) {
  if (!options.confirmed) {
    throw new Error("Operaci\xF3n destructiva no confirmada. Se requiere confirmaci\xF3n expl\xEDcita para borrar.");
  }
  await checkOpenCodeProcessRunning({ checker: options.processChecker });
  if (Date.now() > options.plan.expiresAt) {
    throw new Error("El plan ha expirado (m\xE1s de 30 minutos). Genera un plan nuevo antes de aplicar.");
  }
  if (options.plan.version !== 1 || !Array.isArray(options.plan.selectedFamilies)) {
    throw new Error("Estructura de plan no v\xE1lida.");
  }
  if (options.plan.selectedFamilies.length > 100) {
    throw new Error("El plan supera el l\xEDmite m\xE1ximo permitido de 100 familias por ejecuci\xF3n.");
  }
  const allTargetMemberIds = [];
  const seenMemberIds = /* @__PURE__ */ new Set();
  for (const fam of options.plan.selectedFamilies) {
    if (!fam.rootId || !Array.isArray(fam.memberIds) || !Array.isArray(fam.members)) {
      throw new Error("Familia en plan con formato inv\xE1lido.");
    }
    if (!fam.memberIds.includes(fam.rootId)) {
      throw new Error(`La familia con ra\xEDz '${fam.rootId}' no incluye su ra\xEDz en memberIds.`);
    }
    if (fam.memberIds.length !== fam.members.length) {
      throw new Error(`Discrepancia en miembros de la familia '${fam.rootId}'.`);
    }
    const memberSet = new Set(fam.members.map((m) => m.id));
    for (const mid of fam.memberIds) {
      if (!memberSet.has(mid)) {
        throw new Error(`Discrepancia de miembros en familia '${fam.rootId}': '${mid}' ausente en members.`);
      }
      if (seenMemberIds.has(mid)) {
        throw new Error(`ID de sesi\xF3n duplicado detectado en el plan: '${mid}'.`);
      }
      seenMemberIds.add(mid);
      allTargetMemberIds.push(mid);
    }
  }
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
      "La huella digital (fingerprint) del plan no coincide con su contenido. Plan manipulado o inv\xE1lido rechazado."
    );
  }
  const { canonicalPath, stat } = validateCanonicalDatabase(options.dbPath, { checkSchema: true });
  if (canonicalPath !== options.plan.canonicalDbPath) {
    throw new Error(
      `La base de datos actual (${canonicalPath}) no coincide con la base del plan (${options.plan.canonicalDbPath}).`
    );
  }
  const currentState = await options.store.read();
  validateState(currentState);
  if (currentState.revision !== options.plan.stateRevision) {
    throw new Error("La configuraci\xF3n de Vault ha cambiado (revisi\xF3n diferente). Plan rechazado.");
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
      throw new Error(`Se detect\xF3 un candado agregado a la sesi\xF3n '${id}'. Plan rechazado.`);
    }
  }
  try {
    const fsStats = fsSync.statfsSync(path3.dirname(canonicalPath));
    const freeBytes = fsStats.bavail * fsStats.bsize;
    const requiredBytes = stat.size * 2 + 16 * 1024 * 1024;
    if (freeBytes < requiredBytes) {
      throw new Error(
        `Espacio en disco insuficiente. Tama\xF1o BD: ${(stat.size / 1024 ** 2).toFixed(1)} MiB; libres: ${(freeBytes / 1024 ** 2).toFixed(1)} MiB (se requieren aprox. ${(requiredBytes / 1024 ** 2).toFixed(1)} MiB para respaldo y compactaci\xF3n).`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("Espacio en disco insuficiente")) throw err;
  }
  const preCheckDb = new DatabaseSync(canonicalPath, { readOnly: true });
  try {
    const preSnap = computeCandidateSnapshot(preCheckDb, allTargetMemberIds);
    if (preSnap.snapshotHash !== options.plan.snapshotHash) {
      throw new Error(
        "El contenido de las sesiones o mensajes cambi\xF3 antes del respaldo. Plan stale rechazado."
      );
    }
  } finally {
    preCheckDb.close();
  }
  if (options._simulateBackupFailure) {
    throw new Error("simulated backup_failure");
  }
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backupPath = `${canonicalPath}.before-cleanup-${stamp}.sqlite`;
  const backupDb = new DatabaseSync(canonicalPath, { readOnly: true });
  try {
    backupDb.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}';`);
  } catch (err) {
    throw new Error(`Fallo al crear el respaldo previo de SQLite: ${String(err)}`);
  } finally {
    backupDb.close();
  }
  if (!fsSync.existsSync(backupPath) || fsSync.statSync(backupPath).size === 0) {
    throw new Error("El archivo de respaldo no se cre\xF3 correctamente o est\xE1 vac\xEDo. Limpieza suspendida.");
  }
  const checkDb = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const backupIntegrity = checkDb.prepare("PRAGMA quick_check").get();
    if (backupIntegrity?.quick_check !== "ok") {
      throw new Error(`El respaldo no pas\xF3 la verificaci\xF3n de integridad: ${backupIntegrity?.quick_check}`);
    }
  } finally {
    checkDb.close();
  }
  if (options._simulateMutationAfterBackup) {
    const mutDb = new DatabaseSync(canonicalPath);
    try {
      mutDb.prepare("INSERT INTO message (id, session_id, content, time_created) VALUES (?, ?, ?, ?)").run(
        "msg_race_mutation",
        options.plan.selectedFamilies[0].rootId,
        "Race payload",
        Date.now()
      );
    } finally {
      mutDb.close();
    }
  }
  const writableDb = new DatabaseSync(canonicalPath);
  const deletedFamilies = [];
  const deletedSessions = [];
  let finalSize = stat.size;
  let vacuumError;
  try {
    try {
      writableDb.exec("PRAGMA foreign_keys = ON;");
      writableDb.exec("BEGIN EXCLUSIVE;");
      const lockedState = await options.store.read();
      if (lockedState.revision !== options.plan.stateRevision) {
        throw new Error(
          "La configuraci\xF3n de Vault cambi\xF3 durante o tras el respaldo. Plan stale rechazado."
        );
      }
      const lockedPins = new Set(lockedState.pins);
      for (const id of allTargetMemberIds) {
        if (lockedPins.has(id)) {
          throw new Error(`Se detect\xF3 un candado agregado a la sesi\xF3n '${id}' tras el respaldo. Plan rechazado.`);
        }
      }
      const lockedSnap = computeCandidateSnapshot(writableDb, allTargetMemberIds);
      if (lockedSnap.snapshotHash !== options.plan.snapshotHash) {
        throw new Error(
          "Mutaci\xF3n detectada en las sesiones o mensajes entre el respaldo y la adquisici\xF3n del bloqueo exclusivo. Plan stale rechazado."
        );
      }
      const placeholders = allTargetMemberIds.map(() => "?").join(", ");
      const currentRows = writableDb.prepare(
        `SELECT id, parent_id, time_updated FROM session WHERE id IN (${placeholders})`
      ).all(...allTargetMemberIds);
      if (currentRows.length !== allTargetMemberIds.length) {
        throw new Error("Las sesiones en la base de datos ya no existen o fueron eliminadas. Plan stale rechazado.");
      }
      const rowMap = new Map(currentRows.map((r) => [r.id, r]));
      for (const fam of options.plan.selectedFamilies) {
        for (const expectedMember of fam.members) {
          const live = rowMap.get(expectedMember.id);
          if (!live) {
            throw new Error(`La sesi\xF3n '${expectedMember.id}' ya no existe. Plan stale rechazado.`);
          }
          if (live.time_updated !== expectedMember.timeUpdated) {
            throw new Error(
              `Las sesiones fueron modificadas desde la creaci\xF3n del plan (sesi\xF3n ${expectedMember.id} alterada). Plan stale rechazado.`
            );
          }
          const liveParent = live.parent_id ?? void 0;
          if (liveParent !== expectedMember.parentId) {
            throw new Error(
              `La jerarqu\xEDa de sesiones cambi\xF3 (parent_id de ${expectedMember.id} alterado). Plan stale rechazado.`
            );
          }
        }
      }
      const childCheck = writableDb.prepare(
        `SELECT id FROM session WHERE parent_id IN (${placeholders}) AND id NOT IN (${placeholders})`
      ).all(...allTargetMemberIds, ...allTargetMemberIds);
      if (childCheck.length > 0) {
        throw new Error(
          `Nueva sesi\xF3n hija detectada (${childCheck.map((c) => c.id).join(", ")}) en familias del plan. Plan stale rechazado.`
        );
      }
      if (options._simulateErrorInTransaction) {
        throw new Error("simulated_transaction_error");
      }
      writableDb.prepare(`DELETE FROM session WHERE id IN (${placeholders})`).run(...allTargetMemberIds);
      const fkViolations = writableDb.prepare("PRAGMA foreign_key_check").all();
      if (fkViolations.length > 0) {
        throw new Error(`Violaci\xF3n de claves for\xE1neas al eliminar sesiones: ${JSON.stringify(fkViolations)}`);
      }
      const quickCheck = writableDb.prepare("PRAGMA quick_check").get();
      if (quickCheck?.quick_check !== "ok") {
        throw new Error(`Error de integridad tras borrado: ${quickCheck?.quick_check}`);
      }
      await checkOpenCodeProcessRunning({ checker: options.processChecker });
      writableDb.exec("COMMIT;");
      for (const f of options.plan.selectedFamilies) {
        deletedFamilies.push(f.rootId);
        for (const m of f.memberIds) deletedSessions.push(m);
      }
    } catch (err) {
      try {
        writableDb.exec("ROLLBACK;");
      } catch {
      }
      throw err;
    }
    await checkOpenCodeProcessRunning({ checker: options.processChecker });
    if (!options.skipVacuum) {
      try {
        if (options._simulateVacuumFailure) {
          throw new Error("simulated_vacuum_failure");
        }
        writableDb.exec("VACUUM;");
        writableDb.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        finalSize = fsSync.statSync(canonicalPath).size;
      } catch (err) {
        vacuumError = err instanceof Error ? err.message : String(err);
      }
    }
  } finally {
    try {
      writableDb.close();
    } catch {
    }
  }
  if (vacuumError) {
    return {
      status: "partial_success",
      deletedFamilies,
      deletedSessions,
      backupPath,
      initialSizeBytes: stat.size,
      vacuumError
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
    vacuumSkipped: Boolean(options.skipVacuum)
  };
}
async function runArmedMaintenance(options) {
  const { store } = options;
  const armed = await getArmedPlan(store);
  if (!armed) {
    throw new Error("No hay ning\xFAn plan de mantenimiento armado en curso.");
  }
  const sleep = options.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pollInterval = options.pollIntervalMs ?? 1e3;
  const ownerPid = options.ownerPid ?? armed.ownerPid;
  const isAlive = options.isOwnerAlive ?? ((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });
  if (Date.now() > armed.expiresAt) {
    const receipt = {
      version: 1,
      id: armed.id,
      planFingerprint: armed.plan.fingerprint,
      completedAt: Date.now(),
      status: "expired",
      deletedFamilies: [],
      deletedSessions: [],
      error: "El plan expir\xF3 antes de iniciar la espera del proceso."
    };
    await writeReceipt(store, receipt);
    await fs3.rm(path3.join(store.dir, ARMED_PLAN_FILE), { force: true });
    return receipt;
  }
  const maxWaitMs = options.maxWaitMs ?? Math.max(1e3, armed.expiresAt - Date.now());
  const deadline = Date.now() + maxWaitMs;
  while (isAlive(ownerPid)) {
    if (Date.now() > deadline || Date.now() > armed.expiresAt) {
      const receipt = {
        version: 1,
        id: armed.id,
        planFingerprint: armed.plan.fingerprint,
        completedAt: Date.now(),
        status: "expired",
        deletedFamilies: [],
        deletedSessions: [],
        error: "El plan expir\xF3 antes de que finalizara el proceso OpenCode propietario."
      };
      await writeReceipt(store, receipt);
      await fs3.rm(path3.join(store.dir, ARMED_PLAN_FILE), { force: true });
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
        deletedSessions: []
      };
    }
    await sleep(pollInterval);
  }
  for (let poll = 1; poll <= 3; poll++) {
    try {
      await checkOpenCodeProcessRunning({ checker: options.processChecker });
    } catch (err) {
      const receipt = {
        version: 1,
        id: armed.id,
        planFingerprint: armed.plan.fingerprint,
        completedAt: Date.now(),
        status: "failed",
        deletedFamilies: [],
        deletedSessions: [],
        error: `Verificaci\xF3n de instancias de OpenCode fall\xF3 (intento ${poll}/3): ${err instanceof Error ? err.message : String(err)}`
      };
      await writeReceipt(store, receipt);
      await fs3.rm(path3.join(store.dir, ARMED_PLAN_FILE), { force: true });
      return receipt;
    }
    if (poll < 3) {
      await sleep(pollInterval);
    }
  }
  const armedPath = path3.join(store.dir, ARMED_PLAN_FILE);
  const claimedPath = path3.join(store.dir, CLAIMED_PLAN_FILE);
  try {
    await fs3.rename(armedPath, claimedPath);
  } catch {
    return {
      version: 1,
      id: armed.id,
      planFingerprint: armed.plan.fingerprint,
      completedAt: Date.now(),
      status: "failed",
      deletedFamilies: [],
      deletedSessions: [],
      error: "No se pudo reclamar el plan de forma at\xF3mica (ya reclamado o cancelado)."
    };
  }
  try {
    const applyResult = await applyOfflinePlan({
      plan: armed.plan,
      dbPath: options.dbPath ?? armed.plan.canonicalDbPath,
      store,
      confirmed: true,
      processChecker: options.processChecker,
      skipVacuum: options.skipVacuum
    });
    const receipt = {
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
      revalidated: true
    };
    await writeReceipt(store, receipt);
    await fs3.rm(claimedPath, { force: true });
    return receipt;
  } catch (err) {
    const receipt = {
      version: 1,
      id: armed.id,
      planFingerprint: armed.plan.fingerprint,
      completedAt: Date.now(),
      status: "failed",
      deletedFamilies: [],
      deletedSessions: [],
      error: err instanceof Error ? err.message : String(err)
    };
    await writeReceipt(store, receipt);
    await fs3.rm(claimedPath, { force: true });
    return receipt;
  }
}

// scripts/offline-vault.ts
function printHelp() {
  console.log(`
Uso: node scripts/offline-vault.ts <comando> [opciones]

Comandos:
  inspect           Inspeccionar el archivo de base de datos (solo lectura, sin cambios).
  plan              Generar plan de limpieza basado en perfiles y candados (modo simulado / dry-run, no borra).
  apply             Aplicar el plan: respaldo SQLite previo, borrado transaccional y compactaci\xF3n.
  run-armed         Ejecutar mantenimiento armado tras la muerte del proceso propietario y cierre de OpenCode.
  cancel-armed      Cancelar un plan de mantenimiento armado en espera.
  receipt           Consultar o limpiar el recibo del \xFAltimo mantenimiento ejecutado.

Opciones generales:
  --db <ruta>       Ruta expl\xEDcita a opencode.db (por defecto busca la ruta can\xF3nica del sistema).
  --plan <ruta>     Ruta al archivo de plan JSON (por defecto: vault-plan.json).
  --out <ruta>      Ruta donde guardar el plan generado (por defecto: vault-plan.json).
  --project <id>    ID del proyecto objetivo (requerido si el alcance en Vault es 'project').
  --max <n>         L\xEDmite m\xE1ximo de familias a seleccionar en el lote (1\u2013100).
  --json            Emitir el resultado estructurado en formato JSON a stdout.
  --allow-running   Permitir plan/inspecci\xF3n de solo lectura mientras OpenCode est\xE9 abierto.
  --state-dir <dir> Directorio de estado de Session Vault (por defecto el can\xF3nico).
  --owner-pid <pid> PID del proceso OpenCode propietario a monitorear antes de ejecutar.
  --clear           Limpiar el recibo tras consultarlo (en comando 'receipt').
  --confirm         Omitir solicitud interactiva de confirmaci\xF3n y ejecutar.
  --skip-vacuum     Borrar sesiones y respaldar pero omitir la compactaci\xF3n VACUUM.
  --help, -h        Mostrar esta ayuda.
`);
}
function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--confirm") {
      flags.confirm = true;
    } else if (arg === "--skip-vacuum") {
      flags.skipVacuum = true;
    } else if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        flags[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { command: positional[0], flags };
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}
function formatDate(ms) {
  return new Date(ms).toISOString().replace("T", " ").substring(0, 19);
}
async function handleInspect(dbPath, asJson = false, checkIntegrity = false) {
  if (!asJson) {
    console.log(`
Comprobando estado de OpenCode...`);
    await checkOpenCodeProcessRunning();
    console.log(`OpenCode cerrado. Inspeccionando base de datos: ${dbPath}`);
  }
  const info = await inspectDatabase(dbPath, { checkIntegrity });
  if (asJson) {
    console.log(JSON.stringify(info));
    return;
  }
  console.log(`
--- RESUMEN DE INSPECCI\xD3N ---
Ruta:              ${info.dbPath}
Tama\xF1o en disco:   ${formatBytes(info.sizeBytes)}
Sesiones totales:  ${info.sessionCount}
P\xE1ginas libres:    ${info.freelistCount} (${formatBytes(info.freeBytes)})
Integridad SQLite: ${info.integrity === "pending" ? "Pendiente (usa --check-integrity para escanear p\xE1ginas)" : info.integrity}
Tablas detectadas: ${info.tables.join(", ")}
-----------------------------
Operaci\xF3n 100% de solo lectura. No se modific\xF3 ning\xFAn archivo.
Para evaluar qu\xE9 sesiones calificar\xEDan para limpieza seg\xFAn tus perfiles y candados,
ejecuta: node scripts/offline-vault.ts plan
`);
}
async function handlePlan(dbPath, planPath, batchLimit, projectID, asJson = false, allowRunning = false, stateDir) {
  if (!asJson && !allowRunning) {
    console.log(`
Comprobando estado de OpenCode...`);
    await checkOpenCodeProcessRunning();
  }
  const store = new Store(stateDir);
  const state = await store.read();
  if (state.config.scope === "project" && (!projectID || projectID.trim() === "")) {
    throw new Error(
      "El alcance configurado en Vault es 'project'. Debes especificar el proyecto objetivo con '--project <id>'."
    );
  }
  if (!asJson) {
    console.log(`Generando plan fuera de l\xEDnea para: ${dbPath}`);
    console.log(
      `Perfil activo: ${state.config.profile} | Alcance: ${state.config.scope}${state.config.scope === "project" ? ` (proyecto: ${projectID})` : ""} | Candados configurados: ${state.pins.length}`
    );
  }
  const plan = await generateOfflinePlan({
    dbPath,
    store,
    projectID,
    batchLimit,
    allowRunningProcess: allowRunning
  });
  if (asJson) {
    console.log(JSON.stringify(plan));
    return;
  }
  console.log(`
--- PLAN DE LIMPIEZA (SIMULACI\xD3N / DRY-RUN) ---
Sesiones totales:       ${plan.totalSessions}
Familias totales:       ${plan.totalFamilies}
Familias protegidas:    ${plan.retainedFamiliesCount} (candados, dentro del cupo, archivadas o recientes)
Familias candidatas:    ${plan.candidateFamiliesCount}
Familias en este lote:  ${plan.selectedFamilies.length} (m\xE1x. permitido por ejecuci\xF3n)
Cupo de retenci\xF3n:      ${plan.quota.keep} familias conservadas
Expiraci\xF3n del plan:    30 minutos
Huella digital (SHA):   ${plan.fingerprint.slice(0, 16)}...
-----------------------------------------------`);
  if (plan.selectedFamilies.length === 0) {
    console.log(`No hay familias candidatas para borrar. Todas tus sesiones est\xE1n protegidas por candados, cuota o actividad reciente.`);
    return;
  }
  console.log(`
Familias seleccionadas para eliminaci\xF3n (de m\xE1s antigua a m\xE1s reciente):`);
  for (let i = 0; i < plan.selectedFamilies.length; i++) {
    const f = plan.selectedFamilies[i];
    const childNote = f.memberIds.length > 1 ? ` (+${f.memberIds.length - 1} hijas)` : "";
    console.log(` [${i + 1}] Ra\xEDz: ${f.rootId} | Miembros: ${f.memberIds.length}${childNote} | \xDAltima act: ${formatDate(f.updated)} | "${f.title.slice(0, 40)}"`);
  }
  await fs4.writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
  console.log(`
Plan guardado en: ${planPath}`);
  console.log(`NOTA: El plan NO ha modificado la base de datos (modo seguro).`);
  console.log(`Para aplicar este plan de forma definitiva (con respaldo y verificaci\xF3n previa):`);
  console.log(`  node scripts/offline-vault.ts apply --plan "${planPath}"`);
}
async function handleApply(dbPath, planPath, autoConfirm = false, skipVacuum = false) {
  console.log(`
Comprobando estado de OpenCode...`);
  await checkOpenCodeProcessRunning();
  if (!fsSync2.existsSync(planPath)) {
    throw new Error(`No se encontr\xF3 el archivo de plan: ${planPath}. Ejecuta primero el comando 'plan'.`);
  }
  const rawPlan = await fs4.readFile(planPath, "utf8");
  const plan = JSON.parse(rawPlan);
  console.log(`
--- APLICACI\xD3N DE MANTENIMIENTO FUERA DE L\xCDNEA ---
Base de datos:       ${plan.canonicalDbPath}
Familias a borrar:   ${plan.selectedFamilies.length}
Sesiones totales:    ${plan.selectedFamilies.flatMap((f) => f.memberIds).length}
Compactaci\xF3n VACUUM: ${skipVacuum ? "OMITIDA" : "INCLUIDA"}
Huella del plan:     ${plan.fingerprint.slice(0, 16)}...
-------------------------------------------------`);
  if (plan.selectedFamilies.length === 0) {
    console.log(`El plan no contiene familias para borrar.`);
    return;
  }
  if (!autoConfirm) {
    console.log(`
ADVERTENCIA: Esta operaci\xF3n eliminar\xE1 las sesiones seleccionadas de la base de datos.`);
    console.log(`Se crear\xE1 autom\xE1ticamente una copia completa de seguridad (.sqlite) antes de borrar.`);
    console.log(`El respaldo preserva todos los bytes originales de SQLite y se conserva en disco.`);
    console.log(`Aseg\xFArate de contar con espacio libre suficiente (al menos 2x el tama\xF1o de la base) para respaldo y compactaci\xF3n.`);
    console.log(`OpenCode DEBE permanecer cerrado durante todo el proceso. No abras OpenCode mientras se ejecuta.
`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question("Escribe CONFIRMAR para proceder con el respaldo y la eliminaci\xF3n: ");
      if (answer.trim() !== "CONFIRMAR") {
        console.log("Operaci\xF3n cancelada por el usuario. No se realiz\xF3 ning\xFAn cambio.");
        return;
      }
    } finally {
      rl.close();
    }
  }
  console.log(`
Iniciando mantenimiento...`);
  const store = new Store();
  const result = await applyOfflinePlan({
    plan,
    dbPath,
    store,
    confirmed: true,
    skipVacuum
  });
  console.log(`
================ RESULTADO DEL MANTENIMIENTO ================
Estado:               ${result.status === "success" ? "\xC9XITO COMPLETO" : "\xC9XITO PARCIAL (BORRADO COMPLETADO, VACUUM CON AVISO)"}
Familias eliminadas:  ${result.deletedFamilies.length}
Sesiones eliminadas:  ${result.deletedSessions.length}
Copia de respaldo:    ${result.backupPath}
Tama\xF1o inicial BD:    ${formatBytes(result.initialSizeBytes)}
${result.finalSizeBytes ? `Tama\xF1o final BD:      ${formatBytes(result.finalSizeBytes)}` : ""}
${result.spaceFreedBytes !== void 0 ? `Espacio liberado:     ${formatBytes(result.spaceFreedBytes)}` : ""}
${result.vacuumError ? `Aviso de compactaci\xF3n: ${result.vacuumError}
(Las sesiones se eliminaron de forma segura y consistente. Puedes compactar m\xE1s tarde).` : ""}
============================================================
IMPORTANTE: La copia de respaldo contiene la base de datos previa \xEDntegra.
Cons\xE9rvala hasta verificar que OpenCode funciona con normalidad.
No se elimina de forma autom\xE1tica para evitar p\xE9rdida de datos accidental.
`);
}
async function handleRunArmed(stateDir, ownerPidStr, skipVacuum = false) {
  const store = new Store(stateDir);
  const ownerPid = ownerPidStr ? parseInt(ownerPidStr, 10) : void 0;
  const receipt = await runArmedMaintenance({
    store,
    ownerPid,
    skipVacuum
  });
  console.log(JSON.stringify(receipt));
}
async function handleCancelArmed(stateDir) {
  const store = new Store(stateDir);
  const cancelled = await cancelArmedPlan(store);
  console.log(JSON.stringify({ cancelled }));
}
async function handleReceipt(stateDir, clear = false) {
  const store = new Store(stateDir);
  const receipt = await getReceipt(store);
  if (clear) {
    await clearReceipt(store);
  }
  console.log(JSON.stringify({ receipt }));
}
async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (flags.help || !command) {
    printHelp();
    return;
  }
  const explicitDb = typeof flags.db === "string" ? flags.db : defaultDatabasePath();
  const planPath = path4.resolve(typeof flags.plan === "string" ? flags.plan : typeof flags.out === "string" ? flags.out : "vault-plan.json");
  const batchLimit = typeof flags.max === "string" ? parseInt(flags.max, 10) : void 0;
  const projectID = typeof flags.project === "string" ? flags.project.trim() : void 0;
  const autoConfirm = Boolean(flags.confirm);
  const skipVacuum = Boolean(flags.skipVacuum);
  const asJson = Boolean(flags.json);
  const allowRunning = Boolean(flags.allowRunning || flags["allow-running"]);
  const stateDir = typeof flags["state-dir"] === "string" ? flags["state-dir"] : void 0;
  const ownerPid = typeof flags["owner-pid"] === "string" ? flags["owner-pid"] : void 0;
  try {
    switch (command) {
      case "inspect":
        await handleInspect(
          explicitDb,
          asJson,
          Boolean(flags["check-integrity"] || flags["full-integrity"] || flags.integrity)
        );
        break;
      case "plan":
        await handlePlan(explicitDb, planPath, batchLimit, projectID, asJson, allowRunning, stateDir);
        break;
      case "apply":
        await handleApply(explicitDb, planPath, autoConfirm, skipVacuum);
        break;
      case "run-armed":
        await handleRunArmed(stateDir, ownerPid, skipVacuum);
        break;
      case "cancel-armed":
        await handleCancelArmed(stateDir);
        break;
      case "receipt":
        await handleReceipt(stateDir, Boolean(flags.clear));
        break;
      default:
        console.error(`Comando desconocido: ${command}`);
        printHelp();
        process.exitCode = 1;
    }
  } catch (err) {
    if (asJson) {
      console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    } else {
      console.error(`
Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exitCode = 1;
  }
}
void main();
