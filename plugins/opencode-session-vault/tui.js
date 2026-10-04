// src/tui.tsx
import { effect as _$effect2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { createRoot, ErrorBoundary } from "solid-js";

// src/api.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

// src/policy.ts
import { createHash } from "node:crypto";

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
var safeText = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ");
var errorText = (e) => safeText(e instanceof Error ? e.message : e);
function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "\u2014";
  if (n < 1024) return `${n} B`;
  const kib = n / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(1)} MiB`;
  const gib = mib / 1024;
  return `${gib.toFixed(2)} GiB`;
}
function formatDeltaBytes(delta) {
  if (!Number.isFinite(delta)) return "\u2014";
  if (delta === 0) return "0 B";
  if (delta > 0) return `+${formatBytes(delta)}`;
  return `-${formatBytes(Math.abs(delta))}`;
}
function emptyInventoryMessage(options) {
  if (options.busy) return "Cargando\u2026";
  if (options.error) return "No se pudo cargar el inventario.";
  if (!options.hasPlan) return "Cargando\u2026";
  return "No hay sesiones para mostrar.";
}
function inventoryCountLabel(options) {
  if (options.count > 0) {
    return `${options.pageStart + 1}\u2013${Math.min(options.pageStart + options.pageSize, options.count)} de ${options.count}`;
  }
  if (options.error) return "Error al cargar";
  if (options.busy || !options.hasPlan) return "Cargando\u2026";
  return "0 sesiones";
}
function computeBackoff(consecutiveFailures, intervalMinutes = 30) {
  const intervalMs = Math.max(6e4, intervalMinutes * 6e4);
  return Math.min(intervalMs, 6e4 * Math.pow(2, Math.min(consecutiveFailures, 6)));
}

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
var scopeKey = (c, projectID) => c.scope === "global" ? "global" : `project:${projectID}`;
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
function familyFingerprint(family) {
  return createHash("sha256").update(JSON.stringify(family.members.map((s) => [s.id, s.parentID, s.time.updated]).sort())).digest("hex");
}
function makePlan(snapshot, state, projectID, now = Date.now(), options) {
  validateState(state);
  const key = scopeKey(state.config, projectID);
  const pins = new Set(state.pins);
  const families = familiesOf(snapshot.sessions);
  const isGlobal = state.config.scope === "global";
  const activeProject = Boolean(projectID && typeof projectID === "string" && projectID.trim());
  const eligibleFamilies = isGlobal ? families : activeProject ? families.filter((f) => isFamilyActiveProject(f, projectID)) : [];
  const unpinned = eligibleFamilies.filter((f) => !f.members.some((s) => pins.has(s.id)));
  const quota = resolveQuota(state.config, unpinned.length, state.quotas[key], now);
  const keepIDs = new Set(unpinned.slice(0, quota.keep).map((f) => f.root.id));
  const possible = eligibleFamilies.filter((f) => !f.members.some((s) => pins.has(s.id)) && !keepIDs.has(f.root.id));
  for (const f of families) {
    if (!activeProject) {
      f.reasons.push("Otro proyecto");
    } else if (!isGlobal && !isFamilyActiveProject(f, projectID)) {
      f.reasons.push("Otro proyecto");
    } else if (isGlobal) {
      const rootProj = f.root.projectID;
      const isMixed = !rootProj || !rootProj.trim() || f.members.some((m) => !m.projectID || !m.projectID.trim() || m.projectID !== rootProj);
      if (isMixed) f.reasons.push("Otro proyecto");
    }
    const hasUnverifiableMember = f.members.some((m) => !m || typeof m.projectID !== "string" || !m.projectID.trim() || typeof m.directory !== "string" || !m.directory.trim());
    if (hasUnverifiableMember) f.reasons.push("Actividad no verificada");
    if (f.members.some((s) => pins.has(s.id))) f.reasons.push("Candado");
    if (f.members.some((s) => snapshot.active.has(s.id))) f.reasons.push("Abierta");
    if (f.members.some((s) => snapshot.busy.has(s.id))) f.reasons.push("Trabajando");
    if (f.members.some((s) => snapshot.unverified?.has(s.id))) f.reasons.push("Actividad no verificada");
    if (!state.config.includeArchived && f.members.some((s) => s.time.archived)) f.reasons.push("Archivada");
    if (f.updated > now - state.config.graceHours * 36e5) f.reasons.push("Actividad reciente");
    if (keepIDs.has(f.root.id)) f.reasons.push("Dentro del cupo");
    if (!options?.manualApi) {
      f.reasons.push("Actividad no verificada");
    }
    f.reasons = [...new Set(f.reasons)];
  }
  let candidates = [];
  if (options?.manualApi) {
    const maxFamilies = options.maxManualFamilies ?? 5;
    const eligibleWithoutReasons = families.filter((f) => !f.reasons.length);
    const candidateLot = [...eligibleWithoutReasons].reverse().slice(0, maxFamilies);
    const candidateLotRootIds = new Set(candidateLot.map((f) => f.root.id));
    for (const f of families) {
      if (!f.reasons.length && !candidateLotRootIds.has(f.root.id)) {
        f.reasons.push("Fuera de lote (m\xE1x. 5)");
      }
    }
    candidates = candidateLot;
  } else {
    candidates = families.filter((f) => !f.reasons.length);
  }
  const retained = families.filter((f) => f.reasons.length);
  const verified = [];
  return {
    at: now,
    revision: state.revision,
    scopeKey: key,
    families,
    candidates,
    retained,
    quota,
    locked: families.filter((f) => f.members.some((s) => pins.has(s.id))).length,
    fingerprint: createHash("sha256").update(JSON.stringify([state.revision, key, candidates.map(familyFingerprint), families.map((f) => [f.root.id, familyFingerprint(f), f.reasons])])).digest("hex"),
    possible,
    verified,
    protected: retained,
    manualApi: Boolean(options?.manualApi)
  };
}

// src/api.ts
function canonicalizeDirectory(dirPath) {
  if (!dirPath || typeof dirPath !== "string") return "";
  const resolved = path.resolve(dirPath);
  const parsed = path.parse(resolved);
  let normalized = path.normalize(resolved);
  if (normalized !== parsed.root) {
    normalized = normalized.replace(/[/\\]+$/, "");
  }
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function isSameDirectory(a, b) {
  const canonA = canonicalizeDirectory(a);
  const canonB = canonicalizeDirectory(b);
  if (!canonA || !canonB) return false;
  return canonA === canonB;
}
async function verifyServerDirectoryRouting(client, targetDir, signal) {
  const targetCanonical = canonicalizeDirectory(targetDir);
  if (!targetCanonical) {
    return { proven: false, reason: "invalid_target_directory" };
  }
  const queryParams = { directory: targetDir };
  const requestOptions = {
    throwOnError: true,
    signal,
    headers: {
      "x-opencode-directory": encodeURIComponent(targetDir),
      "x-opencode-workspace": ""
    }
  };
  const pathApi = client.path;
  if (typeof pathApi?.get === "function") {
    try {
      const res = await raceWithSignal(pathApi.get(queryParams, requestOptions), signal);
      const data = res?.data;
      if (data && typeof data === "object") {
        const reportedDir = typeof data.directory === "string" ? canonicalizeDirectory(data.directory) : "";
        const reportedWorktree = typeof data.worktree === "string" ? canonicalizeDirectory(data.worktree) : "";
        if (reportedDir === targetCanonical || reportedWorktree === targetCanonical) {
          return { proven: true, verifiedCanonicalDir: reportedDir || reportedWorktree };
        }
        return {
          proven: false,
          reason: `mismatched_path_identity: expected ${targetCanonical}, got dir=${reportedDir} worktree=${reportedWorktree}`
        };
      }
    } catch (e) {
      if (signal.aborted) throw e;
    }
  }
  const projectApi = client.project;
  if (typeof projectApi?.current === "function") {
    try {
      const res = await raceWithSignal(projectApi.current(queryParams, requestOptions), signal);
      const data = res?.data;
      if (data && typeof data === "object") {
        const reportedWorktree = typeof data.worktree === "string" ? canonicalizeDirectory(data.worktree) : "";
        if (reportedWorktree === targetCanonical) {
          return { proven: true, verifiedCanonicalDir: reportedWorktree };
        }
        return {
          proven: false,
          reason: `mismatched_project_identity: expected ${targetCanonical}, got worktree=${reportedWorktree}`
        };
      }
    } catch (e) {
      if (signal.aborted) throw e;
    }
  }
  return { proven: false, reason: "authoritative_directory_identity_unavailable" };
}
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
function raceWithSignal(promise, signal) {
  if (signal.aborted) {
    return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
  }
  return new Promise((resolve2, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener("abort", onAbort);
        resolve2(val);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}
function createTimeoutController(timeoutMs, parentSignal) {
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  if (timeoutMs && timeoutMs > 0 && timeoutMs < Infinity) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }
  const onParentAbort = () => {
    controller.abort();
  };
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      if (timer) clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    }
  };
}
var OpenCodeGateway = class {
  client;
  activeDirectory;
  activeWorkspaceID;
  constructor(client, options) {
    this.client = client;
    this.activeDirectory = options?.activeDirectory;
    this.activeWorkspaceID = options?.activeWorkspaceID;
  }
  async list(options) {
    const timeoutMs = options?.timeoutMs ?? 15e3;
    const parentSignal = options?.signal;
    const timeoutCtrl = createTimeoutController(timeoutMs, parentSignal);
    try {
      for (let limit = 256; limit <= 131072; limit *= 2) {
        const queryParams = {
          roots: false,
          archived: true,
          limit,
          directory: ""
        };
        if (this.activeWorkspaceID) {
          queryParams.workspace = this.activeWorkspaceID;
        }
        const requestOptions = {
          throwOnError: true,
          signal: timeoutCtrl.signal
        };
        if (this.activeDirectory) {
          requestOptions.headers = {
            "x-opencode-directory": encodeURIComponent(this.activeDirectory)
          };
        }
        const r = await raceWithSignal(this.client.experimental.session.list(queryParams, requestOptions), timeoutCtrl.signal);
        if (!Array.isArray(r.data)) throw new Error("OpenCode no devolvi\xF3 el inventario de sesiones.");
        if (r.data.length < limit && !r.response?.headers?.get?.("x-next-cursor")) {
          const sessions = r.data;
          validateSessions(sessions);
          return sessions;
        }
      }
      throw new Error("Inventario demasiado grande para verificarlo completo. Limpieza suspendida.");
    } catch (e) {
      if (timeoutCtrl.didTimeout()) {
        throw new Error("Tiempo de espera agotado al consultar el inventario de sesiones.");
      }
      if (parentSignal?.aborted) {
        throw new Error("Operaci\xF3n cancelada.");
      }
      throw e;
    } finally {
      timeoutCtrl.dispose();
    }
  }
  async snapshot(active, activeDirectory, activeProjectID, options) {
    const sessions = await this.list(options);
    const busy = /* @__PURE__ */ new Set();
    const unverified = /* @__PURE__ */ new Set();
    if (options?.liveness === false) {
      return { sessions, busy, active, unverified };
    }
    const effectiveActiveDir = activeDirectory ?? this.activeDirectory;
    const timeoutMs = options?.timeoutMs ?? 3e4;
    const parentSignal = options?.signal;
    const timeoutCtrl = createTimeoutController(timeoutMs, parentSignal);
    try {
      let statusData = {};
      if (effectiveActiveDir) {
        const queryParams = { directory: effectiveActiveDir };
        if (this.activeWorkspaceID) {
          queryParams.workspace = this.activeWorkspaceID;
        }
        const requestOptions = {
          throwOnError: true,
          signal: timeoutCtrl.signal,
          headers: {
            "x-opencode-directory": encodeURIComponent(effectiveActiveDir)
          }
        };
        const r = await raceWithSignal(this.client.session.status(queryParams, requestOptions), timeoutCtrl.signal);
        if (!r.data || typeof r.data !== "object" || Array.isArray(r.data)) {
          throw new Error("No se pudo verificar el estado de actividad.");
        }
        statusData = r.data;
      }
      for (const s of sessions) {
        if (effectiveActiveDir && isSameDirectory(s.directory, effectiveActiveDir)) {
          const st = statusData[s.id];
          if (st) {
            if (!st.type || !["idle", "busy", "retry"].includes(st.type)) {
              busy.add(s.id);
              unverified.add(s.id);
            } else if (st.type !== "idle") {
              busy.add(s.id);
            }
          }
        }
      }
      const candidateDirsSet = /* @__PURE__ */ new Set();
      const candidateDirsList = [];
      if (options?.candidateDirectories) {
        for (const d of options.candidateDirectories) {
          if (d && (!effectiveActiveDir || !isSameDirectory(d, effectiveActiveDir))) {
            const canon = canonicalizeDirectory(d);
            if (canon && !candidateDirsSet.has(canon)) {
              candidateDirsSet.add(canon);
              candidateDirsList.push(d);
            }
          }
        }
      }
      const foreignDirsToCheck = candidateDirsList;
      if (foreignDirsToCheck.length > 0) {
        const foreignStartTime = Date.now();
        await mapConcurrent(foreignDirsToCheck, 4, async (dir) => {
          if (parentSignal?.aborted) return;
          if (timeoutCtrl.didTimeout()) {
            for (const s of sessions) {
              if (isSameDirectory(s.directory, dir)) {
                busy.add(s.id);
                unverified.add(s.id);
              }
            }
            return;
          }
          let exists = false;
          try {
            const stat3 = await fs.stat(dir);
            exists = stat3.isDirectory();
          } catch {
            exists = false;
          }
          if (!exists) {
            for (const s of sessions) {
              if (isSameDirectory(s.directory, dir)) {
                busy.add(s.id);
                unverified.add(s.id);
              }
            }
            return;
          }
          const remainingMs = Math.max(50, timeoutMs - (Date.now() - foreignStartTime));
          const dirTimeoutMs = Math.min(5e3, remainingMs);
          const dirTimeoutCtrl = createTimeoutController(dirTimeoutMs, timeoutCtrl.signal);
          try {
            const queryParams = { directory: dir };
            const requestOptions = {
              throwOnError: true,
              signal: dirTimeoutCtrl.signal,
              headers: {
                "x-opencode-directory": encodeURIComponent(dir),
                "x-opencode-workspace": ""
              }
            };
            let statusClient = this.client;
            const transport = this.client;
            const clientConfig = transport.client?.getConfig?.();
            if (clientConfig) {
              try {
                const detachedHeaders = new Headers(clientConfig.headers);
                detachedHeaders.delete("x-opencode-workspace");
                detachedHeaders.delete("x-opencode-directory");
                statusClient = createOpencodeClient({
                  baseUrl: clientConfig.baseUrl,
                  fetch: clientConfig.fetch,
                  headers: Object.fromEntries(detachedHeaders.entries()),
                  directory: dir
                });
              } catch {
              }
            }
            const routingProof = await verifyServerDirectoryRouting(statusClient, dir, dirTimeoutCtrl.signal);
            const r = await raceWithSignal(statusClient.session.status(queryParams, requestOptions), dirTimeoutCtrl.signal);
            if (!r.data || typeof r.data !== "object" || Array.isArray(r.data)) {
              throw new Error("Respuesta de estado inv\xE1lida");
            }
            const dirStatus = r.data;
            let headerProven = false;
            const rawHeader = r.response?.headers?.get?.("x-opencode-directory");
            if (rawHeader) {
              try {
                const decoded = decodeURIComponent(rawHeader);
                if (isSameDirectory(decoded, dir)) {
                  headerProven = true;
                }
              } catch {
              }
            }
            const routingProven = routingProof.proven || headerProven;
            for (const s of sessions) {
              if (isSameDirectory(s.directory, dir)) {
                const st = dirStatus[s.id];
                if (st) {
                  if (!st.type || !["idle", "busy", "retry"].includes(st.type)) {
                    busy.add(s.id);
                    unverified.add(s.id);
                  } else if (st.type !== "idle") {
                    busy.add(s.id);
                  }
                } else if (!routingProven) {
                  busy.add(s.id);
                  unverified.add(s.id);
                }
              }
            }
          } catch (err) {
            if (parentSignal?.aborted) throw err;
            for (const s of sessions) {
              if (isSameDirectory(s.directory, dir)) {
                busy.add(s.id);
                unverified.add(s.id);
              }
            }
          } finally {
            dirTimeoutCtrl.dispose();
          }
        });
      }
      for (const s of sessions) {
        const isInActiveDir = Boolean(effectiveActiveDir && isSameDirectory(s.directory, effectiveActiveDir));
        const sCanon = canonicalizeDirectory(s.directory);
        const isInCandidateDir = Boolean(sCanon && candidateDirsSet.has(sCanon));
        if (!isInActiveDir && !isInCandidateDir) {
          busy.add(s.id);
          unverified.add(s.id);
        }
      }
    } catch (e) {
      if (timeoutCtrl.didTimeout()) {
        throw new Error("Tiempo de espera agotado al verificar el estado de actividad.");
      }
      if (parentSignal?.aborted) {
        throw new Error("Operaci\xF3n cancelada.");
      }
      throw e;
    } finally {
      timeoutCtrl.dispose();
    }
    return { sessions, busy, active, unverified };
  }
  async exportSession(session, options) {
    const timeoutMs = options?.timeoutMs ?? 3e4;
    const parentSignal = options?.signal;
    const timeoutCtrl = createTimeoutController(timeoutMs, parentSignal);
    try {
      const parameters = { sessionID: session.id, directory: session.directory };
      const info = (await this.client.session.get(parameters, { throwOnError: true, signal: timeoutCtrl.signal })).data;
      if (!info) throw new Error("Sesi\xF3n no disponible para respaldo.");
      const messages = [];
      const cursors = /* @__PURE__ */ new Set();
      const ids = /* @__PURE__ */ new Set();
      let before;
      for (let page = 0; page < 1e4; page++) {
        const r = await this.client.session.messages({ ...parameters, limit: 200, before }, { throwOnError: true, signal: timeoutCtrl.signal });
        if (!Array.isArray(r.data)) throw new Error("Respuesta de mensajes inv\xE1lida.");
        for (const msg of r.data) {
          if (ids.has(msg.info.id) || !Array.isArray(msg.parts)) throw new Error("Respaldo incompleto o mensajes duplicados.");
          ids.add(msg.info.id);
          messages.push(msg);
        }
        const next = r.response.headers.get("x-next-cursor");
        if (!next) {
          messages.sort((a, b) => Number(a.info.time?.created ?? 0) - Number(b.info.time?.created ?? 0) || a.info.id.localeCompare(b.info.id));
          return { info, messages };
        }
        if (cursors.has(next) || !r.data.length) throw new Error("Paginaci\xF3n de mensajes inconsistente.");
        cursors.add(next);
        before = next;
      }
      throw new Error("Respaldo demasiado grande; se conserva la sesi\xF3n.");
    } catch (e) {
      if (timeoutCtrl.didTimeout()) {
        throw new Error("Tiempo de espera agotado al respaldar la sesi\xF3n.");
      }
      if (parentSignal?.aborted) {
        throw new Error("Operaci\xF3n cancelada.");
      }
      throw e;
    } finally {
      timeoutCtrl.dispose();
    }
  }
  async remove(session, options) {
    if (options?.signal?.aborted) {
      throw new Error("Operaci\xF3n cancelada.");
    }
    const r = await this.client.session.delete(
      { sessionID: session.id, directory: session.directory },
      { throwOnError: true, signal: options?.signal }
    );
    if (r.data !== true) throw new Error("OpenCode no confirm\xF3 la eliminaci\xF3n.");
    if ((await this.list(options)).some((s) => s.id === session.id)) {
      throw new Error("OpenCode conserva la sesi\xF3n tras solicitar el borrado. Revisa el registro.");
    }
  }
  /**
   * Safe read-only diagnostic that tests whether the server can authoritatively prove
   * routing for the given directory. Produces no side effects and exposes no secrets.
   */
  async diagnoseDirectoryRouting(dir, options) {
    const canonicalDir = canonicalizeDirectory(dir);
    let existsOnDisk = false;
    try {
      const stat3 = await fs.stat(dir);
      existsOnDisk = stat3.isDirectory();
    } catch {
      existsOnDisk = false;
    }
    if (!existsOnDisk) {
      return {
        directory: dir,
        canonicalDirectory: canonicalDir,
        existsOnDisk: false,
        proven: false,
        reason: "directory_not_found_on_disk"
      };
    }
    const timeoutMs = options?.timeoutMs ?? 5e3;
    const timeoutCtrl = createTimeoutController(timeoutMs, options?.signal);
    try {
      let statusClient = this.client;
      const transport = this.client;
      const clientConfig = transport.client?.getConfig?.();
      if (clientConfig) {
        try {
          const detachedHeaders = new Headers(clientConfig.headers);
          detachedHeaders.delete("x-opencode-workspace");
          detachedHeaders.delete("x-opencode-directory");
          statusClient = createOpencodeClient({
            baseUrl: clientConfig.baseUrl,
            fetch: clientConfig.fetch,
            headers: Object.fromEntries(detachedHeaders.entries()),
            directory: dir
          });
        } catch {
        }
      }
      const proof = await verifyServerDirectoryRouting(statusClient, dir, timeoutCtrl.signal);
      return {
        directory: dir,
        canonicalDirectory: canonicalDir,
        existsOnDisk: true,
        proven: proof.proven,
        reason: proof.reason
      };
    } catch (err) {
      return {
        directory: dir,
        canonicalDirectory: canonicalDir,
        existsOnDisk: true,
        proven: false,
        reason: err?.message || String(err)
      };
    } finally {
      timeoutCtrl.dispose();
    }
  }
};

// src/store.ts
import * as fs2 from "node:fs/promises";
import path2 from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
function normalizeManualApiOutcome(record) {
  const timestamp = typeof record.at === "number" ? record.at : Date.now();
  const deletedArr = Array.isArray(record.deleted) ? record.deleted : [];
  const deletedFamiliesCount = typeof record.deletedFamiliesCount === "number" ? record.deletedFamiliesCount : deletedArr.length;
  const deletedSessionsCount = typeof record.deletedSessionsCount === "number" ? record.deletedSessionsCount : void 0;
  const targetFamiliesCount = typeof record.targetFamiliesCount === "number" ? record.targetFamiliesCount : void 0;
  const targetSessionsCount = typeof record.targetSessionsCount === "number" ? record.targetSessionsCount : void 0;
  const error = record.error ? String(record.error) : void 0;
  let status;
  if (record.status === "success" || record.status === "partial" || record.status === "failed") {
    status = record.status;
  } else if (error) {
    status = deletedFamiliesCount > 0 ? "partial" : "failed";
  } else {
    status = "success";
  }
  const backupVerified = typeof record.backupVerified === "boolean" ? record.backupVerified : false;
  const uncertainDescendants = typeof record.uncertainDescendants === "boolean" ? record.uncertainDescendants : Boolean(error && status !== "success");
  const archivesArr = Array.isArray(record.archives) ? record.archives : [];
  const dbSizeBytesBefore = typeof record.dbSizeBytesBefore === "number" ? record.dbSizeBytesBefore : void 0;
  const dbSizeBytesAfter = typeof record.dbSizeBytesAfter === "number" ? record.dbSizeBytesAfter : void 0;
  const dbSizeDeltaBytes = typeof record.dbSizeDeltaBytes === "number" ? record.dbSizeDeltaBytes : dbSizeBytesBefore !== void 0 && dbSizeBytesAfter !== void 0 ? dbSizeBytesAfter - dbSizeBytesBefore : void 0;
  const walSizeBytesBefore = typeof record.walSizeBytesBefore === "number" ? record.walSizeBytesBefore : void 0;
  const walSizeBytesAfter = typeof record.walSizeBytesAfter === "number" ? record.walSizeBytesAfter : void 0;
  return {
    operationId: record.operationId ? String(record.operationId) : void 0,
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
    walSizeBytesAfter
  };
}
function stateDirectory() {
  return process.env.OPENCODE_SESSION_VAULT_HOME || path2.join(process.env.XDG_STATE_HOME || path2.join(os.homedir(), ".local", "state"), "opencode-session-vault");
}
async function atomicWrite(file, text) {
  await fs2.mkdir(path2.dirname(file), { recursive: true, mode: 448 });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs2.open(temp, "wx", 384);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs2.rename(temp, file);
  } catch (e) {
    await fs2.rm(temp, { force: true });
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
      return validateState(JSON.parse(await fs2.readFile(path2.join(this.dir, "state.json"), "utf8")));
    } catch (e) {
      if (e.code === "ENOENT") return defaultState();
      throw e;
    }
  }
  async save(state) {
    validateState(state);
    await atomicWrite(path2.join(this.dir, "state.json"), JSON.stringify(state, null, 2));
  }
  async exclusive(fn) {
    await fs2.mkdir(this.dir, { recursive: true, mode: 448 });
    const lock = path2.join(this.dir, "operation.lock");
    let handle;
    try {
      handle = await fs2.open(lock, "wx", 384);
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
      await fs2.unlink(lock);
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
    const file = path2.join(this.dir, "state.json");
    let raw;
    try {
      raw = await fs2.readFile(file, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") {
        return this.exclusive(async () => {
          try {
            const recheck = await fs2.readFile(file, "utf8");
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
      const rawUnderLock = await fs2.readFile(file, "utf8");
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
    await atomicWrite(path2.join(this.dir, "history", `${Date.now()}-${randomUUID()}.json`), JSON.stringify(record, null, 2));
  }
  async getLastManualApiOutcome() {
    const historyDir = path2.join(this.dir, "history");
    let entries;
    try {
      entries = await fs2.readdir(historyDir);
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
    const jsonFiles = entries.filter((f) => f.endsWith(".json")).sort((a, b) => {
      const timeA = parseInt(a.split("-")[0], 10) || 0;
      const timeB = parseInt(b.split("-")[0], 10) || 0;
      return timeB - timeA;
    });
    for (const file of jsonFiles) {
      try {
        const raw = await fs2.readFile(path2.join(historyDir, file), "utf8");
        const record = JSON.parse(raw);
        if (record && typeof record === "object" && record.mode === "manual-api") {
          return normalizeManualApiOutcome(record);
        }
      } catch {
      }
    }
    return null;
  }
};

// src/service.ts
import { randomUUID as randomUUID4 } from "node:crypto";

// src/archive.ts
import * as fs3 from "node:fs/promises";
import path3 from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
var zip = promisify(gzip);
var unzip = promisify(gunzip);
async function backupFamily(store, gateway, family) {
  const id = `${Date.now()}-${randomUUID2()}`;
  const directory = path3.join(store.dir, "backups", id);
  const manifest = {
    schema: 1,
    id,
    rootID: family.root.id,
    title: family.root.title,
    created: Date.now(),
    status: "backed-up",
    files: []
  };
  try {
    for (const session of family.members) {
      const data = await gateway.exportSession(session);
      if (data.info.time.updated !== session.time.updated) throw new Error("La sesi\xF3n cambi\xF3 durante el respaldo.");
      const bytes = Buffer.from(JSON.stringify(data));
      if (bytes.length > 256 * 1024 * 1024) throw new Error("La conversaci\xF3n supera el l\xEDmite de respaldo de 256 MiB. Se conserva.");
      const compressed = await zip(bytes);
      const file = `${session.id}.json.gz`;
      await atomicWrite(path3.join(directory, file), compressed);
      const saved = await unzip(await fs3.readFile(path3.join(directory, file)));
      const hash = createHash2("sha256").update(bytes).digest("hex");
      if (createHash2("sha256").update(saved).digest("hex") !== hash) throw new Error("No se pudo verificar el respaldo.");
      manifest.files.push({
        sessionID: session.id,
        directory: session.directory,
        file,
        sha256: hash,
        bytes: bytes.length,
        compressed: compressed.length
      });
    }
    await saveManifest(store, manifest);
    return manifest;
  } catch (e) {
    await fs3.rm(directory, { recursive: true, force: true });
    throw e;
  }
}
async function saveManifest(store, manifest) {
  await atomicWrite(path3.join(store.dir, "backups", manifest.id, "manifest.json"), JSON.stringify(manifest, null, 2));
}
async function listBackups(store) {
  let entries;
  try {
    entries = await fs3.readdir(path3.join(store.dir, "backups"), { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const m = JSON.parse(await fs3.readFile(path3.join(store.dir, "backups", entry.name, "manifest.json"), "utf8"));
    if (m.schema !== 1 || m.id !== entry.name || !Array.isArray(m.files)) throw new Error("Hay un respaldo incompleto; inspecciona la carpeta de respaldos.");
    result.push(m);
  }
  return result.sort((a, b) => b.created - a.created);
}

// src/coordination.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import * as fs4 from "node:fs/promises";
import path4 from "node:path";
var ARMED_PLAN_FILE = "armed-plan.json";
var CLAIMED_PLAN_FILE = "claimed-plan.json";
var RECEIPT_FILE = "maintenance-receipt.json";
function checkPidLiveness(pid, customChecker) {
  if (pid === void 0 || pid <= 0 || !Number.isInteger(pid)) {
    return { status: "unknown", reason: "PID ausente o no disponible" };
  }
  if (customChecker) {
    const res = customChecker(pid);
    if (typeof res === "string") return { status: res };
    return { status: res ? "alive" : "dead" };
  }
  try {
    process.kill(pid, 0);
    return { status: "alive" };
  } catch (err) {
    const code = err.code;
    if (code === "ESRCH") {
      return { status: "dead" };
    }
    if (code === "EPERM" || code === "EACCES") {
      return { status: "unknown", reason: "Acceso denegado (EPERM/EACCES): proceso no descartable como muerto" };
    }
    return { status: "unknown", reason: String(err) };
  }
}
async function getClaimedPlan(store) {
  const claimedFile = path4.join(store.dir, CLAIMED_PLAN_FILE);
  try {
    const raw = await fs4.readFile(claimedFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function inspectClaimedState(store, options) {
  const claimedFile = path4.join(store.dir, CLAIMED_PLAN_FILE);
  const claimed = await getClaimedPlan(store);
  if (!claimed) return null;
  let workerPid = claimed.workerPid;
  let workerPidFile;
  const potentialPidFile = path4.join(store.dir, `worker-pid-${claimed.id}.json`);
  try {
    const rawPid = await fs4.readFile(potentialPidFile, "utf8");
    const pidData = JSON.parse(rawPid);
    if (typeof pidData.workerPid === "number") {
      workerPid = pidData.workerPid;
      workerPidFile = potentialPidFile;
    }
  } catch {
  }
  const receipt = await getReceipt(store);
  const hasReceipt = Boolean(receipt && receipt.id === claimed.id);
  const { status: pidStatus } = checkPidLiveness(workerPid, options?.isPidAlive);
  let status;
  if (pidStatus === "alive") {
    status = "active";
  } else if (pidStatus === "dead") {
    status = hasReceipt ? "unknown" : "interrupted";
  } else {
    status = "unknown";
  }
  const selectedFamilyCount = claimed.plan.selectedFamilies?.length ?? 0;
  const totalSessionCount = claimed.plan.selectedFamilies?.flatMap((f) => f.memberIds ?? []).length ?? 0;
  return {
    status,
    pidStatus,
    claimedPlan: claimed,
    workerPid,
    claimedFile,
    hasReceipt,
    workerPidFile,
    incidentInfo: {
      armId: claimed.id,
      canonicalDbPath: claimed.plan.canonicalDbPath,
      selectedFamilyCount,
      totalSessionCount,
      armedAt: claimed.armedAt,
      outcome: "uncertain",
      actionableMessage: "Operaci\xF3n interrumpida: proceso trabajador ausente sin recibo. Preservar respaldos (.sqlite). No se ha revertido autom\xE1ticamente. Resultado incierto hasta validaci\xF3n manual."
    }
  };
}
async function armOfflinePlan(options) {
  const claimed = await getClaimedPlan(options.store);
  if (claimed) {
    throw new Error(
      "Mantenimiento suspendido: operaci\xF3n interrumpida / exclusi\xF3n no garantizada (se detect\xF3 un plan reclamado previo sin resolver)."
    );
  }
  if (!options._trustedTestExecution) {
    throw new Error(
      "Mantenimiento suspendido: operaci\xF3n interrumpida / exclusi\xF3n no garantizada (coordinaci\xF3n exclusiva de host no disponible en producci\xF3n)."
    );
  }
  const armedAt = Date.now();
  const ttlMs = options.ttlMs ?? 5 * 60 * 1e3;
  const expiresAt = armedAt + ttlMs;
  const armedPlan = {
    version: 1,
    id: options.armId ?? randomUUID3(),
    armedAt,
    expiresAt,
    ownerPid: options.ownerPid,
    workerPid: options.workerPid,
    monitorPid: options.monitorPid,
    plan: options.plan,
    status: "armed"
  };
  const armedFile = path4.join(options.store.dir, ARMED_PLAN_FILE);
  await atomicWrite(armedFile, JSON.stringify(armedPlan, null, 2));
  return armedPlan;
}
async function cancelArmedPlan(store) {
  const armedFile = path4.join(store.dir, ARMED_PLAN_FILE);
  try {
    const raw = await fs4.readFile(armedFile, "utf8");
    const armed = JSON.parse(raw);
    if (armed.status === "claimed") {
      return false;
    }
    await fs4.unlink(armedFile);
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
  const armedFile = path4.join(store.dir, ARMED_PLAN_FILE);
  try {
    const raw = await fs4.readFile(armedFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeReceipt(store, receipt) {
  const receiptFile = path4.join(store.dir, RECEIPT_FILE);
  await atomicWrite(receiptFile, JSON.stringify(receipt, null, 2));
}
async function getReceipt(store) {
  const receiptFile = path4.join(store.dir, RECEIPT_FILE);
  try {
    const raw = await fs4.readFile(receiptFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function clearReceipt(store) {
  const receiptFile = path4.join(store.dir, RECEIPT_FILE);
  await fs4.rm(receiptFile, { force: true });
}
async function checkManualApiAvailability(store, options) {
  const claimed = options?.helperClient?.inspectClaimed ? await options.helperClient.inspectClaimed() : await inspectClaimedState(store, options);
  if (claimed) {
    if (claimed.status === "active") {
      return {
        available: false,
        reason: `Hay un trabajador de mantenimiento fuera de l\xEDnea activo (PID ${claimed.workerPid ?? "desconocido"}). Limpieza por API suspendida.`,
        report: claimed
      };
    }
    if (claimed.status === "unknown") {
      return {
        available: false,
        reason: "Estado del proceso fuera de l\xEDnea desconocido (acceso denegado o incierto). Limpieza por API suspendida por seguridad.",
        report: claimed
      };
    }
    return {
      available: true,
      report: claimed
    };
  }
  const armed = await getArmedPlan(store);
  if (armed && armed.status === "armed" && Date.now() < armed.expiresAt) {
    const { status: ownerStatus } = checkPidLiveness(armed.ownerPid, options?.isPidAlive);
    if (ownerStatus === "alive") {
      return {
        available: false,
        reason: "Hay un plan de mantenimiento armado en espera. Cancela el plan antes de limpiar por API."
      };
    }
  }
  return {
    available: true,
    report: null
  };
}

// src/service.ts
var VaultService = class {
  gateway;
  store;
  projectID;
  projectDirectory;
  active;
  allowed;
  signal;
  metricsBackend;
  constructor(options) {
    this.gateway = options.gateway;
    this.store = options.store;
    this.projectID = options.projectID;
    this.projectDirectory = options.projectDirectory;
    this.active = options.active;
    this.allowed = options.allowed ?? (async () => {
    });
    this.signal = options.signal;
    this.metricsBackend = options.metricsBackend;
  }
  assertAlive() {
    if (this.signal?.aborted) throw new Error("OpenCode est\xE1 cerrando; limpieza cancelada.");
  }
  async preview(options) {
    const state = await this.store.read();
    const liveness = options?.liveness ?? false;
    let candidateDirectories;
    if (liveness) {
      const inv = await this.gateway.snapshot(this.active(), this.projectDirectory, this.projectID, {
        signal: options?.signal ?? this.signal,
        liveness: false,
        timeoutMs: options?.timeoutMs
      });
      const prePlan = makePlan(inv, state, this.projectID, Date.now(), {
        manualApi: options?.manualApi,
        maxManualFamilies: options?.maxManualFamilies
      });
      const livenessSource = prePlan.possible?.length ? prePlan.possible : prePlan.candidates;
      candidateDirectories = new Set(livenessSource.flatMap((f) => f.members.map((m) => m.directory)));
    }
    const snapshot = await this.gateway.snapshot(this.active(), this.projectDirectory, this.projectID, {
      signal: options?.signal ?? this.signal,
      liveness,
      timeoutMs: options?.timeoutMs,
      candidateDirectories
    });
    return makePlan(snapshot, state, this.projectID, Date.now(), {
      manualApi: options?.manualApi,
      maxManualFamilies: options?.maxManualFamilies
    });
  }
  async configure(patch, recalculate = false) {
    await this.store.update((state) => {
      state.config = { ...state.config, ...patch };
      if (recalculate) delete state.quotas[scopeKey(state.config, this.projectID)];
    });
  }
  async pin(id) {
    await this.store.update((s) => {
      s.pins = s.pins.includes(id) ? s.pins.filter((p) => p !== id) : [...s.pins, id];
    });
  }
  async cleanup(approved, automatic = false, options) {
    return this.store.exclusive(async () => {
      this.assertAlive();
      await this.allowed();
      if (!this.projectID || typeof this.projectID !== "string" || !this.projectID.trim()) {
        throw new Error("No se pudo identificar el proyecto activo. Limpieza suspendida.");
      }
      const state = await this.store.read();
      if (automatic && (state.schema < 2 || !state.config.automatic || Date.now() - state.lastRun < state.config.intervalMinutes * 6e4)) return { deleted: [], skipped: [], archives: [] };
      const isManualApi = Boolean(options?.manualApi || approved.manualApi) && !automatic;
      if (isManualApi && approved.candidates.length > 5) {
        throw new Error("El lote manual por API supera el l\xEDmite m\xE1ximo de 5 familias.");
      }
      if (state.revision !== approved.revision || Date.now() - approved.at > 5 * 6e4) throw new Error("La vista previa cambi\xF3 o venci\xF3. Actual\xEDzala antes de limpiar.");
      const candidateDirs = new Set((approved.possible ?? approved.candidates).flatMap((f) => f.members.map((m) => m.directory)));
      const beforeSnapshot = await this.gateway.snapshot(this.active(), this.projectDirectory, this.projectID, {
        signal: this.signal,
        liveness: true,
        candidateDirectories: candidateDirs
      });
      const before = makePlan(beforeSnapshot, state, this.projectID, Date.now(), { manualApi: isManualApi });
      if (before.fingerprint !== approved.fingerprint) throw new Error("Las sesiones cambiaron. Revisa una vista previa nueva.");
      if (JSON.stringify(state.quotas[before.scopeKey]) !== JSON.stringify(before.quota)) {
        state.quotas[before.scopeKey] = before.quota;
        await this.store.save(state);
      }
      const result = { deleted: [], skipped: [], archives: [] };
      if (!isManualApi) {
        const targets2 = [...approved.candidates].reverse().slice(0, state.config.maxDeletePerRun);
        if (targets2.length > 0 || approved.verified?.length > 0) {
          throw new Error("Limpieza no admitida en este host: falta exclusi\xF3n entre instancias. No se borrar\xE1 nada.");
        }
        const latest2 = await this.store.read();
        latest2.lastRun = Date.now();
        latest2.revision++;
        await this.store.save(latest2);
        await this.store.audit({ at: Date.now(), mode: automatic ? "automatic" : "manual", ...result });
        return result;
      }
      const availability = await checkManualApiAvailability(this.store);
      if (!availability.available) {
        throw new Error(`Limpieza por API no disponible: ${availability.reason}`);
      }
      const metrics = options?.metricsBackend ?? this.metricsBackend;
      let statsBefore;
      if (metrics && typeof metrics.getDiskStats === "function") {
        try {
          statsBefore = await metrics.getDiskStats();
        } catch {
        }
      }
      const targets = approved.candidates;
      const operationId = `${Date.now()}-${randomUUID4()}`;
      const targetFamiliesCount = targets.length;
      const targetSessionsCount = targets.reduce((sum, f) => sum + f.members.length, 0);
      let deletedFamiliesCount = 0;
      let deletedSessionsCount = 0;
      let backupVerified = true;
      let uncertainDescendants = false;
      try {
        for (const family of targets) {
          this.assertAlive();
          await this.allowed();
          if (state.config.scope === "project" && !isFamilyActiveProject(family, this.projectID)) {
            throw new Error("La familia no pertenece al proyecto activo. Limpieza abortada.");
          }
          const freshSnapshot = await this.gateway.snapshot(this.active(), this.projectDirectory, this.projectID, {
            signal: this.signal,
            liveness: true,
            candidateDirectories: new Set(family.members.map((m) => m.directory))
          });
          const currentFamilies = familiesOf(freshSnapshot.sessions);
          const current = currentFamilies.find((f) => f.root.id === family.root.id);
          if (!current) {
            throw new Error("La familia ya no existe en el inventario. Limpieza abortada.");
          }
          if (current.members.length !== family.members.length) {
            throw new Error("Se detectaron cambios en los miembros de la familia (nueva hija o sesi\xF3n faltante). Limpieza abortada; genera una nueva vista previa.");
          }
          for (const m of family.members) {
            const freshMember = current.members.find((s) => s.id === m.id);
            if (!freshMember) {
              throw new Error("Miembro de familia ausente. Limpieza abortada.");
            }
            if (freshMember.time.updated !== m.time.updated) {
              throw new Error("La actividad de una sesi\xF3n cambi\xF3 tras la vista previa. Limpieza abortada.");
            }
            if (freshMember.parentID !== m.parentID) {
              throw new Error("La jerarqu\xEDa de la familia cambi\xF3. Limpieza abortada.");
            }
          }
          const freshState = await this.store.read();
          if (current.members.some((m) => freshState.pins.includes(m.id))) {
            throw new Error("Se a\xF1adi\xF3 un candado a la familia tras la vista previa. Limpieza abortada.");
          }
          if (current.members.some((m) => this.active().has(m.id))) {
            throw new Error("La familia tiene una sesi\xF3n abierta activa. Limpieza abortada.");
          }
          if (current.members.some((m) => freshSnapshot.busy.has(m.id))) {
            throw new Error("La familia tiene una sesi\xF3n trabajando. Limpieza abortada.");
          }
          if (current.members.some((m) => freshSnapshot.unverified?.has(m.id))) {
            throw new Error("La familia tiene actividad no verificada. Limpieza abortada.");
          }
          const backup = await backupFamily(this.store, this.gateway, current);
          result.archives.push(backup.id);
          try {
            this.assertAlive();
            await this.allowed();
            if (JSON.stringify(await this.store.read()) !== JSON.stringify(state)) {
              throw new Error("La configuraci\xF3n cambi\xF3 durante la limpieza.");
            }
            const preDeleteSnapshot = await this.gateway.snapshot(this.active(), this.projectDirectory, this.projectID, {
              signal: this.signal,
              liveness: true,
              candidateDirectories: new Set(family.members.map((m) => m.directory))
            });
            const preDeleteFamilies = familiesOf(preDeleteSnapshot.sessions);
            const preDelete = preDeleteFamilies.find((f) => f.root.id === family.root.id);
            if (!preDelete || preDelete.members.length !== family.members.length || preDelete.members.some(
              (m) => !family.members.some(
                (orig) => orig.id === m.id && orig.time.updated === m.time.updated && orig.parentID === m.parentID
              )
            )) {
              throw new Error(
                "Se detectaron cambios en los miembros de la familia antes de borrar. Limpieza abortada; genera una nueva vista previa."
              );
            }
            try {
              await this.gateway.remove(current.root, { signal: this.signal });
            } catch (removeErr) {
              uncertainDescendants = true;
              throw removeErr;
            }
            const remaining = await this.gateway.list({ signal: this.signal });
            if (current.members.some((m) => remaining.some((s) => s.id === m.id))) {
              uncertainDescendants = true;
              throw new Error("Eliminaci\xF3n parcial por API: se conserva el respaldo para revisi\xF3n.");
            }
            backup.status = "deleted";
            result.deleted.push(current.root.id);
            deletedFamiliesCount++;
            deletedSessionsCount += current.members.length;
            await saveManifest(this.store, backup);
          } catch (e) {
            backup.status = "error";
            await saveManifest(this.store, backup);
            throw e;
          }
        }
      } catch (e) {
        result.error = errorText(e);
      }
      let statsAfter;
      if (metrics && typeof metrics.getDiskStats === "function") {
        try {
          statsAfter = await metrics.getDiskStats();
        } catch {
        }
      }
      if (statsBefore && typeof statsBefore.sizeBytes === "number" && statsAfter && typeof statsAfter.sizeBytes === "number") {
        result.dbSizeBytesBefore = statsBefore.sizeBytes;
        result.dbSizeBytesAfter = statsAfter.sizeBytes;
        result.dbSizeDeltaBytes = statsAfter.sizeBytes - statsBefore.sizeBytes;
        result.walSizeBytesBefore = statsBefore.walSizeBytes;
        result.walSizeBytesAfter = statsAfter.walSizeBytes;
      }
      result.operationId = operationId;
      result.timestamp = Date.now();
      result.targetFamiliesCount = targetFamiliesCount;
      result.targetSessionsCount = targetSessionsCount;
      result.deletedFamiliesCount = deletedFamiliesCount;
      result.deletedSessionsCount = deletedSessionsCount;
      result.backupVerified = result.archives.length > 0 ? backupVerified : false;
      result.uncertainDescendants = uncertainDescendants;
      if (result.error) {
        result.status = deletedFamiliesCount > 0 ? "partial" : "failed";
      } else {
        result.status = "success";
      }
      const latest = await this.store.read();
      latest.lastRun = Date.now();
      latest.revision++;
      await this.store.save(latest);
      await this.store.audit({ at: result.timestamp, mode: "manual-api", ...result });
      return result;
    });
  }
};

// src/leases.ts
import * as fs5 from "node:fs/promises";
import path5 from "node:path";
import { execFile } from "node:child_process";
import { randomUUID as randomUUID5 } from "node:crypto";
function classifyProcess(proc) {
  const exe = (proc.executablePath || "").toLowerCase();
  const rawName = proc.name || (proc.executablePath ? path5.basename(proc.executablePath) : "");
  const name = rawName.toLowerCase().replace(/\.exe$/, "");
  const cmd = (proc.commandLine || "").toLowerCase();
  if (name === "opencode" || exe.endsWith("\\opencode.exe") || exe.endsWith("/opencode") || exe.endsWith("\\opencode")) {
    return "opencode";
  }
  if (name === "node" || name === "bun") {
    if (cmd.includes("opencode") || cmd.includes("session-vault")) {
      return "opencode";
    }
    if (cmd && !cmd.includes("opencode") && !cmd.includes("session-vault")) {
      return "unrelated";
    }
    return "ambiguous";
  }
  const UNRELATED_NAMES = /* @__PURE__ */ new Set([
    "chrome",
    "msedge",
    "firefox",
    "brave",
    "opera",
    "iexplore",
    "safari",
    "conhost",
    "openconsole",
    "cmd",
    "powershell",
    "pwsh",
    "bash",
    "zsh",
    "wt",
    "warp",
    "alacritty",
    "kitty",
    "wezterm",
    "hyper",
    "tmux",
    "kubectl",
    "docker",
    "containerd",
    "podman",
    "git",
    "ssh",
    "code",
    "devenv",
    "slack",
    "discord",
    "spotify",
    "cargo",
    "rustc",
    "python",
    "python3",
    "ruby",
    "go",
    "java",
    "dotnet",
    "svchost",
    "explorer",
    "services",
    "lsass",
    "csrss",
    "smss",
    "wininit",
    "winlogon",
    "spoolsv",
    "taskhostw",
    "runtimebroker",
    "searchindexer",
    "wsl",
    "wslhost",
    "vmcompute",
    "system"
  ]);
  if (UNRELATED_NAMES.has(name)) {
    return "unrelated";
  }
  if (name && name !== "node" && name !== "bun" && name !== "opencode") {
    return "unrelated";
  }
  return "ambiguous";
}
async function defaultInspectProcessesWin32(pids) {
  const result = /* @__PURE__ */ new Map();
  if (pids.length === 0) return result;
  const validPids = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (validPids.length === 0) return result;
  const filter = validPids.map((p) => `ProcessId = ${p}`).join(" OR ");
  const psCommand = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId, Name, ExecutablePath, CommandLine, @{N="CreationDate"; E={$_.CreationDate.ToString("o")}} | ConvertTo-Json -Compress`;
  try {
    const stdout = await new Promise((resolve2, reject) => {
      execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCommand], { timeout: 6e3, encoding: "utf8" }, (err, out) => {
        if (err) reject(err);
        else resolve2(out);
      });
    });
    const trimmed = stdout.trim();
    if (trimmed) {
      const parsed = JSON.parse(trimmed);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const pid = Number(item.ProcessId);
        if (Number.isInteger(pid)) {
          let creationTime;
          if (item.CreationDate) {
            const parsedDate = Date.parse(item.CreationDate);
            if (Number.isFinite(parsedDate)) creationTime = parsedDate;
          }
          result.set(pid, {
            pid,
            alive: true,
            status: "alive",
            processName: item.Name ?? void 0,
            executable: item.ExecutablePath ?? void 0,
            commandLine: item.CommandLine ?? void 0,
            creationTime
          });
        }
      }
    }
  } catch (err) {
    for (const pid of validPids) {
      if (!result.has(pid)) {
        result.set(pid, { pid, alive: true, status: "unknown", error: err });
      }
    }
    return result;
  }
  for (const pid of validPids) {
    if (!result.has(pid)) {
      result.set(pid, { pid, alive: false, status: "dead" });
    }
  }
  return result;
}
async function defaultInspectProcessesLinux(pids) {
  const result = /* @__PURE__ */ new Map();
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      const [cmdline, exe, dirStat] = await Promise.all([
        fs5.readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => null),
        fs5.readlink(`/proc/${pid}/exe`).catch(() => null),
        fs5.stat(`/proc/${pid}`).catch(() => null)
      ]);
      if (!dirStat) {
        result.set(pid, { pid, alive: false, status: "dead" });
        continue;
      }
      const creationTime = dirStat ? Math.round(dirStat.mtimeMs) : void 0;
      const cmd = cmdline ? cmdline.replace(/\0/g, " ").trim() : void 0;
      const name = exe ? path5.basename(exe) : void 0;
      result.set(pid, {
        pid,
        alive: true,
        status: "alive",
        processName: name,
        executable: exe ?? void 0,
        commandLine: cmd,
        creationTime
      });
    } catch {
      result.set(pid, { pid, alive: true, status: "unknown" });
    }
  }
  return result;
}
async function defaultInspectProcessesUnix(pids) {
  const result = /* @__PURE__ */ new Map();
  if (pids.length === 0) return result;
  const validPids = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (validPids.length === 0) return result;
  try {
    const stdout = await new Promise((resolve2, reject) => {
      execFile("ps", ["-o", "pid=,lstart=,comm=,args=", "-p", validPids.join(",")], { timeout: 4e3 }, (err, out) => {
        if (err && err.code !== 1) reject(err);
        else resolve2(out || "");
      });
    });
    const lines = stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/\s+/);
      const pid = Number(parts[0]);
      if (Number.isInteger(pid)) {
        result.set(pid, { pid, alive: true, status: "alive" });
      }
    }
  } catch {
    for (const pid of validPids) {
      result.set(pid, { pid, alive: true, status: "unknown" });
    }
  }
  return result;
}
async function defaultInspectProcesses(pids) {
  if (process.platform === "win32") {
    return defaultInspectProcessesWin32(pids);
  }
  if (process.platform === "linux") {
    return defaultInspectProcessesLinux(pids);
  }
  return defaultInspectProcessesUnix(pids);
}
async function resolveCurrentProcessStartTime(inspector) {
  const pid = process.pid;
  try {
    const fn = inspector ?? defaultInspectProcesses;
    const map = await fn([pid]);
    const info = map.get(pid);
    if (info && typeof info.creationTime === "number") {
      return info.creationTime;
    }
  } catch {
  }
  return Date.now() - Math.round(process.uptime() * 1e3);
}
var Leases = class {
  store;
  file;
  ownStartTime;
  inspectProcesses;
  isPidAlive;
  constructor(store, options) {
    this.store = store;
    this.file = path5.join(store.dir, "instances", `${process.pid}-${randomUUID5()}.json`);
    this.ownStartTime = options?.ownStartTime;
    this.inspectProcesses = options?.inspectProcesses;
    this.isPidAlive = options?.isPidAlive;
  }
  checkLiveness(pid) {
    if (this.isPidAlive) {
      const res = this.isPidAlive(pid);
      if (res === "dead" || res === false) return { alive: false, status: "dead" };
      if (res === "unknown") return { alive: true, status: "unknown" };
      return { alive: true, status: "alive" };
    }
    if (this.inspectProcesses) {
      return { alive: true, status: "alive" };
    }
    try {
      process.kill(pid, 0);
      return { alive: true, status: "alive" };
    } catch (err) {
      const code = err.code;
      if (code === "ESRCH") {
        return { alive: false, status: "dead" };
      }
      if (code === "EPERM" || code === "EACCES") {
        return { alive: true, status: "unknown" };
      }
      return { alive: true, status: "unknown" };
    }
  }
  async heartbeat(sessionID) {
    if (this.ownStartTime === void 0) {
      this.ownStartTime = await resolveCurrentProcessStartTime(this.inspectProcesses);
    }
    await atomicWrite(
      this.file,
      JSON.stringify({
        pid: process.pid,
        sessionID,
        at: Date.now(),
        startedAt: this.ownStartTime,
        exe: process.execPath
      })
    );
  }
  async read() {
    const active = /* @__PURE__ */ new Set();
    const pids = /* @__PURE__ */ new Set();
    const unknownPids = /* @__PURE__ */ new Set();
    let files;
    try {
      files = await fs5.readdir(path5.dirname(this.file));
    } catch (e) {
      if (e.code === "ENOENT") {
        return { active, pids, unknownPids };
      }
      throw e;
    }
    const leasesByPid = /* @__PURE__ */ new Map();
    for (const name of files.filter((f) => f.endsWith(".json"))) {
      let value;
      try {
        value = JSON.parse(await fs5.readFile(path5.join(path5.dirname(this.file), name), "utf8"));
      } catch {
        continue;
      }
      if (!Number.isInteger(value.pid) || value.pid <= 0) {
        throw new Error("Registro de instancia inv\xE1lido.");
      }
      const list = leasesByPid.get(value.pid) ?? [];
      list.push({
        sessionID: typeof value.sessionID === "string" ? value.sessionID : void 0,
        at: typeof value.at === "number" ? value.at : 0,
        startedAt: typeof value.startedAt === "number" ? value.startedAt : void 0,
        exe: typeof value.exe === "string" ? value.exe : void 0,
        file: name
      });
      leasesByPid.set(value.pid, list);
    }
    if (leasesByPid.size === 0) {
      return { active, pids, unknownPids };
    }
    const alivePids = [];
    for (const pid of leasesByPid.keys()) {
      const liveness = this.checkLiveness(pid);
      if (liveness.status === "dead") {
        continue;
      }
      if (liveness.status === "unknown") {
        unknownPids.add(pid);
        for (const l of leasesByPid.get(pid) ?? []) {
          if (l.sessionID) active.add(l.sessionID);
        }
        continue;
      }
      alivePids.push(pid);
    }
    if (alivePids.length === 0) {
      return { active, pids, unknownPids };
    }
    const inspector = this.inspectProcesses ?? defaultInspectProcesses;
    let procMap;
    try {
      procMap = await inspector(alivePids);
    } catch {
      for (const pid of alivePids) {
        unknownPids.add(pid);
        for (const l of leasesByPid.get(pid) ?? []) {
          if (l.sessionID) active.add(l.sessionID);
        }
      }
      return { active, pids, unknownPids };
    }
    for (const pid of alivePids) {
      const info = procMap.get(pid);
      const leases = leasesByPid.get(pid) ?? [];
      if (!info || info.status === "dead" || !info.alive) {
        continue;
      }
      if (info.status === "unknown") {
        unknownPids.add(pid);
        for (const l of leases) {
          if (l.sessionID) active.add(l.sessionID);
        }
        continue;
      }
      const classification = classifyProcess({
        name: info.processName,
        executablePath: info.executable,
        commandLine: info.commandLine
      });
      if (classification === "unrelated") {
        continue;
      }
      let hasValidMatchingLease = false;
      const validSessionIDs = [];
      for (const lease of leases) {
        if (lease.startedAt !== void 0) {
          if (info.creationTime !== void 0) {
            if (Math.abs(info.creationTime - lease.startedAt) <= 2e3) {
              hasValidMatchingLease = true;
              if (lease.sessionID) validSessionIDs.push(lease.sessionID);
            } else {
            }
          } else {
            unknownPids.add(pid);
            if (lease.sessionID) active.add(lease.sessionID);
          }
        } else {
          hasValidMatchingLease = true;
          if (lease.sessionID) validSessionIDs.push(lease.sessionID);
        }
      }
      if (hasValidMatchingLease) {
        pids.add(pid);
        for (const sid of validSessionIDs) {
          active.add(sid);
        }
      }
    }
    return { active, pids, unknownPids };
  }
  async close() {
    await fs5.rm(this.file, { force: true });
  }
};

// src/ui.tsx
import { memo as _$memo } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createSignal as createSignal2, createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";

// src/ui-controller.ts
import { createSignal } from "solid-js";

// src/helper-client.ts
import { execFile as execFile2, spawn } from "node:child_process";
import { randomUUID as randomUUID6 } from "node:crypto";
import { promisify as promisify2 } from "node:util";
import * as fs6 from "node:fs/promises";
import * as fsSync2 from "node:fs";
import path7 from "node:path";
import { fileURLToPath } from "node:url";

// src/db-path.ts
import * as fsSync from "node:fs";
import path6 from "node:path";
import os2 from "node:os";
function defaultDatabasePath() {
  if (process.env.OPENCODE_DB_PATH) return path6.resolve(process.env.OPENCODE_DB_PATH);
  if (process.env.XDG_DATA_HOME) {
    const xdgPath = path6.join(process.env.XDG_DATA_HOME, "opencode", "opencode.db");
    if (fsSync.existsSync(xdgPath)) return path6.resolve(xdgPath);
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const p1 = path6.join(localAppData, "opencode", "opencode.db");
      if (fsSync.existsSync(p1)) return path6.resolve(p1);
    }
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      const p2 = path6.join(userProfile, ".local", "share", "opencode", "opencode.db");
      if (fsSync.existsSync(p2)) return path6.resolve(p2);
    }
  }
  return path6.resolve(path6.join(os2.homedir(), ".local", "share", "opencode", "opencode.db"));
}

// src/helper-client.ts
var execFileAsync = promisify2(execFile2);
async function verifyNodeCapability(nodeExecutable = "node") {
  try {
    const { stdout } = await execFileAsync(
      nodeExecutable,
      [
        "--input-type=module",
        "-e",
        "import { DatabaseSync } from 'node:sqlite'; if (typeof DatabaseSync !== 'function') process.exit(1); console.log(process.version);"
      ],
      {
        windowsHide: true,
        timeout: 1e4
      }
    );
    const versionMatch = stdout.trim().match(/^v(\d+)\.(\d+)/);
    if (!versionMatch) {
      return {
        ok: false,
        executable: nodeExecutable,
        error: `No se pudo identificar la versi\xF3n de Node.js (${stdout.trim()}).`
      };
    }
    const major = parseInt(versionMatch[1], 10);
    const minor = parseInt(versionMatch[2], 10);
    if (major < 22 || major === 22 && minor < 6) {
      return {
        ok: false,
        version: stdout.trim(),
        executable: nodeExecutable,
        error: `Node.js ${stdout.trim()} detectado. Se requiere Node.js >= 22.6 para operaciones SQLite fuera de l\xEDnea.`
      };
    }
    return {
      ok: true,
      version: stdout.trim(),
      executable: nodeExecutable
    };
  } catch (err) {
    return {
      ok: false,
      executable: nodeExecutable,
      error: `Node.js no disponible o no soporta node:sqlite DatabaseSync (${err instanceof Error ? err.message : String(err)}).`
    };
  }
}
function resolveHelperPath(baseDir) {
  if (process.env.OPENCODE_SESSION_VAULT_HELPER) {
    const override = path7.resolve(process.env.OPENCODE_SESSION_VAULT_HELPER);
    if (fsSync2.existsSync(override)) return override;
  }
  const currentDir = baseDir ?? (() => {
    try {
      return path7.dirname(fileURLToPath(import.meta.url));
    } catch {
      return path7.resolve(".");
    }
  })();
  const candidates = [
    // 1. Packaged inside host distribution (e.g. host/dist/plugins/opencode-session-vault/offline-vault.mjs)
    path7.join(currentDir, "plugins", "opencode-session-vault", "offline-vault.mjs"),
    path7.join(currentDir, "plugins", "opencode-session-vault", "dist", "offline-vault.mjs"),
    // 2. From host root looking into dist or plugins
    path7.join(currentDir, "dist", "plugins", "opencode-session-vault", "offline-vault.mjs"),
    path7.join(currentDir, "..", "dist", "plugins", "opencode-session-vault", "offline-vault.mjs"),
    path7.join(currentDir, "..", "plugins", "opencode-session-vault", "offline-vault.mjs"),
    path7.join(currentDir, "..", "plugins", "opencode-session-vault", "dist", "offline-vault.mjs"),
    path7.join(currentDir, "..", "..", "plugins", "opencode-session-vault", "offline-vault.mjs"),
    path7.join(currentDir, "..", "..", "dist", "plugins", "opencode-session-vault", "offline-vault.mjs"),
    // 3. Directly alongside caller or in dist/ of own package
    path7.join(currentDir, "offline-vault.mjs"),
    path7.join(currentDir, "dist", "offline-vault.mjs"),
    path7.join(currentDir, "..", "dist", "offline-vault.mjs"),
    path7.join(currentDir, "..", "offline-vault.mjs"),
    // 4. In scripts/ in development
    path7.join(currentDir, "..", "scripts", "offline-vault.ts"),
    path7.join(currentDir, "scripts", "offline-vault.ts"),
    path7.join(currentDir, "..", "plugins", "opencode-session-vault", "scripts", "offline-vault.ts")
  ];
  for (const candidate of candidates) {
    const resolved = path7.resolve(candidate);
    if (fsSync2.existsSync(resolved)) {
      return resolved;
    }
  }
  throw new Error(
    `No se encontr\xF3 el ejecutable helper fuera de l\xEDnea ('offline-vault.mjs') en ninguna ruta candidata relativa a '${currentDir}'.`
  );
}
function resolveMonitorPath(baseDir) {
  if (process.env.OPENCODE_SESSION_VAULT_MONITOR) {
    const override = path7.resolve(process.env.OPENCODE_SESSION_VAULT_MONITOR);
    if (fsSync2.existsSync(override)) return override;
  }
  const currentDir = baseDir ?? (() => {
    try {
      return path7.dirname(fileURLToPath(import.meta.url));
    } catch {
      return path7.resolve(".");
    }
  })();
  const candidates = [
    // 1. In scripts/ in development
    path7.join(currentDir, "..", "scripts", "maintenance-monitor.ps1"),
    path7.join(currentDir, "scripts", "maintenance-monitor.ps1"),
    path7.join(currentDir, "..", "plugins", "opencode-session-vault", "scripts", "maintenance-monitor.ps1"),
    // 2. In dist/ or packaged alongside caller
    path7.join(currentDir, "maintenance-monitor.ps1"),
    path7.join(currentDir, "dist", "maintenance-monitor.ps1"),
    path7.join(currentDir, "..", "dist", "maintenance-monitor.ps1"),
    path7.join(currentDir, "..", "maintenance-monitor.ps1"),
    path7.join(currentDir, "plugins", "opencode-session-vault", "maintenance-monitor.ps1"),
    path7.join(currentDir, "plugins", "opencode-session-vault", "dist", "maintenance-monitor.ps1"),
    path7.join(currentDir, "..", "plugins", "opencode-session-vault", "dist", "maintenance-monitor.ps1"),
    path7.join(currentDir, "..", "plugins", "opencode-session-vault", "maintenance-monitor.ps1")
  ];
  for (const candidate of candidates) {
    const resolved = path7.resolve(candidate);
    if (fsSync2.existsSync(resolved)) {
      return resolved;
    }
  }
  throw new Error(
    `No se encontr\xF3 el script de monitor visible ('maintenance-monitor.ps1') en ninguna ruta candidata relativa a '${currentDir}'.`
  );
}
var VaultHelperClient = class {
  nodeExecutable;
  helperPath;
  store;
  monitorScriptPath;
  spawnMonitorOption;
  customMonitorSpawn;
  constructor(options) {
    this.nodeExecutable = options.nodeExecutable ?? "node";
    this.helperPath = options.helperPath ?? resolveHelperPath();
    this.store = options.store;
    this.monitorScriptPath = options.monitorScriptPath;
    this.spawnMonitorOption = options.spawnMonitor;
    this.customMonitorSpawn = options.customMonitorSpawn;
  }
  async verifyCapability() {
    return verifyNodeCapability(this.nodeExecutable);
  }
  /**
   * Returns fast filesystem metadata for database (path, sizeBytes, exists, walSizeBytes) without starting SQLite or spawning child.
   */
  getQuickDiskStats(dbPath) {
    const targetPath = path7.resolve(dbPath ? dbPath : defaultDatabasePath());
    try {
      if (fsSync2.existsSync(targetPath)) {
        const stat3 = fsSync2.statSync(targetPath);
        let walSizeBytes;
        try {
          const walPath = `${targetPath}-wal`;
          if (fsSync2.existsSync(walPath)) {
            walSizeBytes = fsSync2.statSync(walPath).size;
          }
        } catch {
        }
        return { dbPath: targetPath, sizeBytes: stat3.size, exists: true, walSizeBytes };
      }
      return { dbPath: targetPath, sizeBytes: 0, exists: false };
    } catch {
      return { dbPath: targetPath, sizeBytes: 0, exists: false };
    }
  }
  /**
   * Executes inspect in read-only mode via helper. Safe while OpenCode is running.
   */
  async inspectDatabase(dbPath, options) {
    const cap = await this.verifyCapability();
    if (!cap.ok) throw new Error(cap.error);
    const args = [this.helperPath, "inspect", "--json"];
    if (dbPath) args.push("--db", dbPath);
    if (options?.checkIntegrity) args.push("--check-integrity");
    const timeout = options?.timeout ?? 3e4;
    let stdout = "";
    let stderr = "";
    try {
      const res = await execFileAsync(this.nodeExecutable, args, {
        windowsHide: true,
        timeout
      });
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (err) {
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
      if (err.killed || err.code === "ETIMEDOUT" || err.timedOut || err.signal === "SIGTERM") {
        throw new Error(
          `El proceso helper excedi\xF3 el tiempo de espera (${Math.round(timeout / 1e3)}s) al inspeccionar la base de datos.`
        );
      }
      if (stdout) {
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) throw new Error(parsed.error);
        } catch (jsonErr) {
          if (!(jsonErr instanceof SyntaxError)) throw jsonErr;
        }
      }
      const cleanStderr = typeof stderr === "string" ? stderr.trim().split("\n").slice(0, 3).join(" ") : "";
      throw new Error(cleanStderr || err.message || String(err));
    }
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.error) throw new Error(parsed.error);
      return parsed;
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`Salida de inspecci\xF3n no v\xE1lida: ${stdout || stderr}`);
      }
      throw e;
    }
  }
  /**
   * Generates plan in read-only mode via helper with allowRunning. Safe while OpenCode is running.
   */
  async generatePlan(options) {
    const cap = await this.verifyCapability();
    if (!cap.ok) throw new Error(cap.error);
    const args = [
      this.helperPath,
      "plan",
      "--json",
      "--allow-running",
      "--state-dir",
      this.store.dir
    ];
    if (options.dbPath) args.push("--db", options.dbPath);
    if (options.projectID) args.push("--project", options.projectID);
    if (options.max) args.push("--max", String(options.max));
    const timeout = options.timeout ?? 3e4;
    let stdout = "";
    let stderr = "";
    try {
      const res = await execFileAsync(this.nodeExecutable, args, {
        windowsHide: true,
        timeout
      });
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (err) {
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
      if (err.killed || err.code === "ETIMEDOUT" || err.timedOut || err.signal === "SIGTERM") {
        throw new Error(
          `El proceso helper excedi\xF3 el tiempo de espera (${Math.round(timeout / 1e3)}s) al generar el plan de mantenimiento.`
        );
      }
      if (stdout) {
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) throw new Error(parsed.error);
        } catch (jsonErr) {
          if (!(jsonErr instanceof SyntaxError)) throw jsonErr;
        }
      }
      const cleanStderr = typeof stderr === "string" ? stderr.trim().split("\n").slice(0, 3).join(" ") : "";
      throw new Error(cleanStderr || err.message || String(err));
    }
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.error) throw new Error(parsed.error);
      return parsed;
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`Salida de plan no v\xE1lida: ${stdout || stderr}`);
      }
      throw e;
    }
  }
  /**
   * Spawns visible monitor window on Windows and waits for readiness handshake before maintenance is armed.
   * Uses fixed encoded launcher directly without cmd.exe or untrusted shell interpolation.
   * If monitor fails to start or handshake times out, fails closed without arming.
   */
  async spawnMonitor(options) {
    if (process.platform !== "win32" && !options.customSpawn) {
      throw new Error(
        "El monitor visible de mantenimiento requiere un entorno Windows compatible. No se program\xF3 la limpieza."
      );
    }
    if (!options.stateDir || !options.dbPath || !options.ownerPid || !options.armId || !options.expiresAt) {
      throw new Error("Par\xE1metros requeridos ausentes o inv\xE1lidos para spawnMonitor.");
    }
    const monitorPath = options.monitorScriptPath ?? resolveMonitorPath();
    const handshakeFile = path7.join(options.stateDir, `monitor-ready-${options.armId}.json`);
    await fs6.mkdir(options.stateDir, { recursive: true });
    await fs6.rm(handshakeFile, { force: true });
    const monitorArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      monitorPath,
      "-StateDir",
      options.stateDir,
      "-DbPath",
      options.dbPath,
      "-OwnerPid",
      String(options.ownerPid),
      "-ArmId",
      options.armId,
      "-ExpiresAt",
      String(options.expiresAt),
      "-HandshakeFile",
      handshakeFile
    ];
    try {
      if (options.customSpawn) {
        const child = options.customSpawn("powershell.exe", monitorArgs, {
          windowsHide: false,
          stdio: "ignore",
          detached: true
        });
        if (!child?.pid) {
          throw new Error("El sistema operativo no asign\xF3 un PID al monitor de mantenimiento.");
        }
      } else {
        const innerScript = `& ${JSON.stringify(monitorPath)} -StateDir ${JSON.stringify(options.stateDir)} -DbPath ${JSON.stringify(options.dbPath)} -OwnerPid ${options.ownerPid} -ArmId ${JSON.stringify(options.armId)} -ExpiresAt ${options.expiresAt} -HandshakeFile ${JSON.stringify(handshakeFile)}`;
        const innerEncoded = Buffer.from(innerScript, "utf16le").toString("base64");
        const launcherScript = `Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${innerEncoded}"`;
        const launcherEncoded = Buffer.from(launcherScript, "utf16le").toString("base64");
        const child = spawn("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          launcherEncoded
        ], {
          windowsHide: true,
          stdio: "ignore"
        });
        if (!child.pid) {
          throw new Error("El sistema operativo no asign\xF3 un PID al lanzador del monitor.");
        }
      }
    } catch (spawnErr) {
      throw new Error(
        `Fallo al lanzar el monitor visible de mantenimiento: ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}. No se arm\xF3 la limpieza.`
      );
    }
    const timeoutMs = options.timeoutMs ?? 5e3;
    const deadline = Date.now() + timeoutMs;
    const sleep = options.sleepFn ?? ((ms) => new Promise((res) => setTimeout(res, ms)));
    let handshake = null;
    while (Date.now() < deadline) {
      try {
        const raw = await fs6.readFile(handshakeFile, "utf8");
        const cleaned = raw.replace(/^\uFEFF/, "").trim();
        const parsed = JSON.parse(cleaned);
        if (parsed.ready && parsed.armId === options.armId && typeof parsed.monitorPid === "number") {
          handshake = parsed;
          break;
        }
      } catch {
      }
      await sleep(50);
    }
    if (!handshake) {
      try {
        await fs6.rm(handshakeFile, { force: true });
      } catch {
      }
      throw new Error(
        `No se pudo iniciar el monitor visible de mantenimiento: confirmaci\xF3n de inicializaci\xF3n (handshake) no recibida en ${Math.round(
          timeoutMs / 1e3
        )}s. No se arm\xF3 la limpieza.`
      );
    }
    return { monitorPid: handshake.monitorPid, handshakeFile };
  }
  /**
   * Arms a plan for maintenance and spawns helper in background to wait for OpenCode exit.
   * On Windows (or when spawnMonitor is enabled), ensures a visible monitor is launched and ready
   * BEFORE arming the plan. Reports blocking error and fails closed if monitor spawn or handshake fails.
   */
  async armAndSpawn(options) {
    const pendingClaim = await getClaimedPlan(this.store);
    if (pendingClaim) {
      throw new Error(
        "Mantenimiento suspendido: operaci\xF3n interrumpida / exclusi\xF3n no garantizada (se detect\xF3 un plan reclamado previo sin resolver)."
      );
    }
    if (!options._trustedTestExecution) {
      throw new Error(
        "Mantenimiento suspendido: operaci\xF3n interrumpida / exclusi\xF3n no garantizada (coordinaci\xF3n exclusiva de host no disponible en producci\xF3n)."
      );
    }
    const cap = await this.verifyCapability();
    if (!cap.ok) throw new Error(cap.error);
    const armId = options.armId ?? randomUUID6();
    const ttlMs = options.ttlMs ?? 5 * 60 * 1e3;
    const expiresAt = Date.now() + ttlMs;
    let monitorPid = options.monitorPid;
    const shouldSpawnMonitor = options.spawnMonitor ?? (this.spawnMonitorOption !== void 0 ? this.spawnMonitorOption : process.platform === "win32");
    if (shouldSpawnMonitor && !monitorPid) {
      const monitorRes = await this.spawnMonitor({
        stateDir: this.store.dir,
        dbPath: options.plan.canonicalDbPath,
        ownerPid: options.ownerPid,
        armId,
        expiresAt,
        timeoutMs: options.monitorTimeoutMs,
        monitorScriptPath: options.monitorScriptPath ?? this.monitorScriptPath,
        customSpawn: options.customMonitorSpawn ?? this.customMonitorSpawn,
        sleepFn: options.sleepFn
      });
      monitorPid = monitorRes.monitorPid;
    }
    const armed = await armOfflinePlan({
      store: this.store,
      plan: options.plan,
      ownerPid: options.ownerPid,
      ttlMs,
      armId,
      monitorPid,
      _trustedTestExecution: true
    });
    const args = [
      this.helperPath,
      "run-armed",
      "--state-dir",
      this.store.dir,
      "--owner-pid",
      String(options.ownerPid)
    ];
    if (options.skipVacuum) args.push("--skip-vacuum");
    try {
      const child = spawn(this.nodeExecutable, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      if (!child.pid) {
        throw new Error("El sistema operativo no asign\xF3 un PID al proceso helper de mantenimiento.");
      }
      const workerPidFile = path7.join(this.store.dir, `worker-pid-${armId}.json`);
      await fs6.writeFile(
        workerPidFile,
        JSON.stringify({ armId, workerPid: child.pid, timestamp: Date.now() }, null, 2),
        "utf8"
      );
      child.unref();
      return { armed, pid: child.pid, monitorPid };
    } catch (err) {
      try {
        await cancelArmedPlan(this.store);
        const workerPidFile = path7.join(this.store.dir, `worker-pid-${armId}.json`);
        await fs6.rm(workerPidFile, { force: true });
      } catch {
      }
      throw new Error(
        `Fallo al iniciar el proceso de mantenimiento fuera de l\xEDnea: ${err instanceof Error ? err.message : String(err)}. No se arm\xF3 la limpieza.`
      );
    }
  }
  async cancelArmed() {
    try {
      return await cancelArmedPlan(this.store);
    } catch {
      const args = [this.helperPath, "cancel-armed", "--state-dir", this.store.dir];
      const { stdout } = await execFileAsync(this.nodeExecutable, args, { windowsHide: true });
      const parsed = JSON.parse(stdout);
      return Boolean(parsed.cancelled);
    }
  }
  async getArmed() {
    return await getArmedPlan(this.store);
  }
  async getClaimed() {
    return await getClaimedPlan(this.store);
  }
  async inspectClaimed(options) {
    return await inspectClaimedState(this.store, options);
  }
  async getReceipt(clear = false) {
    const receipt = await getReceipt(this.store);
    if (clear && receipt) {
      await clearReceipt(this.store);
    }
    return receipt;
  }
};

// src/ui-controller.ts
var MAINTENANCE_PAGE_SIZE = 6;
function createVaultNavigationController(options) {
  const isMounted = options.isMounted ?? (() => true);
  const helperClient = options.helperClient ?? new VaultHelperClient({ store: options.service.store });
  const [screen, setScreen] = createSignal("list");
  const [plan, setPlan] = createSignal(void 0);
  const [state, setState] = createSignal(void 0);
  const [busy, setBusy] = createSignal(false);
  const [inventoryError, setInventoryError] = createSignal(false);
  const [operationError, setOperationError] = createSignal(false);
  const error = () => inventoryError() || operationError();
  const setError = (val) => {
    setOperationError(val);
    if (!val) setInventoryError(false);
  };
  const [message, setMessage] = createSignal("Leyendo el inventario de OpenCode\u2026");
  const [livePlan, setLivePlan] = createSignal(false);
  const [manualApiAvailable, setManualApiAvailable] = createSignal(false);
  const [manualApiReason, setManualApiReason] = createSignal(void 0);
  const [lastManualResult, setLastManualResult] = createSignal(null);
  const [showLastManualDetail, setShowLastManualDetail] = createSignal(false);
  async function loadLastManualResult() {
    try {
      const outcome = await options.service.store.getLastManualApiOutcome();
      if (isMounted()) {
        setLastManualResult(outcome);
      }
    } catch {
      if (isMounted()) {
        setLastManualResult(null);
      }
    }
  }
  void loadLastManualResult();
  function dismissLastManualResult() {
    setLastManualResult(null);
    setShowLastManualDetail(false);
  }
  function toggleLastManualDetail() {
    setShowLastManualDetail((prev) => !prev);
  }
  const [quickDisk, setQuickDisk] = createSignal(
    void 0
  );
  const [dbInspect, setDbInspect] = createSignal(void 0);
  const [dbStatsLoading, setDbStatsLoading] = createSignal(false);
  const [dbStatsError, setDbStatsError] = createSignal(void 0);
  const [dbStatsReady, setDbStatsReady] = createSignal(false);
  async function loadDbStats(force = false) {
    if (!force && dbStatsReady()) return;
    setDbStatsLoading(true);
    setDbStatsError(void 0);
    try {
      if (typeof helperClient.getQuickDiskStats === "function") {
        const q = helperClient.getQuickDiskStats();
        if (isMounted()) setQuickDisk(q);
      }
      if (typeof helperClient.inspectDatabase === "function") {
        const insp = await helperClient.inspectDatabase(void 0, { timeout: 5e3, checkIntegrity: false });
        if (isMounted()) {
          setDbInspect(insp);
          setDbStatsReady(true);
        }
      }
    } catch (err) {
      if (isMounted()) {
        setDbStatsError(errorText(err));
      }
    } finally {
      if (isMounted()) {
        setDbStatsLoading(false);
      }
    }
  }
  void loadDbStats();
  const [offlinePlan, setOfflinePlan] = createSignal(void 0);
  const [armedPlan, setArmedPlan] = createSignal(void 0);
  const [claimedReport, setClaimedReport] = createSignal(void 0);
  const [receipt, setReceipt] = createSignal(void 0);
  const [maintenanceLoading, setMaintenanceLoading] = createSignal(false);
  const [maintenanceError, setMaintenanceError] = createSignal(void 0);
  const [maintenancePage, setMaintenancePage] = createSignal(0);
  const [maintenanceFocus, setMaintenanceFocus] = createSignal(0);
  const maintenanceTotalPages = () => Math.max(1, Math.ceil((offlinePlan()?.selectedFamilies.length ?? 0) / MAINTENANCE_PAGE_SIZE));
  const maintenancePageStart = () => maintenancePage() * MAINTENANCE_PAGE_SIZE;
  const maintenanceVisibleFamilies = () => (offlinePlan()?.selectedFamilies ?? []).slice(
    maintenancePageStart(),
    maintenancePageStart() + MAINTENANCE_PAGE_SIZE
  );
  function nextMaintenancePage() {
    if (maintenanceLoading() || busy()) return;
    const total = maintenanceTotalPages();
    if (maintenancePage() < total - 1) {
      setMaintenancePage((p) => p + 1);
      setMaintenanceFocus(maintenancePage() * MAINTENANCE_PAGE_SIZE);
    }
  }
  function prevMaintenancePage() {
    if (maintenanceLoading() || busy()) return;
    if (maintenancePage() > 0) {
      setMaintenancePage((p) => p - 1);
      setMaintenanceFocus(maintenancePage() * MAINTENANCE_PAGE_SIZE);
    }
  }
  function setMaintenanceIndex(index) {
    if (maintenanceLoading() || busy()) return;
    const count = offlinePlan()?.selectedFamilies.length ?? 0;
    if (count === 0) return;
    const clamped = Math.max(0, Math.min(count - 1, index));
    setMaintenanceFocus(clamped);
    setMaintenancePage(Math.floor(clamped / MAINTENANCE_PAGE_SIZE));
  }
  let runInFlight = false;
  async function run(action) {
    if (runInFlight || busy()) return;
    runInFlight = true;
    setBusy(true);
    setOperationError(false);
    try {
      await action();
    } catch (e) {
      if (isMounted()) {
        setOperationError(true);
        setMessage(errorText(e));
      }
    } finally {
      runInFlight = false;
      if (isMounted()) {
        setBusy(false);
      }
    }
  }
  async function loadMaintenance() {
    setMaintenanceLoading(true);
    setMaintenanceError(void 0);
    setMaintenancePage(0);
    setMaintenanceFocus(0);
    setMessage("Inspeccionando base de datos y calculando lote de mantenimiento\u2026");
    try {
      const q = helperClient.getQuickDiskStats();
      if (isMounted()) setQuickDisk(q);
      const claimed = typeof helperClient.inspectClaimed === "function" ? await helperClient.inspectClaimed() : null;
      if (isMounted()) setClaimedReport(claimed ?? void 0);
      const r = await helperClient.getReceipt();
      if (isMounted()) setReceipt(r ?? void 0);
      const armed = await helperClient.getArmed();
      if (isMounted()) setArmedPlan(armed ?? void 0);
      const insp = await helperClient.inspectDatabase();
      if (isMounted()) setDbInspect(insp);
      const offPlan = await helperClient.generatePlan({
        projectID: options.service.projectID
      });
      if (isMounted()) {
        setOfflinePlan(offPlan);
        setMaintenancePage(0);
        setMaintenanceFocus(0);
        if (claimed) {
          setMessage("Mantenimiento suspendido: operaci\xF3n interrumpida / exclusi\xF3n no garantizada");
        } else if (!options._trustedTestExecution) {
          setMessage("Mantenimiento suspendido: operaci\xF3n interrumpida / exclusi\xF3n no garantizada");
        } else {
          const count = offPlan.selectedFamilies.length;
          setMessage(
            count > 0 ? `${count} familias candidatas en lote fuera de l\xEDnea. Revisa el lote completo antes de aprobar.` : "0 familias candidatas en mantenimiento fuera de l\xEDnea."
          );
        }
      }
    } catch (err) {
      if (isMounted()) {
        const text = errorText(err);
        setMaintenanceError(text);
        setMessage(text);
        setOfflinePlan(void 0);
      }
    } finally {
      if (isMounted()) {
        setMaintenanceLoading(false);
      }
    }
  }
  async function refresh() {
    const isPreview = screen() === "preview";
    if (isPreview) {
      setLivePlan(false);
    }
    setOperationError(false);
    setInventoryError(false);
    void loadDbStats(true);
    let manualApi = false;
    if (isPreview && options.manualApi) {
      try {
        const avail = await checkManualApiAvailability(options.service.store, {
          helperClient: typeof helperClient.inspectClaimed === "function" ? helperClient : void 0
        });
        setManualApiAvailable(avail.available);
        setManualApiReason(avail.reason);
        manualApi = avail.available;
      } catch (err) {
        setManualApiAvailable(false);
        setManualApiReason(errorText(err));
        manualApi = false;
      }
    } else {
      setManualApiAvailable(false);
      setManualApiReason(void 0);
    }
    try {
      const next = await options.service.preview({
        liveness: isPreview,
        signal: options.signal,
        manualApi
      });
      const settings = await options.service.store.read();
      if (!isMounted()) return;
      setPlan(next);
      setLivePlan(isPreview);
      setState(settings);
      options.onPlanUpdate?.(next);
      setInventoryError(false);
      const unverifiedCount = next.families.filter((f) => f.reasons.includes("Actividad no verificada")).length;
      const unverifiedSuffix = unverifiedCount > 0 ? ` \xB7 ${unverifiedCount} sin verificar protegidas` : "";
      if (isPreview && manualApi) {
        const candidateCount = next.candidates.length;
        setMessage(
          candidateCount > 0 ? `Lote por API: ${candidateCount} ${candidateCount === 1 ? "familia candidata" : "familias candidatas"} (m\xE1x. 5). Borrado seguro con respaldo.${unverifiedSuffix}` : `0 familias candidatas en este lote por API.${unverifiedSuffix}`
        );
      } else {
        setMessage(`${next.candidates.length} familias candidatas${unverifiedSuffix}. El candado siempre tiene prioridad.`);
      }
    } catch (err) {
      if (isMounted()) {
        setInventoryError(true);
        setMessage(errorText(err));
      }
      throw err;
    }
  }
  void (async () => {
    try {
      const pendingReceipt = await helperClient.getReceipt();
      if (pendingReceipt && isMounted()) {
        setReceipt(pendingReceipt);
        if (pendingReceipt.status === "success") {
          setMessage(`Mantenimiento previo: ${pendingReceipt.deletedFamilies.length} familias eliminadas.`);
        }
      }
      const activeArmed = await helperClient.getArmed();
      if (activeArmed && isMounted()) {
        setArmedPlan(activeArmed);
      }
    } catch {
    }
  })();
  function go(next) {
    if (next !== "preview") {
      setLivePlan(false);
    }
    setScreen(next);
    options.onNavigate?.(next);
    if (next === "maintenance") {
      void loadMaintenance();
    } else if (next === "list" && plan()) {
      const p = plan();
      const unverifiedCount = p.families.filter((f) => f.reasons.includes("Actividad no verificada")).length;
      const unverifiedSuffix = unverifiedCount > 0 ? ` \xB7 ${unverifiedCount} sin verificar protegidas` : "";
      setMessage(`${p.candidates.length} familias candidatas${unverifiedSuffix}. El candado siempre tiene prioridad.`);
    }
  }
  async function openPreview() {
    if (busy() && screen() === "preview") return;
    if (busy()) {
      go("preview");
      setPlan(void 0);
      setLivePlan(false);
      await refresh();
    } else {
      await run(async () => {
        go("preview");
        setPlan(void 0);
        setLivePlan(false);
        await refresh();
      });
    }
  }
  function isApprovedPlanValid(approved) {
    if (screen() !== "preview") return false;
    if (!livePlan()) return false;
    if (!manualApiAvailable()) return false;
    const currentPlan = plan();
    if (!currentPlan || !approved || currentPlan !== approved) return false;
    return approved.candidates.length > 0 && approved.candidates.length <= 5;
  }
  function canClean() {
    if (busy() || error()) return false;
    return isApprovedPlanValid(plan());
  }
  function clean() {
    if (!canClean()) return;
    const approved = plan();
    if (!approved || !approved.candidates.length) return;
    const count = approved.candidates.length;
    const ask = options.askConfirmation;
    if (!ask) return;
    let executed = false;
    ask(
      `Borrar por API ${count} ${count === 1 ? "familia" : "familias"} con respaldo previo`,
      "Escribe LIMPIAR",
      async (value) => {
        if (value !== "LIMPIAR") {
          throw new Error("Escribe LIMPIAR para confirmar.");
        }
        if (executed) {
          return;
        }
        if (!isApprovedPlanValid(approved)) {
          options.closeConfirmation?.();
          setPlan(void 0);
          setLivePlan(false);
          throw new Error("La vista previa no es v\xE1lida o est\xE1 desactualizada.");
        }
        executed = true;
        try {
          const metricsBackend = typeof helperClient.getQuickDiskStats === "function" ? { getDiskStats: () => helperClient.getQuickDiskStats() } : void 0;
          const result = await options.service.cleanup(approved, false, { manualApi: true, metricsBackend });
          options.closeConfirmation?.();
          const outcome = {
            operationId: result.operationId,
            timestamp: result.timestamp ?? Date.now(),
            status: result.status ?? (result.error ? result.deleted.length > 0 ? "partial" : "failed" : "success"),
            deletedFamiliesCount: result.deletedFamiliesCount ?? result.deleted.length,
            deletedSessionsCount: result.deletedSessionsCount,
            targetFamiliesCount: result.targetFamiliesCount,
            targetSessionsCount: result.targetSessionsCount,
            backupVerified: result.backupVerified,
            uncertainDescendants: result.uncertainDescendants,
            error: result.error,
            archivesCount: result.archives.length,
            dbSizeBytesBefore: result.dbSizeBytesBefore,
            dbSizeBytesAfter: result.dbSizeBytesAfter,
            dbSizeDeltaBytes: result.dbSizeDeltaBytes,
            walSizeBytesBefore: result.walSizeBytesBefore,
            walSizeBytesAfter: result.walSizeBytesAfter
          };
          setLastManualResult(outcome);
          await refresh();
          go("list");
          setMessage(
            `${result.deleted.length} familias eliminadas por API \xB7 ${result.skipped.length} omitidas${result.error ? ` \xB7 ${result.error}` : " \xB7 respaldos guardados"}`
          );
          setOperationError(Boolean(result.error));
        } catch (err) {
          options.closeConfirmation?.();
          try {
            const outcome = await options.service.store.getLastManualApiOutcome();
            if (isMounted() && outcome) {
              setLastManualResult(outcome);
            }
          } catch {
          }
          setLivePlan(false);
          setOperationError(true);
          throw err;
        }
      },
      "Borrado seguro mediante API oficial de OpenCode. El tama\xF1o del archivo SQLite en disco no se reduce sin compactaci\xF3n fuera de l\xEDnea (VACUUM)."
    );
  }
  function canArmMaintenance() {
    if (!options._trustedTestExecution) return false;
    if (Boolean(claimedReport())) return false;
    if (maintenanceLoading() || busy() || Boolean(maintenanceError())) return false;
    if (Boolean(armedPlan())) return false;
    const currentOfflinePlan = offlinePlan();
    return Boolean(currentOfflinePlan && currentOfflinePlan.selectedFamilies.length > 0);
  }
  function armMaintenance() {
    if (!options._trustedTestExecution) {
      setMessage("Mantenimiento suspendido: operaci\xF3n interrumpida / exclusi\xF3n no garantizada");
      return;
    }
    if (!canArmMaintenance()) {
      if (claimedReport()) {
        setMessage("Mantenimiento suspendido: operaci\xF3n interrumpida / exclusi\xF3n no garantizada");
      }
      return;
    }
    const currentOfflinePlan = offlinePlan();
    if (!currentOfflinePlan || currentOfflinePlan.selectedFamilies.length === 0) {
      setMessage("No hay familias candidatas para armar mantenimiento.");
      return;
    }
    const ask = options.askConfirmation;
    if (!ask) return;
    const count = currentOfflinePlan.selectedFamilies.length;
    ask(
      `Armar mantenimiento para ${count} familias tras cerrar OpenCode`,
      "Escribe LIMPIAR",
      async (value) => {
        if (value !== "LIMPIAR") throw new Error("Escribe LIMPIAR para confirmar el armado.");
        if (offlinePlan() !== currentOfflinePlan) {
          throw new Error("El plan de mantenimiento cambi\xF3 o fue invalidado. Revisa el nuevo lote.");
        }
        const result = await helperClient.armAndSpawn({
          plan: currentOfflinePlan,
          ownerPid: process.pid,
          ttlMs: 5 * 60 * 1e3,
          _trustedTestExecution: true
        });
        setArmedPlan(result.armed);
        setMessage(
          "Monitor visible activo. Cierra todas las instancias de OpenCode en <5m. El monitor indicar\xE1 cu\xE1ndo volver a abrirlo."
        );
      },
      "Se abrir\xE1 una ventana de monitorizaci\xF3n visible. Tras confirmar, cierra OpenCode en <5m. El monitor indicar\xE1 cu\xE1ndo es seguro volver a abrirlo."
    );
  }
  async function cancelMaintenance() {
    await helperClient.cancelArmed();
    setArmedPlan(void 0);
    setMessage("Mantenimiento en espera cancelado. No se realizar\xE1n cambios.");
    await loadMaintenance();
  }
  async function dismissReceipt() {
    await helperClient.getReceipt(true);
    setReceipt(void 0);
    setMessage("Aviso de recibo descartado.");
  }
  return {
    screen,
    setScreen,
    plan,
    setPlan,
    state,
    setState,
    busy,
    setBusy,
    error,
    setError,
    inventoryError,
    setInventoryError,
    operationError,
    setOperationError,
    message,
    setMessage,
    livePlan,
    setLivePlan,
    canClean,
    run,
    refresh,
    openPreview,
    clean,
    go,
    // Offline maintenance additions
    quickDisk,
    setQuickDisk,
    dbInspect,
    setDbInspect,
    offlinePlan,
    setOfflinePlan,
    armedPlan,
    setArmedPlan,
    claimedReport,
    setClaimedReport,
    receipt,
    setReceipt,
    maintenanceLoading,
    maintenanceError,
    setMaintenanceError,
    maintenancePage,
    setMaintenancePage,
    maintenanceFocus,
    setMaintenanceFocus,
    maintenanceTotalPages,
    maintenancePageStart,
    maintenanceVisibleFamilies,
    nextMaintenancePage,
    prevMaintenancePage,
    setMaintenanceIndex,
    loadMaintenance,
    canArmMaintenance,
    armMaintenance,
    cancelMaintenance,
    dismissReceipt,
    helperClient,
    loadDbStats,
    dbStatsLoading,
    dbStatsError,
    dbStatsReady,
    manualApiAvailable,
    setManualApiAvailable,
    manualApiReason,
    lastManualResult,
    setLastManualResult,
    showLastManualDetail,
    setShowLastManualDetail,
    dismissLastManualResult,
    toggleLastManualDetail,
    loadLastManualResult
  };
}

// src/ui.tsx
var COLOR = {
  bg: "#0B111B",
  panel: "#111E2E",
  line: "#284967",
  blue: "#5FAFFF",
  cyan: "#63E6E2",
  text: "#E1EDFA",
  muted: "#91A8C1",
  green: "#72DEA8",
  red: "#FF8799",
  amber: "#F4CB80",
  selected: "#17334D"
};
var bytesLabel = (n) => formatBytes(n);
var dateLabel = (n) => new Date(n).toLocaleString("es", {
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});
function Button(props) {
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$setProp(_el$, "paddingLeft", 1);
    _$setProp(_el$, "paddingRight", 1);
    _$setProp(_el$, "height", 1);
    _$setProp(_el$, "flexShrink", 0);
    _$setProp(_el$, "onMouseDown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      props.action();
    });
    _$setProp(_el$2, "height", 1);
    _$setProp(_el$2, "truncate", true);
    _$insert(_el$2, () => props.label);
    _$effect((_p$) => {
      var _v$ = props.selected ? COLOR.selected : COLOR.panel, _v$2 = props.danger ? COLOR.red : COLOR.blue;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "backgroundColor", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "fg", _v$2, _p$.t));
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$;
  })();
}
function Keycap(props) {
  return (() => {
    var _el$3 = _$createElement("box"), _el$4 = _$createElement("box"), _el$5 = _$createElement("text"), _el$6 = _$createElement("box"), _el$7 = _$createElement("text");
    _$insertNode(_el$3, _el$4);
    _$insertNode(_el$3, _el$6);
    _$setProp(_el$3, "flexDirection", "row");
    _$setProp(_el$3, "gap", 0);
    _$setProp(_el$3, "flexShrink", 0);
    _$setProp(_el$3, "height", 1);
    _$insertNode(_el$4, _el$5);
    _$setProp(_el$4, "backgroundColor", "#17334D");
    _$setProp(_el$4, "paddingLeft", 1);
    _$setProp(_el$4, "paddingRight", 1);
    _$setProp(_el$4, "height", 1);
    _$setProp(_el$5, "attributes", 1);
    _$insert(_el$5, () => props.keyText);
    _$insertNode(_el$6, _el$7);
    _$setProp(_el$6, "paddingLeft", 1);
    _$setProp(_el$6, "paddingRight", 1);
    _$setProp(_el$6, "height", 1);
    _$insert(_el$7, () => props.label);
    _$effect((_p$) => {
      var _v$3 = props.highlight ? COLOR.amber : COLOR.cyan, _v$4 = COLOR.text;
      _v$3 !== _p$.e && (_p$.e = _$setProp(_el$5, "fg", _v$3, _p$.e));
      _v$4 !== _p$.t && (_p$.t = _$setProp(_el$7, "fg", _v$4, _p$.t));
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$3;
  })();
}
function Metric(props) {
  return (() => {
    var _el$8 = _$createElement("box"), _el$9 = _$createElement("text"), _el$0 = _$createElement("text");
    _$insertNode(_el$8, _el$9);
    _$insertNode(_el$8, _el$0);
    _$setProp(_el$8, "flexDirection", "column");
    _$setProp(_el$8, "flexGrow", 1);
    _$setProp(_el$8, "paddingLeft", 1);
    _$setProp(_el$8, "borderStyle", "single");
    _$setProp(_el$8, "onMouseDown", (e) => {
      if (props.action && e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        props.action();
      }
    });
    _$setProp(_el$9, "attributes", 1);
    _$insert(_el$9, () => props.value);
    _$insert(_el$0, () => props.label);
    _$effect((_p$) => {
      var _v$5 = COLOR.line, _v$6 = props.color || COLOR.text, _v$7 = COLOR.muted;
      _v$5 !== _p$.e && (_p$.e = _$setProp(_el$8, "borderColor", _v$5, _p$.e));
      _v$6 !== _p$.t && (_p$.t = _$setProp(_el$9, "fg", _v$6, _p$.t));
      _v$7 !== _p$.a && (_p$.a = _$setProp(_el$0, "fg", _v$7, _p$.a));
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    return _el$8;
  })();
}
function VaultApp(props) {
  const dimensions = useTerminalDimensions();
  let mounted = true;
  const abortController = new AbortController();
  const [query, setQuery] = createSignal2("");
  const [searching, setSearching] = createSignal2(false);
  const [focus, setFocus] = createSignal2(0);
  const [entry, setEntry] = createSignal2();
  const [draft, setDraft] = createSignal2("");
  const [archives, setArchives] = createSignal2([]);
  const [sizes, setSizes] = createSignal2({});
  const [detail, setDetail] = createSignal2();
  function ask(title, placeholder, action, description) {
    setDraft("");
    setEntry({
      title,
      placeholder,
      action,
      description
    });
  }
  const controller = createVaultNavigationController({
    service: props.service,
    manualApi: true,
    signal: abortController.signal,
    isMounted: () => mounted,
    onClose: props.onClose,
    askConfirmation: ask,
    closeConfirmation: () => setEntry(void 0),
    helperClient: props.helperClient,
    onPlanUpdate: (next) => {
      setFocus((i) => Math.min(i, Math.max(0, next.families.length - 1)));
    },
    onNavigate: () => {
      setFocus(0);
      setQuery("");
      setSearching(false);
      setEntry(void 0);
    }
  });
  const {
    screen,
    plan,
    state,
    busy,
    error,
    setError,
    inventoryError,
    operationError,
    message,
    setMessage,
    livePlan,
    canClean,
    run,
    refresh,
    openPreview,
    clean,
    go,
    quickDisk,
    dbInspect,
    offlinePlan,
    armedPlan,
    claimedReport,
    receipt,
    maintenanceLoading,
    maintenanceError,
    maintenancePage,
    setMaintenancePage,
    maintenanceFocus,
    setMaintenanceFocus,
    maintenanceTotalPages,
    maintenancePageStart,
    maintenanceVisibleFamilies,
    nextMaintenancePage,
    prevMaintenancePage,
    setMaintenanceIndex,
    loadMaintenance,
    armMaintenance,
    cancelMaintenance,
    dismissReceipt,
    manualApiAvailable,
    manualApiReason,
    lastManualResult,
    showLastManualDetail,
    dismissLastManualResult,
    toggleLastManualDetail,
    dbStatsLoading,
    dbStatsError
  } = controller;
  const compact = () => dimensions().width < 100;
  const showMetrics = () => dimensions().height >= 38;
  const isMaintenance = () => screen() === "maintenance";
  const bannerHeight = () => {
    if (!lastManualResult() || screen() !== "list" && screen() !== "preview") return 0;
    return showLastManualDetail() ? 7 : 4;
  };
  const dbSizeDisplay = () => {
    if (dbInspect()?.sizeBytes !== void 0) {
      return formatBytes(dbInspect().sizeBytes);
    }
    if (quickDisk()?.exists && quickDisk()?.sizeBytes !== void 0) {
      return formatBytes(quickDisk().sizeBytes);
    }
    if (dbStatsLoading()) return "Detectando\u2026";
    return "No disponible";
  };
  const walDisplay = () => {
    const wal = quickDisk()?.walSizeBytes;
    if (wal && wal > 0) {
      return ` (+${formatBytes(wal)} WAL)`;
    }
    return "";
  };
  const freeSpaceDisplay = () => {
    if (dbInspect()?.freeBytes !== void 0) {
      return formatBytes(dbInspect().freeBytes);
    }
    if (dbStatsLoading()) return "Calculando\u2026";
    return "No disponible";
  };
  const backupCostDisplay = () => {
    const total = archives().reduce((acc, a) => acc + a.files.reduce((n, f) => n + f.compressed, 0), 0);
    return formatBytes(total);
  };
  const metricsFamilies = () => {
    if (isMaintenance()) {
      if (maintenanceLoading() || maintenanceError() || !offlinePlan()) return "\u2014";
      return String(offlinePlan().totalFamilies);
    }
    return plan() ? String(plan().families.length) : "\u2014";
  };
  const metricsLocked = () => {
    if (isMaintenance()) {
      if (maintenanceLoading() || maintenanceError() || !offlinePlan()) return "\u2014";
      return String(offlinePlan().statePins.length);
    }
    return plan() ? String(plan().locked) : "\u2014";
  };
  const metricsQuota = () => {
    if (isMaintenance()) {
      if (maintenanceLoading() || maintenanceError() || !offlinePlan()) return "\u2014";
      return String(offlinePlan().quota.keep);
    }
    return plan() ? String(plan().quota.keep) : "\u2014";
  };
  const metricsCandidates = () => {
    if (isMaintenance()) {
      if (maintenanceLoading() || maintenanceError() || !offlinePlan()) return "\u2014";
      return String(offlinePlan().selectedFamilies.length);
    }
    return plan() ? String(plan().candidates.length) : "\u2014";
  };
  const pageSize = () => Math.max(2, Math.min(14, dimensions().height - (showMetrics() ? 29 : 26) - (screen() === "preview" ? 3 : 0) - bannerHeight()));
  const contentHeight = () => Math.max(3, dimensions().height - (showMetrics() ? 26 : isMaintenance() ? 23 : 20));
  const rows = createMemo(() => (screen() === "preview" ? plan()?.candidates ?? [] : plan()?.families ?? []).filter((f) => `${f.root.title} ${f.root.id} ${f.root.directory}`.toLowerCase().includes(query().toLowerCase())));
  const pageStart = () => Math.floor(Math.min(focus(), Math.max(0, rows().length - 1)) / pageSize()) * pageSize();
  const visible = () => rows().slice(pageStart(), pageStart() + pageSize());
  const selected = () => rows()[focus()];
  const selectedPinned = (f) => f.members.some((s) => state()?.pins.includes(s.id));
  const back = () => {
    if (busy()) return;
    if (entry()) {
      setEntry(void 0);
      setDraft("");
    } else if (searching()) setSearching(false);
    else if (screen() !== "list") go("list");
    else props.onClose();
  };
  onMount(() => {
    void run(refresh);
    void listBackups(props.service.store).then(setArchives).catch(() => {
    });
    const off = props.api.keymap?.registerLayer({
      priority: 2e3,
      mode: "modal",
      bindings: [{
        key: "escape",
        cmd: () => {
          back();
          return true;
        }
      }]
    });
    if (off) onCleanup(off);
  });
  onCleanup(() => {
    abortController.abort();
    mounted = false;
  });
  async function submitEntry() {
    const e = entry();
    if (!e) return;
    await e.action(draft());
    setEntry(void 0);
  }
  async function setProfile(profile, percent) {
    await props.service.configure({
      profile,
      ...percent !== void 0 ? {
        percent
      } : {}
    }, true);
    await refresh();
    go("list");
  }
  function chooseProfile(profile) {
    if (profile === "mod") ask("Porcentaje a conservar", "N\xFAmero entero entre 1 y 100", async (value) => {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new Error("Escribe un n\xFAmero entero de 1 a 100.");
      await setProfile(profile, Number(value));
    });
    else void run(() => setProfile(profile));
  }
  function togglePin(f = selected()) {
    if (!f) return;
    void run(async () => {
      if (selectedPinned(f) && !state()?.pins.includes(f.root.id)) throw new Error("El candado pertenece a una hija. Abre sus detalles para quitar ese candado.");
      await props.service.pin(f.root.id);
      await refresh();
    });
  }
  async function viewDetail(f = selected()) {
    if (!f) return;
    setDetail(f);
    go("detail");
    setMessage("Calculando tama\xF1o l\xF3gico de la conversaci\xF3n\u2026");
    let bytes = 0;
    for (const member of f.members) bytes += Buffer.byteLength(JSON.stringify(await props.service.gateway.exportSession(member, {
      signal: abortController.signal
    })));
    setSizes((previous) => ({
      ...previous,
      [f.root.id]: {
        fingerprint: familyFingerprint(f),
        bytes
      }
    }));
    setMessage("Tama\xF1o del JSON exportable. No equivale al espacio recuperable del archivo SQLite.");
  }
  function setting(action) {
    const c = state()?.config;
    if (!c) return;
    if (action === "a") {
      if (c.automatic) void run(async () => {
        await props.service.configure({
          automatic: false
        });
        await refresh();
      });
      else ask("Activar limpieza autom\xE1tica", "Escribe ACTIVAR", async (value) => {
        if (value !== "ACTIVAR") throw new Error("Escribe ACTIVAR para confirmar.");
        await props.service.configure({
          automatic: true
        });
        await refresh();
        setMessage("Autom\xE1tico activo mientras OpenCode est\xE9 abierto y este panel cerrado. Usa una sola instancia de OpenCode.");
      });
    } else if (action === "s") void run(async () => {
      await props.service.configure({
        scope: c.scope === "global" ? "project" : "global"
      });
      await refresh();
    });
    else if (action === "h") void run(async () => {
      await props.service.configure({
        includeArchived: !c.includeArchived
      });
      await refresh();
    });
    else if (["t", "i", "b"].includes(action)) {
      const fields = {
        t: ["Horas m\xEDnimas sin actividad", "graceHours", 1, 8760],
        i: ["Intervalo en minutos", "intervalMinutes", 5, 10080],
        b: ["M\xE1ximo de familias por limpieza", "maxDeletePerRun", 1, 100]
      };
      const [title, field, min, max] = fields[action];
      ask(title, `${min} a ${max}`, async (value) => {
        const n = Number(value);
        if (!/^\d+$/.test(value) || n < min || n > max) throw new Error(`Escribe un entero de ${min} a ${max}.`);
        await props.service.configure({
          [field]: n
        });
        await refresh();
      });
    } else if (action === "r") ask("Recalcular cupo sobre las familias actuales", "Escribe RECALCULAR", async (value) => {
      if (value !== "RECALCULAR") throw new Error("Escribe RECALCULAR para confirmar.");
      await props.service.configure({}, true);
      await refresh();
    });
  }
  async function openBackups() {
    setArchives(await listBackups(props.service.store));
    go("backups");
  }
  useKeyboard((key) => {
    if (key.name === "escape") {
      key.preventDefault();
      key.stopPropagation();
      back();
      return;
    }
    if (busy() || screen() === "maintenance" && maintenanceLoading()) {
      key.preventDefault();
      key.stopPropagation();
      return;
    }
    if (entry() || searching()) return;
    let handled = true;
    const name = key.name.toLowerCase();
    if (name === "q") props.onClose();
    else if (name === "g") go("settings");
    else if (name === "p") go("profiles");
    else if (name === "m") go("maintenance");
    else if (screen() === "settings") setting(name);
    else if (screen() === "profiles" && /^[1-5]$/.test(name)) chooseProfile(Object.keys(PROFILES)[Number(name) - 1]);
    else if (screen() === "maintenance") {
      if (name === "a" && !armedPlan()) armMaintenance();
      else if (name === "c" && armedPlan()) void run(cancelMaintenance);
      else if (name === "r") void run(loadMaintenance);
      else if (name === "x" && receipt()) void dismissReceipt();
      else if (["up", "k"].includes(name)) setMaintenanceIndex(maintenanceFocus() - 1);
      else if (["down", "j"].includes(name)) setMaintenanceIndex(maintenanceFocus() + 1);
      else if (["left", "h", "pageup"].includes(name)) prevMaintenancePage();
      else if (["right", "l", "pagedown"].includes(name)) nextMaintenancePage();
      else if (name === "home") setMaintenanceIndex(0);
      else if (name === "end") setMaintenanceIndex((offlinePlan()?.selectedFamilies.length ?? 1) - 1);
      else handled = false;
    } else if (["list", "preview"].includes(screen())) {
      if (["up", "k", "down", "j", "pageup", "pagedown", "home", "end"].includes(name)) {
        const delta = ["up", "k"].includes(name) ? -1 : ["down", "j"].includes(name) ? 1 : name === "pageup" ? -pageSize() : pageSize();
        setFocus((i) => name === "home" ? 0 : name === "end" ? Math.max(0, rows().length - 1) : Math.max(0, Math.min(rows().length - 1, i + delta)));
      } else if (name === "space" || name === "l") togglePin();
      else if (name === "/") setSearching(true);
      else if (name === "r") void run(refresh);
      else if (name === "i" || name === "return" && screen() === "list") void run(() => viewDetail());
      else if (name === "v") void openPreview();
      else if (name === "b") void run(openBackups);
      else if (name === "c" && screen() === "preview" && canClean()) clean();
      else if (name === "u" && lastManualResult()) toggleLastManualDetail();
      else if (name === "x" && lastManualResult()) dismissLastManualResult();
      else handled = false;
    } else handled = false;
    if (handled) {
      key.preventDefault();
      key.stopPropagation();
    }
  });
  const size = (f) => {
    const value = sizes()[f.root.id];
    return value?.fingerprint === familyFingerprint(f) ? bytesLabel(value.bytes) : "\u2014";
  };
  const rowColor = (f) => selectedPinned(f) ? COLOR.green : f.reasons.length ? COLOR.text : COLOR.red;
  return (() => {
    var _el$1 = _$createElement("box"), _el$10 = _$createElement("box"), _el$11 = _$createElement("text"), _el$13 = _$createElement("text"), _el$14 = _$createTextNode(`BASE DE DATOS DE OPENCODE \xB7 `), _el$33 = _$createElement("box"), _el$34 = _$createElement("box"), _el$35 = _$createElement("box"), _el$36 = _$createElement("text"), _el$37 = _$createTextNode(` \xB7 v0.1.0`), _el$38 = _$createElement("box"), _el$47 = _$createElement("text");
    _$insertNode(_el$1, _el$10);
    _$insertNode(_el$1, _el$13);
    _$insertNode(_el$1, _el$33);
    _$insertNode(_el$1, _el$47);
    _$setProp(_el$1, "flexDirection", "column");
    _$setProp(_el$1, "borderStyle", "rounded");
    _$setProp(_el$1, "paddingLeft", 1);
    _$setProp(_el$1, "paddingRight", 1);
    _$setProp(_el$1, "width", "100%");
    _$insertNode(_el$10, _el$11);
    _$setProp(_el$10, "flexDirection", "row");
    _$setProp(_el$10, "justifyContent", "space-between");
    _$setProp(_el$10, "paddingTop", 1);
    _$setProp(_el$10, "height", 2);
    _$setProp(_el$10, "flexShrink", 0);
    _$insertNode(_el$11, _$createTextNode(`SESSION VAULT`));
    _$setProp(_el$11, "attributes", 1);
    _$insert(_el$10, _$createComponent(Button, {
      label: "[g] \u2699 Configuraci\xF3n",
      action: () => go("settings")
    }), null);
    _$insertNode(_el$13, _el$14);
    _$setProp(_el$13, "height", 1);
    _$setProp(_el$13, "flexShrink", 0);
    _$setProp(_el$13, "truncate", true);
    _$insert(_el$13, (() => {
      var _c$ = _$memo(() => screen() === "list");
      return () => _c$() ? "Tus sesiones, bajo control" : {
        settings: "Configuraci\xF3n",
        profiles: "Perfiles de retenci\xF3n",
        preview: "Vista previa del borrado",
        backups: "Respaldos locales",
        detail: "Detalle de la familia",
        maintenance: "Mantenimiento y disco"
      }[screen()];
    })(), null);
    _$insert(_el$1, _$createComponent(Show, {
      get when() {
        return showMetrics();
      },
      get fallback() {
        return (() => {
          var _el$48 = _$createElement("text"), _el$49 = _$createTextNode(`Familias `), _el$50 = _$createTextNode(` \xB7 Candados `), _el$51 = _$createTextNode(` \xB7 Cupo `), _el$52 = _$createTextNode(` \xB7 Candidatas `);
          _$insertNode(_el$48, _el$49);
          _$insertNode(_el$48, _el$50);
          _$insertNode(_el$48, _el$51);
          _$insertNode(_el$48, _el$52);
          _$setProp(_el$48, "height", 1);
          _$setProp(_el$48, "flexShrink", 0);
          _$insert(_el$48, metricsFamilies, _el$50);
          _$insert(_el$48, metricsLocked, _el$51);
          _$insert(_el$48, metricsQuota, _el$52);
          _$insert(_el$48, metricsCandidates, null);
          _$effect((_$p) => _$setProp(_el$48, "fg", COLOR.cyan, _$p));
          return _el$48;
        })();
      },
      get children() {
        var _el$15 = _$createElement("box");
        _$setProp(_el$15, "flexDirection", "row");
        _$setProp(_el$15, "gap", 1);
        _$setProp(_el$15, "marginTop", 1);
        _$setProp(_el$15, "height", 4);
        _$setProp(_el$15, "flexShrink", 0);
        _$insert(_el$15, _$createComponent(Metric, {
          get value() {
            return metricsFamilies();
          },
          label: "Familias"
        }), null);
        _$insert(_el$15, _$createComponent(Metric, {
          get value() {
            return metricsLocked();
          },
          label: "Candados",
          get color() {
            return COLOR.green;
          }
        }), null);
        _$insert(_el$15, _$createComponent(Metric, {
          get value() {
            return metricsQuota();
          },
          label: "Cupo",
          get color() {
            return COLOR.cyan;
          }
        }), null);
        _$insert(_el$15, _$createComponent(Metric, {
          get value() {
            return metricsCandidates();
          },
          label: "Candidatas",
          get color() {
            return COLOR.red;
          },
          get action() {
            return isMaintenance() ? void 0 : () => void openPreview();
          }
        }), null);
        return _el$15;
      }
    }), _el$33);
    _$insert(_el$1, _$createComponent(Show, {
      get when() {
        return screen() === "list";
      },
      get children() {
        var _el$16 = _$createElement("box"), _el$17 = _$createElement("box"), _el$18 = _$createElement("text"), _el$19 = _$createTextNode(`Base de datos: `), _el$20 = _$createElement("text"), _el$22 = _$createElement("text"), _el$23 = _$createTextNode(`Reutilizable: `);
        _$insertNode(_el$16, _el$17);
        _$setProp(_el$16, "flexDirection", "row");
        _$setProp(_el$16, "height", 1);
        _$setProp(_el$16, "flexShrink", 0);
        _$setProp(_el$16, "justifyContent", "space-between");
        _$setProp(_el$16, "paddingLeft", 1);
        _$setProp(_el$16, "paddingRight", 1);
        _$setProp(_el$16, "marginTop", 1);
        _$insertNode(_el$17, _el$18);
        _$insertNode(_el$17, _el$20);
        _$insertNode(_el$17, _el$22);
        _$setProp(_el$17, "flexDirection", "row");
        _$setProp(_el$17, "gap", 1);
        _$setProp(_el$17, "flexShrink", 0);
        _$insertNode(_el$18, _el$19);
        _$setProp(_el$18, "attributes", 1);
        _$insert(_el$18, dbSizeDisplay, null);
        _$insert(_el$18, walDisplay, null);
        _$insertNode(_el$20, _$createTextNode(`\xB7`));
        _$insertNode(_el$22, _el$23);
        _$insert(_el$22, freeSpaceDisplay, null);
        _$insert(_el$16, _$createComponent(Show, {
          get when() {
            return !compact();
          },
          get children() {
            var _el$24 = _$createElement("text"), _el$25 = _$createTextNode(`Respaldos Vault: `);
            _$insertNode(_el$24, _el$25);
            _$setProp(_el$24, "truncate", true);
            _$insert(_el$24, backupCostDisplay, null);
            _$effect((_$p) => _$setProp(_el$24, "fg", COLOR.muted, _$p));
            return _el$24;
          }
        }), null);
        _$effect((_p$) => {
          var _v$8 = COLOR.panel, _v$9 = COLOR.cyan, _v$0 = COLOR.muted, _v$1 = COLOR.text;
          _v$8 !== _p$.e && (_p$.e = _$setProp(_el$16, "backgroundColor", _v$8, _p$.e));
          _v$9 !== _p$.t && (_p$.t = _$setProp(_el$18, "fg", _v$9, _p$.t));
          _v$0 !== _p$.a && (_p$.a = _$setProp(_el$20, "fg", _v$0, _p$.a));
          _v$1 !== _p$.o && (_p$.o = _$setProp(_el$22, "fg", _v$1, _p$.o));
          return _p$;
        }, {
          e: void 0,
          t: void 0,
          a: void 0,
          o: void 0
        });
        return _el$16;
      }
    }), _el$33);
    _$insert(_el$1, _$createComponent(Show, {
      get when() {
        return entry();
      },
      get fallback() {
        return [_$createComponent(Show, {
          get when() {
            return screen() === "list" || screen() === "preview";
          },
          get children() {
            return [_$createComponent(Show, {
              get when() {
                return screen() === "preview";
              },
              get children() {
                return [(() => {
                  var _el$53 = _$createElement("text");
                  _$setProp(_el$53, "height", 1);
                  _$setProp(_el$53, "flexShrink", 0);
                  _$setProp(_el$53, "truncate", true);
                  _$insert(_el$53, () => manualApiAvailable() ? "Lote por API: hasta 5 familias, primero las m\xE1s antiguas. Respaldo verificado antes de borrar." : "Limpieza manual: suspendida mientras haya tareas fuera de l\xEDnea o estado no verificado.");
                  _$effect((_$p) => _$setProp(_el$53, "fg", COLOR.amber, _$p));
                  return _el$53;
                })(), (() => {
                  var _el$54 = _$createElement("text");
                  _$insertNode(_el$54, _$createTextNode(`Aviso de almacenamiento: El tama\xF1o de la base SQLite en disco no se reduce sin compactaci\xF3n fuera de l\xEDnea (VACUUM).`));
                  _$setProp(_el$54, "height", 1);
                  _$setProp(_el$54, "flexShrink", 0);
                  _$setProp(_el$54, "truncate", true);
                  _$effect((_$p) => _$setProp(_el$54, "fg", COLOR.muted, _$p));
                  return _el$54;
                })(), _$createComponent(Button, {
                  label: "[m] Ir a Mantenimiento fuera de l\xEDnea (sin CLI)",
                  action: () => go("maintenance"),
                  selected: true
                })];
              }
            }), _$createComponent(Show, {
              get when() {
                return lastManualResult();
              },
              get children() {
                var _el$56 = _$createElement("box"), _el$57 = _$createElement("box"), _el$58 = _$createElement("text"), _el$59 = _$createTextNode(`\xDALTIMA OPERACI\xD3N POR API \xB7 `), _el$60 = _$createElement("box"), _el$61 = _$createElement("box"), _el$62 = _$createElement("text"), _el$63 = _$createTextNode(` `), _el$64 = _$createTextNode(` (`), _el$65 = _$createTextNode(`) \xB7 `), _el$66 = _$createElement("text");
                _$insertNode(_el$56, _el$57);
                _$insertNode(_el$56, _el$61);
                _$setProp(_el$56, "flexDirection", "column");
                _$setProp(_el$56, "borderStyle", "single");
                _$setProp(_el$56, "paddingLeft", 1);
                _$setProp(_el$56, "paddingRight", 1);
                _$setProp(_el$56, "marginTop", 1);
                _$setProp(_el$56, "flexShrink", 0);
                _$insertNode(_el$57, _el$58);
                _$insertNode(_el$57, _el$60);
                _$setProp(_el$57, "flexDirection", "row");
                _$setProp(_el$57, "justifyContent", "space-between");
                _$setProp(_el$57, "height", 1);
                _$setProp(_el$57, "flexShrink", 0);
                _$insertNode(_el$58, _el$59);
                _$setProp(_el$58, "attributes", 1);
                _$insert(_el$58, (() => {
                  var _c$2 = _$memo(() => lastManualResult()?.status === "success");
                  return () => _c$2() ? "\u2714 \xC9XITO" : lastManualResult()?.status === "partial" ? "\u26A0 PARCIAL" : "\u274C FALLIDO";
                })(), null);
                _$setProp(_el$60, "flexDirection", "row");
                _$setProp(_el$60, "gap", 1);
                _$insert(_el$60, _$createComponent(Button, {
                  get label() {
                    return showLastManualDetail() ? "[u] Menos" : "[u] Detalle";
                  },
                  action: toggleLastManualDetail
                }), null);
                _$insert(_el$60, _$createComponent(Button, {
                  label: "[x] Ocultar",
                  action: dismissLastManualResult
                }), null);
                _$insertNode(_el$61, _el$62);
                _$insertNode(_el$61, _el$66);
                _$setProp(_el$61, "flexDirection", "row");
                _$setProp(_el$61, "justifyContent", "space-between");
                _$setProp(_el$61, "height", 1);
                _$setProp(_el$61, "flexShrink", 0);
                _$insertNode(_el$62, _el$63);
                _$insertNode(_el$62, _el$64);
                _$insertNode(_el$62, _el$65);
                _$setProp(_el$62, "truncate", true);
                _$insert(_el$62, () => lastManualResult()?.deletedFamiliesCount, _el$63);
                _$insert(_el$62, () => lastManualResult()?.deletedFamiliesCount === 1 ? "familia" : "familias", _el$64);
                _$insert(_el$62, (() => {
                  var _c$3 = _$memo(() => lastManualResult()?.deletedSessionsCount !== void 0);
                  return () => _c$3() ? `${lastManualResult()?.deletedSessionsCount} sesiones` : "sesiones: no disponible";
                })(), _el$65);
                _$insert(_el$62, () => dateLabel(lastManualResult()?.timestamp ?? 0), null);
                _$setProp(_el$66, "truncate", true);
                _$insert(_el$66, () => lastManualResult()?.backupVerified ? "Respaldos verificados (SHA-256)" : "Verificaci\xF3n no registrada");
                _$insert(_el$56, _$createComponent(Show, {
                  get when() {
                    return lastManualResult()?.dbSizeDeltaBytes !== void 0;
                  },
                  get children() {
                    var _el$67 = _$createElement("box"), _el$68 = _$createElement("text"), _el$69 = _$createTextNode(`Variaci\xF3n observada: `);
                    _$insertNode(_el$67, _el$68);
                    _$setProp(_el$67, "flexDirection", "row");
                    _$setProp(_el$67, "height", 1);
                    _$setProp(_el$67, "flexShrink", 0);
                    _$setProp(_el$67, "marginTop", 0);
                    _$insertNode(_el$68, _el$69);
                    _$setProp(_el$68, "truncate", true);
                    _$insert(_el$68, () => formatDeltaBytes(lastManualResult().dbSizeDeltaBytes), null);
                    _$effect((_$p) => _$setProp(_el$68, "fg", COLOR.cyan, _$p));
                    return _el$67;
                  }
                }), null);
                _$insert(_el$56, _$createComponent(Show, {
                  get when() {
                    return showLastManualDetail();
                  },
                  get children() {
                    var _el$70 = _$createElement("box");
                    _$setProp(_el$70, "flexDirection", "column");
                    _$setProp(_el$70, "marginTop", 1);
                    _$setProp(_el$70, "gap", 0);
                    _$setProp(_el$70, "flexShrink", 0);
                    _$insert(_el$70, _$createComponent(Show, {
                      get when() {
                        return lastManualResult()?.operationId;
                      },
                      get children() {
                        var _el$71 = _$createElement("text"), _el$72 = _$createTextNode(`Operaci\xF3n: `);
                        _$insertNode(_el$71, _el$72);
                        _$insert(_el$71, () => safeText(lastManualResult()?.operationId?.slice(0, 24)), null);
                        _$effect((_$p) => _$setProp(_el$71, "fg", COLOR.muted, _$p));
                        return _el$71;
                      }
                    }), null);
                    _$insert(_el$70, _$createComponent(Show, {
                      get when() {
                        return lastManualResult()?.targetFamiliesCount !== void 0;
                      },
                      get children() {
                        var _el$73 = _$createElement("text"), _el$74 = _$createTextNode(`Lote solicitado: `), _el$75 = _$createTextNode(` familias (`), _el$76 = _$createTextNode(`)`);
                        _$insertNode(_el$73, _el$74);
                        _$insertNode(_el$73, _el$75);
                        _$insertNode(_el$73, _el$76);
                        _$insert(_el$73, () => lastManualResult()?.targetFamiliesCount, _el$75);
                        _$insert(_el$73, (() => {
                          var _c$4 = _$memo(() => lastManualResult()?.targetSessionsCount !== void 0);
                          return () => _c$4() ? `${lastManualResult()?.targetSessionsCount} sesiones` : "sesiones: no disponible";
                        })(), _el$76);
                        _$effect((_$p) => _$setProp(_el$73, "fg", COLOR.text, _$p));
                        return _el$73;
                      }
                    }), null);
                    _$insert(_el$70, _$createComponent(Show, {
                      get when() {
                        return (lastManualResult()?.archivesCount ?? 0) > 0;
                      },
                      get children() {
                        var _el$77 = _$createElement("text"), _el$78 = _$createTextNode(`Respaldos guardados: `);
                        _$insertNode(_el$77, _el$78);
                        _$insert(_el$77, () => lastManualResult()?.archivesCount, null);
                        _$effect((_$p) => _$setProp(_el$77, "fg", COLOR.text, _$p));
                        return _el$77;
                      }
                    }), null);
                    _$insert(_el$70, _$createComponent(Show, {
                      get when() {
                        return _$memo(() => lastManualResult()?.dbSizeBytesBefore !== void 0)() && lastManualResult()?.dbSizeBytesAfter !== void 0;
                      },
                      get children() {
                        return [(() => {
                          var _el$79 = _$createElement("text"), _el$80 = _$createTextNode(`Archivo en disco: `), _el$81 = _$createTextNode(` \u2192 `), _el$82 = _$createTextNode(` (variaci\xF3n neta: `), _el$83 = _$createTextNode(`)`);
                          _$insertNode(_el$79, _el$80);
                          _$insertNode(_el$79, _el$81);
                          _$insertNode(_el$79, _el$82);
                          _$insertNode(_el$79, _el$83);
                          _$insert(_el$79, () => bytesLabel(lastManualResult().dbSizeBytesBefore), _el$81);
                          _$insert(_el$79, () => bytesLabel(lastManualResult().dbSizeBytesAfter), _el$82);
                          _$insert(_el$79, () => formatDeltaBytes(lastManualResult().dbSizeDeltaBytes), _el$83);
                          _$effect((_$p) => _$setProp(_el$79, "fg", COLOR.text, _$p));
                          return _el$79;
                        })(), (() => {
                          var _el$84 = _$createElement("text");
                          _$insertNode(_el$84, _$createTextNode(`Medici\xF3n f\xEDsica neta de archivo. Variaci\xF3n observada sin atribuci\xF3n causal (OpenCode escribe concurrentemente).`));
                          _$effect((_$p) => _$setProp(_el$84, "fg", COLOR.muted, _$p));
                          return _el$84;
                        })()];
                      }
                    }), null);
                    _$insert(_el$70, _$createComponent(Show, {
                      get when() {
                        return lastManualResult()?.uncertainDescendants;
                      },
                      get children() {
                        var _el$86 = _$createElement("text");
                        _$insertNode(_el$86, _$createTextNode(`Aviso: Resultado en descendientes incierto por error de API OpenCode.`));
                        _$effect((_$p) => _$setProp(_el$86, "fg", COLOR.amber, _$p));
                        return _el$86;
                      }
                    }), null);
                    _$insert(_el$70, _$createComponent(Show, {
                      get when() {
                        return lastManualResult()?.error;
                      },
                      get children() {
                        var _el$88 = _$createElement("text"), _el$89 = _$createTextNode(`Error: `);
                        _$insertNode(_el$88, _el$89);
                        _$setProp(_el$88, "wrapMode", "word");
                        _$insert(_el$88, () => safeText(lastManualResult()?.error), null);
                        _$effect((_$p) => _$setProp(_el$88, "fg", COLOR.red, _$p));
                        return _el$88;
                      }
                    }), null);
                    return _el$70;
                  }
                }), null);
                _$effect((_p$) => {
                  var _v$20 = lastManualResult()?.status === "success" ? COLOR.green : lastManualResult()?.status === "partial" ? COLOR.amber : COLOR.red, _v$21 = lastManualResult()?.status === "success" ? COLOR.green : lastManualResult()?.status === "partial" ? COLOR.amber : COLOR.red, _v$22 = COLOR.text, _v$23 = COLOR.muted;
                  _v$20 !== _p$.e && (_p$.e = _$setProp(_el$56, "borderColor", _v$20, _p$.e));
                  _v$21 !== _p$.t && (_p$.t = _$setProp(_el$58, "fg", _v$21, _p$.t));
                  _v$22 !== _p$.a && (_p$.a = _$setProp(_el$62, "fg", _v$22, _p$.a));
                  _v$23 !== _p$.o && (_p$.o = _$setProp(_el$66, "fg", _v$23, _p$.o));
                  return _p$;
                }, {
                  e: void 0,
                  t: void 0,
                  a: void 0,
                  o: void 0
                });
                return _el$56;
              }
            }), (() => {
              var _el$90 = _$createElement("box"), _el$91 = _$createElement("input");
              _$insertNode(_el$90, _el$91);
              _$setProp(_el$90, "marginTop", 1);
              _$setProp(_el$90, "borderStyle", "single");
              _$setProp(_el$90, "height", 3);
              _$setProp(_el$90, "flexShrink", 0);
              _$setProp(_el$91, "placeholder", "[/] Buscar t\xEDtulo, ID o proyecto\u2026");
              _$setProp(_el$91, "onInput", (v) => {
                setQuery(v);
                setFocus(0);
              });
              _$setProp(_el$91, "onSubmit", () => setSearching(false));
              _$setProp(_el$91, "onMouseDown", () => setSearching(true));
              _$effect((_p$) => {
                var _v$24 = searching() ? COLOR.cyan : COLOR.line, _v$25 = searching(), _v$26 = query();
                _v$24 !== _p$.e && (_p$.e = _$setProp(_el$90, "borderColor", _v$24, _p$.e));
                _v$25 !== _p$.t && (_p$.t = _$setProp(_el$91, "focused", _v$25, _p$.t));
                _v$26 !== _p$.a && (_p$.a = _$setProp(_el$91, "value", _v$26, _p$.a));
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0
              });
              return _el$90;
            })(), (() => {
              var _el$92 = _$createElement("box"), _el$93 = _$createElement("text"), _el$97 = _$createElement("text"), _el$99 = _$createElement("text");
              _$insertNode(_el$92, _el$93);
              _$insertNode(_el$92, _el$97);
              _$insertNode(_el$92, _el$99);
              _$setProp(_el$92, "flexDirection", "row");
              _$setProp(_el$92, "height", 1);
              _$setProp(_el$92, "flexShrink", 0);
              _$setProp(_el$92, "paddingLeft", 1);
              _$setProp(_el$92, "paddingRight", 1);
              _$insertNode(_el$93, _$createTextNode(`LOCK`));
              _$setProp(_el$93, "width", 7);
              _$insert(_el$92, _$createComponent(Show, {
                get when() {
                  return !compact();
                },
                get children() {
                  var _el$95 = _$createElement("text");
                  _$insertNode(_el$95, _$createTextNode(`ID`));
                  _$setProp(_el$95, "width", 12);
                  _$effect((_$p) => _$setProp(_el$95, "fg", COLOR.muted, _$p));
                  return _el$95;
                }
              }), _el$97);
              _$insertNode(_el$97, _$createTextNode(`SESI\xD3N / PROYECTO`));
              _$setProp(_el$97, "flexGrow", 1);
              _$insertNode(_el$99, _$createTextNode(`\xDALTIMA ACTIVIDAD`));
              _$setProp(_el$99, "width", 18);
              _$insert(_el$92, _$createComponent(Show, {
                get when() {
                  return !compact();
                },
                get children() {
                  var _el$101 = _$createElement("text");
                  _$insertNode(_el$101, _$createTextNode(`JSON \u2248`));
                  _$setProp(_el$101, "width", 10);
                  _$effect((_$p) => _$setProp(_el$101, "fg", COLOR.muted, _$p));
                  return _el$101;
                }
              }), null);
              _$effect((_p$) => {
                var _v$27 = COLOR.panel, _v$28 = COLOR.muted, _v$29 = COLOR.muted, _v$30 = COLOR.muted;
                _v$27 !== _p$.e && (_p$.e = _$setProp(_el$92, "backgroundColor", _v$27, _p$.e));
                _v$28 !== _p$.t && (_p$.t = _$setProp(_el$93, "fg", _v$28, _p$.t));
                _v$29 !== _p$.a && (_p$.a = _$setProp(_el$97, "fg", _v$29, _p$.a));
                _v$30 !== _p$.o && (_p$.o = _$setProp(_el$99, "fg", _v$30, _p$.o));
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0,
                o: void 0
              });
              return _el$92;
            })(), (() => {
              var _el$103 = _$createElement("box");
              _$setProp(_el$103, "flexDirection", "column");
              _$setProp(_el$103, "flexShrink", 0);
              _$setProp(_el$103, "onMouseScroll", (e) => {
                setFocus((i) => Math.max(0, Math.min(rows().length - 1, i + (e.scroll?.direction === "up" ? -1 : 1))));
              });
              _$insert(_el$103, _$createComponent(For, {
                get each() {
                  return visible();
                },
                children: (f, index) => (() => {
                  var _el$213 = _$createElement("box"), _el$214 = _$createElement("box"), _el$215 = _$createElement("text"), _el$217 = _$createElement("text"), _el$218 = _$createElement("text");
                  _$insertNode(_el$213, _el$214);
                  _$insertNode(_el$213, _el$217);
                  _$insertNode(_el$213, _el$218);
                  _$setProp(_el$213, "flexDirection", "row");
                  _$setProp(_el$213, "height", 1);
                  _$setProp(_el$213, "paddingLeft", 1);
                  _$setProp(_el$213, "paddingRight", 1);
                  _$setProp(_el$213, "onMouseDown", (e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    setFocus(pageStart() + index());
                  });
                  _$insertNode(_el$214, _el$215);
                  _$setProp(_el$214, "width", 7);
                  _$setProp(_el$214, "onMouseDown", (e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    togglePin(f);
                  });
                  _$insert(_el$215, () => selectedPinned(f) ? "\u25CF LOCK" : "\u25CB");
                  _$insert(_el$213, _$createComponent(Show, {
                    get when() {
                      return !compact();
                    },
                    get children() {
                      var _el$216 = _$createElement("text");
                      _$setProp(_el$216, "width", 12);
                      _$insert(_el$216, () => f.root.id.slice(-10));
                      _$effect((_$p) => _$setProp(_el$216, "fg", COLOR.muted, _$p));
                      return _el$216;
                    }
                  }), _el$217);
                  _$setProp(_el$217, "flexGrow", 1);
                  _$setProp(_el$217, "flexShrink", 1);
                  _$setProp(_el$217, "truncate", true);
                  _$insert(_el$217, () => safeText(f.root.title), null);
                  _$insert(_el$217, (() => {
                    var _c$10 = _$memo(() => f.members.length > 1);
                    return () => _c$10() ? ` (+${f.members.length - 1})` : "";
                  })(), null);
                  _$setProp(_el$218, "width", 18);
                  _$insert(_el$218, () => dateLabel(f.updated));
                  _$insert(_el$213, _$createComponent(Show, {
                    get when() {
                      return !compact();
                    },
                    get children() {
                      var _el$219 = _$createElement("text");
                      _$setProp(_el$219, "width", 10);
                      _$insert(_el$219, () => size(f));
                      _$effect((_$p) => _$setProp(_el$219, "fg", COLOR.muted, _$p));
                      return _el$219;
                    }
                  }), null);
                  _$effect((_p$) => {
                    var _v$74 = focus() === pageStart() + index() ? COLOR.selected : COLOR.bg, _v$75 = rowColor(f), _v$76 = rowColor(f), _v$77 = rowColor(f);
                    _v$74 !== _p$.e && (_p$.e = _$setProp(_el$213, "backgroundColor", _v$74, _p$.e));
                    _v$75 !== _p$.t && (_p$.t = _$setProp(_el$215, "fg", _v$75, _p$.t));
                    _v$76 !== _p$.a && (_p$.a = _$setProp(_el$217, "fg", _v$76, _p$.a));
                    _v$77 !== _p$.o && (_p$.o = _$setProp(_el$218, "fg", _v$77, _p$.o));
                    return _p$;
                  }, {
                    e: void 0,
                    t: void 0,
                    a: void 0,
                    o: void 0
                  });
                  return _el$213;
                })()
              }), null);
              _$insert(_el$103, _$createComponent(Show, {
                get when() {
                  return !rows().length;
                },
                get children() {
                  var _el$104 = _$createElement("text");
                  _$insert(_el$104, () => emptyInventoryMessage({
                    busy: busy(),
                    error: inventoryError(),
                    hasPlan: Boolean(plan())
                  }));
                  _$effect((_$p) => _$setProp(_el$104, "fg", COLOR.muted, _$p));
                  return _el$104;
                }
              }), null);
              _$effect((_$p) => _$setProp(_el$103, "height", pageSize(), _$p));
              return _el$103;
            })(), (() => {
              var _el$105 = _$createElement("box"), _el$106 = _$createElement("text"), _el$107 = _$createElement("text");
              _$insertNode(_el$105, _el$106);
              _$insertNode(_el$105, _el$107);
              _$setProp(_el$105, "flexDirection", "row");
              _$setProp(_el$105, "height", 1);
              _$setProp(_el$105, "flexShrink", 0);
              _$setProp(_el$105, "justifyContent", "space-between");
              _$insert(_el$106, () => inventoryCountLabel({
                count: rows().length,
                pageStart: pageStart(),
                pageSize: pageSize(),
                busy: busy(),
                error: inventoryError(),
                hasPlan: Boolean(plan())
              }));
              _$insert(_el$107, () => selected()?.reasons.join(" \xB7 ") || (selected() ? "Candidata a limpieza" : ""));
              _$effect((_p$) => {
                var _v$31 = COLOR.panel, _v$32 = COLOR.muted, _v$33 = selected() && !selected().reasons.length ? COLOR.red : COLOR.green;
                _v$31 !== _p$.e && (_p$.e = _$setProp(_el$105, "backgroundColor", _v$31, _p$.e));
                _v$32 !== _p$.t && (_p$.t = _$setProp(_el$106, "fg", _v$32, _p$.t));
                _v$33 !== _p$.a && (_p$.a = _$setProp(_el$107, "fg", _v$33, _p$.a));
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0
              });
              return _el$105;
            })(), (() => {
              var _el$108 = _$createElement("text");
              _$setProp(_el$108, "height", 1);
              _$setProp(_el$108, "flexShrink", 0);
              _$setProp(_el$108, "truncate", true);
              _$insert(_el$108, () => safeText(selected()?.root.directory));
              _$effect((_$p) => _$setProp(_el$108, "fg", COLOR.muted, _$p));
              return _el$108;
            })()];
          }
        }), _$createComponent(Show, {
          get when() {
            return screen() === "profiles";
          },
          get children() {
            var _el$109 = _$createElement("scrollbox"), _el$110 = _$createElement("box"), _el$111 = _$createElement("text"), _el$113 = _$createElement("text");
            _$insertNode(_el$109, _el$110);
            _$setProp(_el$109, "flexShrink", 0);
            _$setProp(_el$109, "marginTop", 1);
            _$insertNode(_el$110, _el$111);
            _$insertNode(_el$110, _el$113);
            _$setProp(_el$110, "flexDirection", "column");
            _$setProp(_el$110, "gap", 1);
            _$insert(_el$110, _$createComponent(For, {
              get each() {
                return Object.entries(PROFILES);
              },
              children: ([id, profile], i) => _$createComponent(Button, {
                get label() {
                  return `[${i() + 1}] ${profile.label}${state()?.config.profile === id ? "  \u2713 ACTUAL" : ""}`;
                },
                action: () => chooseProfile(id),
                get selected() {
                  return state()?.config.profile === id;
                }
              })
            }), _el$111);
            _$insertNode(_el$111, _$createTextNode(`El porcentaje establece un cupo fijo sobre familias sin candado.`));
            _$insertNode(_el$113, _$createTextNode(`Se redondea hacia arriba. M\xEDnimo: 1. Los candados se conservan adem\xE1s del cupo.`));
            _$effect((_p$) => {
              var _v$34 = contentHeight(), _v$35 = COLOR.muted, _v$36 = COLOR.muted;
              _v$34 !== _p$.e && (_p$.e = _$setProp(_el$109, "height", _v$34, _p$.e));
              _v$35 !== _p$.t && (_p$.t = _$setProp(_el$111, "fg", _v$35, _p$.t));
              _v$36 !== _p$.a && (_p$.a = _$setProp(_el$113, "fg", _v$36, _p$.a));
              return _p$;
            }, {
              e: void 0,
              t: void 0,
              a: void 0
            });
            return _el$109;
          }
        }), _$createComponent(Show, {
          get when() {
            return screen() === "settings";
          },
          get children() {
            var _el$115 = _$createElement("scrollbox"), _el$116 = _$createElement("box"), _el$117 = _$createElement("text"), _el$119 = _$createElement("text");
            _$insertNode(_el$115, _el$116);
            _$setProp(_el$115, "flexShrink", 0);
            _$setProp(_el$115, "marginTop", 1);
            _$insertNode(_el$116, _el$117);
            _$insertNode(_el$116, _el$119);
            _$setProp(_el$116, "flexDirection", "column");
            _$setProp(_el$116, "gap", 1);
            _$insert(_el$116, _$createComponent(Button, {
              get label() {
                return `[a] Autom\xE1tico: ${state()?.config.automatic ? "ACTIVO" : "PAUSADO"}`;
              },
              action: () => setting("a")
            }), _el$117);
            _$insert(_el$116, _$createComponent(Button, {
              get label() {
                return `[s] Alcance de limpieza: ${state()?.config.scope === "global" ? "Global (todos los proyectos)" : "Proyecto actual"}`;
              },
              action: () => setting("s")
            }), _el$117);
            _$insert(_el$116, _$createComponent(Button, {
              get label() {
                return `[t] Conservar actividad de las \xFAltimas ${state()?.config.graceHours} horas`;
              },
              action: () => setting("t")
            }), _el$117);
            _$insert(_el$116, _$createComponent(Button, {
              get label() {
                return `[i] Revisar cada ${state()?.config.intervalMinutes} minutos`;
              },
              action: () => setting("i")
            }), _el$117);
            _$insert(_el$116, _$createComponent(Button, {
              get label() {
                return `[b] M\xE1ximo ${state()?.config.maxDeletePerRun} familias por limpieza`;
              },
              action: () => setting("b")
            }), _el$117);
            _$insert(_el$116, _$createComponent(Button, {
              get label() {
                return `[h] Aplicar reglas a archivadas: ${state()?.config.includeArchived ? "S\xED" : "No"}`;
              },
              action: () => setting("h")
            }), _el$117);
            _$insert(_el$116, _$createComponent(Button, {
              label: "[r] Recalcular cupo porcentual",
              action: () => setting("r")
            }), _el$117);
            _$insert(_el$116, _$createComponent(Button, {
              label: "[m] Mantenimiento y compactaci\xF3n fuera de l\xEDnea",
              action: () => go("maintenance")
            }), _el$117);
            _$insertNode(_el$117, _$createTextNode(`Autom\xE1tico: usa una sola instancia de OpenCode. Respalda conversaciones antes de borrar.`));
            _$insertNode(_el$119, _$createTextNode(`La sesi\xF3n abierta, las que trabajan y aquellas con actividad no verificada quedan protegidas.`));
            _$effect((_p$) => {
              var _v$37 = contentHeight(), _v$38 = COLOR.amber, _v$39 = COLOR.muted;
              _v$37 !== _p$.e && (_p$.e = _$setProp(_el$115, "height", _v$37, _p$.e));
              _v$38 !== _p$.t && (_p$.t = _$setProp(_el$117, "fg", _v$38, _p$.t));
              _v$39 !== _p$.a && (_p$.a = _$setProp(_el$119, "fg", _v$39, _p$.a));
              return _p$;
            }, {
              e: void 0,
              t: void 0,
              a: void 0
            });
            return _el$115;
          }
        }), _$createComponent(Show, {
          get when() {
            return screen() === "backups";
          },
          get children() {
            return [(() => {
              var _el$121 = _$createElement("scrollbox");
              _$insert(_el$121, _$createComponent(For, {
                get each() {
                  return archives();
                },
                children: (a) => (() => {
                  var _el$220 = _$createElement("box"), _el$221 = _$createElement("text"), _el$222 = _$createTextNode(` \xB7 `), _el$223 = _$createTextNode(` \xB7 `), _el$224 = _$createElement("text"), _el$225 = _$createTextNode(` \xB7 `), _el$226 = _$createTextNode(` \xB7 `), _el$227 = _$createTextNode(` sesiones`);
                  _$insertNode(_el$220, _el$221);
                  _$insertNode(_el$220, _el$224);
                  _$setProp(_el$220, "flexDirection", "column");
                  _$setProp(_el$220, "marginBottom", 1);
                  _$insertNode(_el$221, _el$222);
                  _$insertNode(_el$221, _el$223);
                  _$insert(_el$221, () => dateLabel(a.created), _el$222);
                  _$insert(_el$221, () => safeText(a.title), _el$223);
                  _$insert(_el$221, () => bytesLabel(a.files.reduce((n, f) => n + f.compressed, 0)), null);
                  _$insertNode(_el$224, _el$225);
                  _$insertNode(_el$224, _el$226);
                  _$insertNode(_el$224, _el$227);
                  _$insert(_el$224, () => a.id, _el$225);
                  _$insert(_el$224, () => a.status, _el$226);
                  _$insert(_el$224, () => a.files.length, _el$227);
                  _$effect((_p$) => {
                    var _v$78 = COLOR.cyan, _v$79 = COLOR.muted;
                    _v$78 !== _p$.e && (_p$.e = _$setProp(_el$221, "fg", _v$78, _p$.e));
                    _v$79 !== _p$.t && (_p$.t = _$setProp(_el$224, "fg", _v$79, _p$.t));
                    return _p$;
                  }, {
                    e: void 0,
                    t: void 0
                  });
                  return _el$220;
                })()
              }), null);
              _$insert(_el$121, _$createComponent(Show, {
                get when() {
                  return !archives().length;
                },
                get children() {
                  var _el$122 = _$createElement("text");
                  _$insertNode(_el$122, _$createTextNode(`Todav\xEDa no hay respaldos.`));
                  _$effect((_$p) => _$setProp(_el$122, "fg", COLOR.muted, _$p));
                  return _el$122;
                }
              }), null);
              _$effect((_$p) => _$setProp(_el$121, "height", Math.max(5, dimensions().height - 23), _$p));
              return _el$121;
            })(), (() => {
              var _el$124 = _$createElement("text");
              _$insertNode(_el$124, _$createTextNode(`Recupera el chat con RESTAURAR y el ID del respaldo. Los archivos externos y eventos internos no se restauran.`));
              _$effect((_$p) => _$setProp(_el$124, "fg", COLOR.amber, _$p));
              return _el$124;
            })(), (() => {
              var _el$126 = _$createElement("text");
              _$setProp(_el$126, "wrapMode", "word");
              _$insert(_el$126, () => safeText(props.service.store.dir));
              _$effect((_$p) => _$setProp(_el$126, "fg", COLOR.muted, _$p));
              return _el$126;
            })()];
          }
        }), _$createComponent(Show, {
          get when() {
            return screen() === "maintenance";
          },
          get children() {
            var _el$127 = _$createElement("scrollbox"), _el$128 = _$createElement("box"), _el$157 = _$createElement("box"), _el$158 = _$createElement("text"), _el$160 = _$createElement("text"), _el$161 = _$createTextNode(`Base de datos SQLite: `), _el$162 = _$createElement("text"), _el$163 = _$createTextNode(`Tama\xF1o en disco: `), _el$164 = _$createTextNode(` \xB7 P\xE1ginas libres: `), _el$165 = _$createElement("text"), _el$166 = _$createTextNode(`Sesiones registradas en SQLite: `), _el$167 = _$createTextNode(` \xB7 Integridad: `), _el$168 = _$createElement("text"), _el$169 = _$createTextNode(`Respaldos archivados en Vault: `), _el$170 = _$createTextNode(` (`), _el$171 = _$createTextNode(`)`), _el$172 = _$createElement("box"), _el$173 = _$createElement("text");
            _$insertNode(_el$127, _el$128);
            _$setProp(_el$127, "flexShrink", 0);
            _$setProp(_el$127, "marginTop", 1);
            _$insertNode(_el$128, _el$157);
            _$insertNode(_el$128, _el$172);
            _$setProp(_el$128, "flexDirection", "column");
            _$setProp(_el$128, "gap", 1);
            _$insert(_el$128, _$createComponent(Show, {
              get when() {
                return receipt();
              },
              get children() {
                var _el$129 = _$createElement("box"), _el$130 = _$createElement("text"), _el$131 = _$createElement("text");
                _$insertNode(_el$129, _el$130);
                _$insertNode(_el$129, _el$131);
                _$setProp(_el$129, "flexDirection", "column");
                _$setProp(_el$129, "padding", 1);
                _$setProp(_el$129, "borderStyle", "single");
                _$setProp(_el$130, "attributes", 1);
                _$insert(_el$130, (() => {
                  var _c$5 = _$memo(() => receipt()?.status === "success");
                  return () => _c$5() ? "\u2714 \xDALTIMO MANTENIMIENTO: \xC9XITO" : receipt()?.status === "partial_success" ? "\u26A0 \xDALTIMO MANTENIMIENTO: PARCIAL" : "\u274C \xDALTIMO MANTENIMIENTO: FALLIDO O EXPIRADO";
                })());
                _$insert(_el$131, (() => {
                  var _c$6 = _$memo(() => receipt()?.status === "success");
                  return () => _c$6() ? `${receipt()?.deletedFamilies.length} familias eliminadas. ${bytesLabel(receipt()?.spaceFreedBytes ?? 0)} liberados en disco.` : receipt()?.error || receipt()?.vacuumError || "Operaci\xF3n no completada.";
                })());
                _$insert(_el$129, _$createComponent(Show, {
                  get when() {
                    return receipt()?.backupPath;
                  },
                  get children() {
                    var _el$132 = _$createElement("text"), _el$133 = _$createTextNode(`Copia de seguridad guardada en: `);
                    _$insertNode(_el$132, _el$133);
                    _$insert(_el$132, () => safeText(receipt()?.backupPath), null);
                    _$effect((_$p) => _$setProp(_el$132, "fg", COLOR.muted, _$p));
                    return _el$132;
                  }
                }), null);
                _$insert(_el$129, _$createComponent(Button, {
                  label: "[x] Descartar aviso de recibo",
                  action: () => void dismissReceipt()
                }), null);
                _$effect((_p$) => {
                  var _v$40 = receipt()?.status === "success" ? COLOR.green : receipt()?.status === "partial_success" ? COLOR.amber : COLOR.red, _v$41 = receipt()?.status === "success" ? COLOR.green : receipt()?.status === "partial_success" ? COLOR.amber : COLOR.red, _v$42 = COLOR.text;
                  _v$40 !== _p$.e && (_p$.e = _$setProp(_el$129, "borderColor", _v$40, _p$.e));
                  _v$41 !== _p$.t && (_p$.t = _$setProp(_el$130, "fg", _v$41, _p$.t));
                  _v$42 !== _p$.a && (_p$.a = _$setProp(_el$131, "fg", _v$42, _p$.a));
                  return _p$;
                }, {
                  e: void 0,
                  t: void 0,
                  a: void 0
                });
                return _el$129;
              }
            }), _el$157);
            _$insert(_el$128, _$createComponent(Show, {
              get when() {
                return claimedReport();
              },
              get children() {
                var _el$134 = _$createElement("box"), _el$135 = _$createElement("text"), _el$137 = _$createElement("text"), _el$138 = _$createTextNode(`Estado del proceso: `), _el$139 = _$createElement("text"), _el$140 = _$createTextNode(`Identificador: `), _el$141 = _$createTextNode(` \xB7 Familias en lote: `), _el$142 = _$createTextNode(` (`), _el$143 = _$createTextNode(` sesiones)`), _el$144 = _$createElement("text"), _el$146 = _$createElement("text");
                _$insertNode(_el$134, _el$135);
                _$insertNode(_el$134, _el$137);
                _$insertNode(_el$134, _el$139);
                _$insertNode(_el$134, _el$144);
                _$insertNode(_el$134, _el$146);
                _$setProp(_el$134, "flexDirection", "column");
                _$setProp(_el$134, "padding", 1);
                _$setProp(_el$134, "borderStyle", "single");
                _$insertNode(_el$135, _$createTextNode(`\u26A0 MANTENIMIENTO SUSPENDIDO: OPERACI\xD3N INTERRUMPIDA`));
                _$setProp(_el$135, "attributes", 1);
                _$insertNode(_el$137, _el$138);
                _$insert(_el$137, (() => {
                  var _c$7 = _$memo(() => claimedReport()?.status === "interrupted");
                  return () => _c$7() ? "Trabajador detenido sin generar recibo (interrumpido)" : claimedReport()?.status === "active" ? "Proceso activo" : "Estado del proceso desconocido / acceso denegado";
                })(), null);
                _$insertNode(_el$139, _el$140);
                _$insertNode(_el$139, _el$141);
                _$insertNode(_el$139, _el$142);
                _$insertNode(_el$139, _el$143);
                _$insert(_el$139, () => claimedReport()?.incidentInfo.armId, _el$141);
                _$insert(_el$139, () => claimedReport()?.incidentInfo.selectedFamilyCount, _el$142);
                _$insert(_el$139, () => claimedReport()?.incidentInfo.totalSessionCount, _el$143);
                _$insertNode(_el$144, _$createTextNode(`Resultado en datos: INCIERTO hasta validaci\xF3n manual. NO se ha revertido autom\xE1ticamente.`));
                _$insertNode(_el$146, _$createTextNode(`Acci\xF3n requerida: Conserva los archivos de respaldo (.sqlite). No inicies una nueva limpieza hasta verificar la integridad de la base.`));
                _$effect((_p$) => {
                  var _v$43 = COLOR.red, _v$44 = COLOR.panel, _v$45 = COLOR.red, _v$46 = COLOR.text, _v$47 = COLOR.text, _v$48 = COLOR.amber, _v$49 = COLOR.cyan;
                  _v$43 !== _p$.e && (_p$.e = _$setProp(_el$134, "borderColor", _v$43, _p$.e));
                  _v$44 !== _p$.t && (_p$.t = _$setProp(_el$134, "backgroundColor", _v$44, _p$.t));
                  _v$45 !== _p$.a && (_p$.a = _$setProp(_el$135, "fg", _v$45, _p$.a));
                  _v$46 !== _p$.o && (_p$.o = _$setProp(_el$137, "fg", _v$46, _p$.o));
                  _v$47 !== _p$.i && (_p$.i = _$setProp(_el$139, "fg", _v$47, _p$.i));
                  _v$48 !== _p$.n && (_p$.n = _$setProp(_el$144, "fg", _v$48, _p$.n));
                  _v$49 !== _p$.s && (_p$.s = _$setProp(_el$146, "fg", _v$49, _p$.s));
                  return _p$;
                }, {
                  e: void 0,
                  t: void 0,
                  a: void 0,
                  o: void 0,
                  i: void 0,
                  n: void 0,
                  s: void 0
                });
                return _el$134;
              }
            }), _el$157);
            _$insert(_el$128, _$createComponent(Show, {
              get when() {
                return armedPlan();
              },
              get children() {
                var _el$148 = _$createElement("box"), _el$149 = _$createElement("text"), _el$151 = _$createElement("text"), _el$153 = _$createElement("text"), _el$155 = _$createElement("text"), _el$156 = _$createTextNode(`Expira si OpenCode no se cierra en: `);
                _$insertNode(_el$148, _el$149);
                _$insertNode(_el$148, _el$151);
                _$insertNode(_el$148, _el$153);
                _$insertNode(_el$148, _el$155);
                _$setProp(_el$148, "flexDirection", "column");
                _$setProp(_el$148, "padding", 1);
                _$setProp(_el$148, "borderStyle", "single");
                _$insertNode(_el$149, _$createTextNode(`\u26A1 PLAN DE MANTENIMIENTO ARMADO`));
                _$setProp(_el$149, "attributes", 1);
                _$insertNode(_el$151, _$createTextNode(`Cierra todas las instancias de OpenCode para ejecutar la limpieza con respaldo previo.`));
                _$insertNode(_el$153, _$createTextNode(`Monitor visible activo en ventana independiente: indica cu\xE1ndo es seguro reabrir.`));
                _$insertNode(_el$155, _el$156);
                _$insert(_el$155, () => dateLabel(armedPlan()?.expiresAt ?? 0), null);
                _$insert(_el$148, _$createComponent(Button, {
                  label: "[c] Cancelar mantenimiento en espera",
                  action: () => void run(cancelMaintenance),
                  danger: true
                }), null);
                _$effect((_p$) => {
                  var _v$50 = COLOR.amber, _v$51 = COLOR.panel, _v$52 = COLOR.amber, _v$53 = COLOR.text, _v$54 = COLOR.cyan, _v$55 = COLOR.muted;
                  _v$50 !== _p$.e && (_p$.e = _$setProp(_el$148, "borderColor", _v$50, _p$.e));
                  _v$51 !== _p$.t && (_p$.t = _$setProp(_el$148, "backgroundColor", _v$51, _p$.t));
                  _v$52 !== _p$.a && (_p$.a = _$setProp(_el$149, "fg", _v$52, _p$.a));
                  _v$53 !== _p$.o && (_p$.o = _$setProp(_el$151, "fg", _v$53, _p$.o));
                  _v$54 !== _p$.i && (_p$.i = _$setProp(_el$153, "fg", _v$54, _p$.i));
                  _v$55 !== _p$.n && (_p$.n = _$setProp(_el$155, "fg", _v$55, _p$.n));
                  return _p$;
                }, {
                  e: void 0,
                  t: void 0,
                  a: void 0,
                  o: void 0,
                  i: void 0,
                  n: void 0
                });
                return _el$148;
              }
            }), _el$157);
            _$insertNode(_el$157, _el$158);
            _$insertNode(_el$157, _el$160);
            _$insertNode(_el$157, _el$162);
            _$insertNode(_el$157, _el$165);
            _$insertNode(_el$157, _el$168);
            _$setProp(_el$157, "flexDirection", "column");
            _$setProp(_el$157, "borderStyle", "single");
            _$setProp(_el$157, "padding", 1);
            _$insertNode(_el$158, _$createTextNode(`DATOS Y DISCO (VERDAD F\xCDSICA)`));
            _$setProp(_el$158, "attributes", 1);
            _$insertNode(_el$160, _el$161);
            _$insert(_el$160, () => safeText(dbInspect()?.dbPath || quickDisk()?.dbPath || (maintenanceLoading() ? "Detectando\u2026" : "No disponible")), null);
            _$insertNode(_el$162, _el$163);
            _$insertNode(_el$162, _el$164);
            _$insert(_el$162, (() => {
              var _c$8 = _$memo(() => !!dbInspect());
              return () => _c$8() ? bytesLabel(dbInspect().sizeBytes) : _$memo(() => !!quickDisk()?.exists)() ? bytesLabel(quickDisk().sizeBytes) : maintenanceLoading() ? "Detectando\u2026" : "No disponible";
            })(), _el$164);
            _$insert(_el$162, (() => {
              var _c$9 = _$memo(() => !!dbInspect());
              return () => _c$9() ? bytesLabel(dbInspect().freeBytes) : maintenanceLoading() ? "Calculando\u2026" : "No disponible";
            })(), null);
            _$insertNode(_el$165, _el$166);
            _$insertNode(_el$165, _el$167);
            _$insert(_el$165, (() => {
              var _c$0 = _$memo(() => !!dbInspect());
              return () => _c$0() ? String(dbInspect().sessionCount) : maintenanceLoading() ? "Contando\u2026" : "No disponible";
            })(), _el$167);
            _$insert(_el$165, (() => {
              var _c$1 = _$memo(() => !!dbInspect());
              return () => _c$1() ? _$memo(() => dbInspect().integrity === "ok")() ? "ok" : _$memo(() => dbInspect().integrity === "pending")() ? "Pendiente" : dbInspect().integrity : maintenanceLoading() ? "Pendiente" : "No verificada";
            })(), null);
            _$insertNode(_el$168, _el$169);
            _$insertNode(_el$168, _el$170);
            _$insertNode(_el$168, _el$171);
            _$insert(_el$168, () => archives().length, _el$170);
            _$insert(_el$168, () => bytesLabel(archives().reduce((acc, a) => acc + a.files.reduce((n, f) => n + f.compressed, 0), 0)), _el$171);
            _$insertNode(_el$172, _el$173);
            _$setProp(_el$172, "flexDirection", "column");
            _$setProp(_el$172, "borderStyle", "single");
            _$setProp(_el$172, "padding", 1);
            _$insertNode(_el$173, _$createTextNode(`LOTE DE LIMPIEZA FUERA DE L\xCDNEA`));
            _$setProp(_el$173, "attributes", 1);
            _$insert(_el$172, _$createComponent(Show, {
              get when() {
                return maintenanceLoading();
              },
              get children() {
                var _el$175 = _$createElement("text");
                _$insertNode(_el$175, _$createTextNode(`Calculando plan y verificando base de datos\u2026`));
                _$effect((_$p) => _$setProp(_el$175, "fg", COLOR.amber, _$p));
                return _el$175;
              }
            }), null);
            _$insert(_el$172, _$createComponent(Show, {
              get when() {
                return maintenanceError();
              },
              get children() {
                var _el$177 = _$createElement("text");
                _$insert(_el$177, maintenanceError);
                _$effect((_$p) => _$setProp(_el$177, "fg", COLOR.red, _$p));
                return _el$177;
              }
            }), null);
            _$insert(_el$172, _$createComponent(Show, {
              get when() {
                return _$memo(() => !!!maintenanceLoading())() && !maintenanceError();
              },
              get children() {
                return _$createComponent(Show, {
                  get when() {
                    return offlinePlan();
                  },
                  get fallback() {
                    return (() => {
                      var _el$228 = _$createElement("text");
                      _$insertNode(_el$228, _$createTextNode(`No hay plan de mantenimiento disponible.`));
                      _$effect((_$p) => _$setProp(_el$228, "fg", COLOR.muted, _$p));
                      return _el$228;
                    })();
                  },
                  get children() {
                    return [(() => {
                      var _el$178 = _$createElement("text"), _el$179 = _$createTextNode(`Familias totales: `), _el$180 = _$createTextNode(` \xB7 Conservadas por perfil/candados: `);
                      _$insertNode(_el$178, _el$179);
                      _$insertNode(_el$178, _el$180);
                      _$insert(_el$178, () => offlinePlan().totalFamilies, _el$180);
                      _$insert(_el$178, () => offlinePlan().retainedFamiliesCount, null);
                      _$effect((_$p) => _$setProp(_el$178, "fg", COLOR.text, _$p));
                      return _el$178;
                    })(), (() => {
                      var _el$181 = _$createElement("text"), _el$182 = _$createTextNode(`Familias candidatas en este lote: `);
                      _$insertNode(_el$181, _el$182);
                      _$insert(_el$181, () => offlinePlan().selectedFamilies.length, null);
                      _$effect((_$p) => _$setProp(_el$181, "fg", COLOR.text, _$p));
                      return _el$181;
                    })(), (() => {
                      var _el$183 = _$createElement("text"), _el$184 = _$createTextNode(`Espacio adicional requerido para respaldo: `), _el$185 = _$createTextNode(` (almacenamiento para copia de seguridad, no ahorro)`);
                      _$insertNode(_el$183, _el$184);
                      _$insertNode(_el$183, _el$185);
                      _$insert(_el$183, () => bytesLabel(dbInspect()?.sizeBytes ?? quickDisk()?.sizeBytes ?? 0), _el$185);
                      _$effect((_$p) => _$setProp(_el$183, "fg", COLOR.text, _$p));
                      return _el$183;
                    })(), _$createComponent(Show, {
                      get when() {
                        return offlinePlan().selectedFamilies.length === 0;
                      },
                      get children() {
                        var _el$186 = _$createElement("text");
                        _$insertNode(_el$186, _$createTextNode(`No hay familias candidatas para borrar. Tu cuota y candados protegen todas las sesiones.`));
                        _$effect((_$p) => _$setProp(_el$186, "fg", COLOR.green, _$p));
                        return _el$186;
                      }
                    }), _$createComponent(Show, {
                      get when() {
                        return offlinePlan().selectedFamilies.length > 0;
                      },
                      get children() {
                        return [(() => {
                          var _el$188 = _$createElement("box"), _el$189 = _$createElement("text"), _el$191 = _$createElement("text"), _el$192 = _$createTextNode(`P\xE1g. `), _el$193 = _$createTextNode(`/`), _el$194 = _$createTextNode(` (`), _el$195 = _$createTextNode(`\u2013`), _el$196 = _$createTextNode(` de `), _el$197 = _$createTextNode(`)`);
                          _$insertNode(_el$188, _el$189);
                          _$insertNode(_el$188, _el$191);
                          _$setProp(_el$188, "flexDirection", "row");
                          _$setProp(_el$188, "justifyContent", "space-between");
                          _$setProp(_el$188, "marginTop", 1);
                          _$insertNode(_el$189, _$createTextNode(`Lote exacto a eliminar (revisi\xF3n completa navegable):`));
                          _$insertNode(_el$191, _el$192);
                          _$insertNode(_el$191, _el$193);
                          _$insertNode(_el$191, _el$194);
                          _$insertNode(_el$191, _el$195);
                          _$insertNode(_el$191, _el$196);
                          _$insertNode(_el$191, _el$197);
                          _$insert(_el$191, () => maintenancePage() + 1, _el$193);
                          _$insert(_el$191, maintenanceTotalPages, _el$194);
                          _$insert(_el$191, () => maintenancePageStart() + 1, _el$195);
                          _$insert(_el$191, () => Math.min(maintenancePageStart() + 6, offlinePlan().selectedFamilies.length), _el$196);
                          _$insert(_el$191, () => offlinePlan().selectedFamilies.length, _el$197);
                          _$effect((_p$) => {
                            var _v$56 = COLOR.amber, _v$57 = COLOR.muted;
                            _v$56 !== _p$.e && (_p$.e = _$setProp(_el$189, "fg", _v$56, _p$.e));
                            _v$57 !== _p$.t && (_p$.t = _$setProp(_el$191, "fg", _v$57, _p$.t));
                            return _p$;
                          }, {
                            e: void 0,
                            t: void 0
                          });
                          return _el$188;
                        })(), _$createComponent(For, {
                          get each() {
                            return maintenanceVisibleFamilies();
                          },
                          children: (f, i) => {
                            const globalIdx = () => maintenancePageStart() + i();
                            const isSelected = () => maintenanceFocus() === globalIdx();
                            return (() => {
                              var _el$230 = _$createElement("box"), _el$231 = _$createElement("text"), _el$232 = _$createTextNode(` [`), _el$234 = _$createTextNode(`] `), _el$235 = _$createTextNode(` (`), _el$236 = _$createTextNode(` sesiones) \xB7 `);
                              _$insertNode(_el$230, _el$231);
                              _$setProp(_el$230, "flexDirection", "row");
                              _$setProp(_el$230, "height", 1);
                              _$setProp(_el$230, "onMouseDown", (e) => {
                                if (e.button === 0) {
                                  e.preventDefault();
                                  setMaintenanceIndex(globalIdx());
                                }
                              });
                              _$insertNode(_el$231, _el$232);
                              _$insertNode(_el$231, _el$234);
                              _$insertNode(_el$231, _el$235);
                              _$insertNode(_el$231, _el$236);
                              _$setProp(_el$231, "truncate", true);
                              _$insert(_el$231, () => globalIdx() + 1, _el$234);
                              _$insert(_el$231, () => safeText(f.title || f.rootId), _el$235);
                              _$insert(_el$231, () => f.memberIds.length, _el$236);
                              _$insert(_el$231, () => dateLabel(f.updated), null);
                              _$effect((_p$) => {
                                var _v$80 = isSelected() ? COLOR.selected : COLOR.bg, _v$81 = isSelected() ? COLOR.cyan : COLOR.text;
                                _v$80 !== _p$.e && (_p$.e = _$setProp(_el$230, "backgroundColor", _v$80, _p$.e));
                                _v$81 !== _p$.t && (_p$.t = _$setProp(_el$231, "fg", _v$81, _p$.t));
                                return _p$;
                              }, {
                                e: void 0,
                                t: void 0
                              });
                              return _el$230;
                            })();
                          }
                        }), (() => {
                          var _el$198 = _$createElement("box");
                          _$setProp(_el$198, "flexDirection", "row");
                          _$setProp(_el$198, "gap", 1);
                          _$setProp(_el$198, "marginTop", 1);
                          _$insert(_el$198, _$createComponent(Button, {
                            label: "[\u2190/h] Anterior",
                            action: prevMaintenancePage,
                            get selected() {
                              return maintenancePage() > 0;
                            }
                          }), null);
                          _$insert(_el$198, _$createComponent(Button, {
                            label: "[\u2192/l] Siguiente",
                            action: nextMaintenancePage,
                            get selected() {
                              return maintenancePage() < maintenanceTotalPages() - 1;
                            }
                          }), null);
                          return _el$198;
                        })()];
                      }
                    })];
                  }
                });
              }
            }), null);
            _$insert(_el$128, _$createComponent(Button, {
              label: "[r] Actualizar diagn\xF3stico e inspecci\xF3n",
              action: () => void run(loadMaintenance)
            }), null);
            _$effect((_p$) => {
              var _v$58 = contentHeight(), _v$59 = COLOR.line, _v$60 = COLOR.cyan, _v$61 = COLOR.text, _v$62 = COLOR.text, _v$63 = COLOR.text, _v$64 = COLOR.text, _v$65 = COLOR.line, _v$66 = COLOR.cyan;
              _v$58 !== _p$.e && (_p$.e = _$setProp(_el$127, "height", _v$58, _p$.e));
              _v$59 !== _p$.t && (_p$.t = _$setProp(_el$157, "borderColor", _v$59, _p$.t));
              _v$60 !== _p$.a && (_p$.a = _$setProp(_el$158, "fg", _v$60, _p$.a));
              _v$61 !== _p$.o && (_p$.o = _$setProp(_el$160, "fg", _v$61, _p$.o));
              _v$62 !== _p$.i && (_p$.i = _$setProp(_el$162, "fg", _v$62, _p$.i));
              _v$63 !== _p$.n && (_p$.n = _$setProp(_el$165, "fg", _v$63, _p$.n));
              _v$64 !== _p$.s && (_p$.s = _$setProp(_el$168, "fg", _v$64, _p$.s));
              _v$65 !== _p$.h && (_p$.h = _$setProp(_el$172, "borderColor", _v$65, _p$.h));
              _v$66 !== _p$.r && (_p$.r = _$setProp(_el$173, "fg", _v$66, _p$.r));
              return _p$;
            }, {
              e: void 0,
              t: void 0,
              a: void 0,
              o: void 0,
              i: void 0,
              n: void 0,
              s: void 0,
              h: void 0,
              r: void 0
            });
            return _el$127;
          }
        }), _$createComponent(Show, {
          get when() {
            return _$memo(() => screen() === "detail")() && detail();
          },
          get children() {
            var _el$199 = _$createElement("scrollbox"), _el$200 = _$createElement("text"), _el$201 = _$createElement("text"), _el$202 = _$createTextNode(`ID: `), _el$203 = _$createElement("text"), _el$204 = _$createTextNode(`Proyecto: `), _el$205 = _$createElement("text"), _el$206 = _$createTextNode(`\xDAltima actividad familiar: `), _el$207 = _$createElement("text"), _el$208 = _$createTextNode(`Tama\xF1o l\xF3gico: `), _el$209 = _$createTextNode(` \xB7 `), _el$210 = _$createTextNode(` sesiones`), _el$211 = _$createElement("text"), _el$212 = _$createTextNode(`Estado: `);
            _$insertNode(_el$199, _el$200);
            _$insertNode(_el$199, _el$201);
            _$insertNode(_el$199, _el$203);
            _$insertNode(_el$199, _el$205);
            _$insertNode(_el$199, _el$207);
            _$insertNode(_el$199, _el$211);
            _$setProp(_el$200, "attributes", 1);
            _$insert(_el$200, () => safeText(detail()?.root.title));
            _$insertNode(_el$201, _el$202);
            _$insert(_el$201, () => detail()?.root.id, null);
            _$insertNode(_el$203, _el$204);
            _$insert(_el$203, () => safeText(detail()?.root.directory), null);
            _$insertNode(_el$205, _el$206);
            _$insert(_el$205, () => dateLabel(detail().updated), null);
            _$insertNode(_el$207, _el$208);
            _$insertNode(_el$207, _el$209);
            _$insertNode(_el$207, _el$210);
            _$insert(_el$207, () => size(detail()), _el$209);
            _$insert(_el$207, () => detail()?.members.length, _el$210);
            _$insertNode(_el$211, _el$212);
            _$insert(_el$211, () => detail()?.reasons.join(" \xB7 ") || "Candidata a limpieza", null);
            _$insert(_el$199, _$createComponent(For, {
              get each() {
                return detail()?.members;
              },
              children: (member) => _$createComponent(Button, {
                get label() {
                  return `${state()?.pins.includes(member.id) ? "\u25CF LOCK" : "\u25CB"} ${safeText(member.title)} \xB7 ${member.id.slice(-10)}`;
                },
                action: () => void run(async () => {
                  await props.service.pin(member.id);
                  await refresh();
                })
              })
            }), null);
            _$effect((_p$) => {
              var _v$67 = Math.max(7, dimensions().height - 22), _v$68 = COLOR.cyan, _v$69 = COLOR.text, _v$70 = COLOR.muted, _v$71 = COLOR.text, _v$72 = COLOR.text, _v$73 = COLOR.amber;
              _v$67 !== _p$.e && (_p$.e = _$setProp(_el$199, "height", _v$67, _p$.e));
              _v$68 !== _p$.t && (_p$.t = _$setProp(_el$200, "fg", _v$68, _p$.t));
              _v$69 !== _p$.a && (_p$.a = _$setProp(_el$201, "fg", _v$69, _p$.a));
              _v$70 !== _p$.o && (_p$.o = _$setProp(_el$203, "fg", _v$70, _p$.o));
              _v$71 !== _p$.i && (_p$.i = _$setProp(_el$205, "fg", _v$71, _p$.i));
              _v$72 !== _p$.n && (_p$.n = _$setProp(_el$207, "fg", _v$72, _p$.n));
              _v$73 !== _p$.s && (_p$.s = _$setProp(_el$211, "fg", _v$73, _p$.s));
              return _p$;
            }, {
              e: void 0,
              t: void 0,
              a: void 0,
              o: void 0,
              i: void 0,
              n: void 0,
              s: void 0
            });
            return _el$199;
          }
        })];
      },
      get children() {
        var _el$26 = _$createElement("box"), _el$27 = _$createElement("text");
        _$insertNode(_el$26, _el$27);
        _$setProp(_el$26, "flexDirection", "column");
        _$setProp(_el$26, "gap", 1);
        _$setProp(_el$26, "paddingTop", 1);
        _$setProp(_el$26, "paddingBottom", 1);
        _$setProp(_el$27, "attributes", 1);
        _$insert(_el$27, () => entry()?.title);
        _$insert(_el$26, _$createComponent(Show, {
          get when() {
            return entry()?.description;
          },
          get children() {
            var _el$28 = _$createElement("text");
            _$setProp(_el$28, "wrapMode", "word");
            _$insert(_el$28, () => entry()?.description);
            _$effect((_$p) => _$setProp(_el$28, "fg", COLOR.cyan, _$p));
            return _el$28;
          }
        }), null);
        _$insert(_el$26, _$createComponent(Show, {
          get when() {
            return busy();
          },
          get fallback() {
            return [(() => {
              var _el$237 = _$createElement("text");
              _$insertNode(_el$237, _$createTextNode(`Enter confirma \xB7 Esc cancela`));
              _$effect((_$p) => _$setProp(_el$237, "fg", COLOR.muted, _$p));
              return _el$237;
            })(), (() => {
              var _el$239 = _$createElement("input");
              _$setProp(_el$239, "focused", true);
              _$setProp(_el$239, "onInput", setDraft);
              _$setProp(_el$239, "onSubmit", () => void run(submitEntry));
              _$setProp(_el$239, "onKeyDown", (e) => {
                if (e.name === "escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  back();
                }
              });
              _$effect((_p$) => {
                var _v$82 = draft(), _v$83 = entry()?.placeholder;
                _v$82 !== _p$.e && (_p$.e = _$setProp(_el$239, "value", _v$82, _p$.e));
                _v$83 !== _p$.t && (_p$.t = _$setProp(_el$239, "placeholder", _v$83, _p$.t));
                return _p$;
              }, {
                e: void 0,
                t: void 0
              });
              return _el$239;
            })()];
          },
          get children() {
            return [(() => {
              var _el$29 = _$createElement("text");
              _$insertNode(_el$29, _$createTextNode(`Procesando borrado seguro y respaldos en curso\u2026`));
              _$effect((_$p) => _$setProp(_el$29, "fg", COLOR.cyan, _$p));
              return _el$29;
            })(), (() => {
              var _el$31 = _$createElement("text");
              _$insertNode(_el$31, _$createTextNode(`Por favor espera, no cierres esta ventana\u2026`));
              _$effect((_$p) => _$setProp(_el$31, "fg", COLOR.muted, _$p));
              return _el$31;
            })()];
          }
        }), null);
        _$effect((_$p) => _$setProp(_el$27, "fg", COLOR.amber, _$p));
        return _el$26;
      }
    }), _el$33);
    _$insertNode(_el$33, _el$34);
    _$insertNode(_el$33, _el$38);
    _$setProp(_el$33, "flexDirection", "column");
    _$setProp(_el$33, "flexShrink", 0);
    _$setProp(_el$33, "borderStyle", "single");
    _$setProp(_el$33, "marginTop", 1);
    _$setProp(_el$33, "paddingLeft", 1);
    _$setProp(_el$33, "paddingRight", 1);
    _$insertNode(_el$34, _el$35);
    _$insertNode(_el$34, _el$36);
    _$setProp(_el$34, "flexDirection", "row");
    _$setProp(_el$34, "height", 1);
    _$setProp(_el$34, "flexShrink", 0);
    _$setProp(_el$34, "justifyContent", "space-between");
    _$setProp(_el$35, "flexDirection", "row");
    _$setProp(_el$35, "gap", 1);
    _$insert(_el$35, _$createComponent(Button, {
      get label() {
        return `[p] ${state() ? PROFILES[state().config.profile].label : "Perfil"}`;
      },
      action: () => go("profiles")
    }), null);
    _$insert(_el$35, _$createComponent(Button, {
      label: "[m] Mantenimiento",
      action: () => go("maintenance"),
      get selected() {
        return screen() === "maintenance";
      }
    }), null);
    _$insertNode(_el$36, _el$37);
    _$insert(_el$36, () => state()?.config.automatic ? "AUTO ON" : "AUTO PAUSADO", _el$37);
    _$setProp(_el$38, "height", 1);
    _$setProp(_el$38, "flexShrink", 0);
    _$setProp(_el$38, "marginTop", 0);
    _$setProp(_el$38, "onMouseDown", (e) => {
      if (e.button === 0 && screen() === "list") {
        e.preventDefault();
        e.stopPropagation();
        void openPreview();
      }
    });
    _$insert(_el$38, _$createComponent(Show, {
      get when() {
        return screen() === "list";
      },
      get children() {
        var _el$39 = _$createElement("box");
        _$setProp(_el$39, "flexDirection", "row");
        _$setProp(_el$39, "height", 1);
        _$setProp(_el$39, "flexShrink", 0);
        _$setProp(_el$39, "gap", 1);
        _$setProp(_el$39, "flexWrap", "no-wrap");
        _$insert(_el$39, _$createComponent(Keycap, {
          keyText: "\u2191\u2193",
          label: "Mover"
        }), null);
        _$insert(_el$39, _$createComponent(Keycap, {
          keyText: "Espacio",
          label: "Candado"
        }), null);
        _$insert(_el$39, _$createComponent(Keycap, {
          keyText: "[i]",
          label: "Detalle"
        }), null);
        _$insert(_el$39, _$createComponent(Keycap, {
          keyText: "[v]",
          label: "Previa"
        }), null);
        _$insert(_el$39, _$createComponent(Show, {
          get when() {
            return !compact();
          },
          get children() {
            return _$createComponent(Keycap, {
              keyText: "[b]",
              label: "Respaldos"
            });
          }
        }), null);
        _$insert(_el$39, _$createComponent(Keycap, {
          keyText: "Esc",
          get label() {
            return compact() ? "Salir" : "Cerrar";
          },
          highlight: true
        }), null);
        return _el$39;
      }
    }), null);
    _$insert(_el$38, _$createComponent(Show, {
      get when() {
        return screen() === "preview";
      },
      get children() {
        var _el$40 = _$createElement("box");
        _$setProp(_el$40, "flexDirection", "row");
        _$setProp(_el$40, "height", 1);
        _$setProp(_el$40, "flexShrink", 0);
        _$setProp(_el$40, "gap", 1);
        _$setProp(_el$40, "flexWrap", "no-wrap");
        _$insert(_el$40, _$createComponent(Keycap, {
          keyText: "\u2191\u2193",
          label: "Mover"
        }), null);
        _$insert(_el$40, _$createComponent(Keycap, {
          keyText: "[c]",
          get label() {
            return compact() ? "Borrar API" : "Borrar por API";
          },
          highlight: true
        }), null);
        _$insert(_el$40, _$createComponent(Keycap, {
          keyText: "Esc",
          label: "Volver"
        }), null);
        return _el$40;
      }
    }), null);
    _$insert(_el$38, _$createComponent(Show, {
      get when() {
        return screen() === "maintenance";
      },
      get children() {
        var _el$41 = _$createElement("box");
        _$setProp(_el$41, "flexDirection", "row");
        _$setProp(_el$41, "height", 1);
        _$setProp(_el$41, "flexShrink", 0);
        _$setProp(_el$41, "gap", 1);
        _$setProp(_el$41, "flexWrap", "no-wrap");
        _$insert(_el$41, _$createComponent(Keycap, {
          keyText: "\u2191\u2193",
          get label() {
            return compact() ? "Sel" : "Seleccionar";
          }
        }), null);
        _$insert(_el$41, _$createComponent(Keycap, {
          keyText: "\u2190\u2192",
          get label() {
            return compact() ? "P\xE1g" : "P\xE1gina";
          }
        }), null);
        _$insert(_el$41, _$createComponent(Show, {
          get when() {
            return armedPlan();
          },
          get children() {
            return _$createComponent(Keycap, {
              keyText: "[c]",
              get label() {
                return compact() ? "Cancelar" : "Cancelar espera";
              },
              highlight: true
            });
          }
        }), null);
        _$insert(_el$41, _$createComponent(Show, {
          get when() {
            return !armedPlan();
          },
          get children() {
            return _$createComponent(Keycap, {
              keyText: "[a]",
              get label() {
                return compact() ? "Armar" : "Armar lote";
              },
              highlight: true
            });
          }
        }), null);
        _$insert(_el$41, _$createComponent(Keycap, {
          keyText: "[r]",
          get label() {
            return compact() ? "Act" : "Actualizar";
          }
        }), null);
        _$insert(_el$41, _$createComponent(Keycap, {
          keyText: "Esc",
          label: "Volver"
        }), null);
        return _el$41;
      }
    }), null);
    _$insert(_el$38, _$createComponent(Show, {
      get when() {
        return screen() === "profiles";
      },
      get children() {
        var _el$42 = _$createElement("box");
        _$setProp(_el$42, "flexDirection", "row");
        _$setProp(_el$42, "height", 1);
        _$setProp(_el$42, "flexShrink", 0);
        _$setProp(_el$42, "gap", 1);
        _$setProp(_el$42, "flexWrap", "no-wrap");
        _$insert(_el$42, _$createComponent(Keycap, {
          keyText: "[1\u20135]",
          label: "Elegir perfil",
          highlight: true
        }), null);
        _$insert(_el$42, _$createComponent(Keycap, {
          keyText: "Esc",
          label: "Volver"
        }), null);
        return _el$42;
      }
    }), null);
    _$insert(_el$38, _$createComponent(Show, {
      get when() {
        return screen() === "settings";
      },
      get children() {
        var _el$43 = _$createElement("box");
        _$setProp(_el$43, "flexDirection", "row");
        _$setProp(_el$43, "height", 1);
        _$setProp(_el$43, "flexShrink", 0);
        _$setProp(_el$43, "gap", 1);
        _$setProp(_el$43, "flexWrap", "no-wrap");
        _$insert(_el$43, _$createComponent(Keycap, {
          keyText: "[a][s][t][i][b][h][r]",
          label: "Opciones"
        }), null);
        _$insert(_el$43, _$createComponent(Keycap, {
          keyText: "Esc",
          label: "Volver"
        }), null);
        return _el$43;
      }
    }), null);
    _$insert(_el$38, _$createComponent(Show, {
      get when() {
        return screen() === "backups" || screen() === "detail";
      },
      get children() {
        var _el$44 = _$createElement("box");
        _$setProp(_el$44, "flexDirection", "row");
        _$setProp(_el$44, "height", 1);
        _$setProp(_el$44, "flexShrink", 0);
        _$setProp(_el$44, "gap", 1);
        _$setProp(_el$44, "flexWrap", "no-wrap");
        _$insert(_el$44, _$createComponent(Keycap, {
          keyText: "Esc",
          label: "Volver",
          highlight: true
        }));
        return _el$44;
      }
    }), null);
    _$insert(_el$33, _$createComponent(Show, {
      get when() {
        return !entry();
      },
      get children() {
        return [_$createComponent(Show, {
          get when() {
            return screen() === "maintenance";
          },
          get children() {
            var _el$45 = _$createElement("box"), _el$46 = _$createElement("box");
            _$insertNode(_el$45, _el$46);
            _$setProp(_el$45, "flexDirection", "column");
            _$setProp(_el$45, "gap", 1);
            _$setProp(_el$45, "marginTop", 1);
            _$setProp(_el$45, "flexShrink", 0);
            _$insert(_el$45, _$createComponent(Show, {
              get when() {
                return maintenanceLoading();
              },
              get children() {
                return _$createComponent(Button, {
                  label: "[a] Calculando lote de mantenimiento\u2026",
                  action: () => {
                  }
                });
              }
            }), _el$46);
            _$insert(_el$45, _$createComponent(Show, {
              get when() {
                return _$memo(() => !!!maintenanceLoading())() && maintenanceError();
              },
              get children() {
                return _$createComponent(Button, {
                  label: "[a] Error en diagn\xF3stico (pulsa [r] para reintentar)",
                  action: () => void run(loadMaintenance),
                  danger: true
                });
              }
            }), _el$46);
            _$insert(_el$45, _$createComponent(Show, {
              get when() {
                return _$memo(() => !!(!maintenanceLoading() && !maintenanceError()))() && armedPlan();
              },
              get children() {
                return _$createComponent(Button, {
                  label: "[c] Cancelar mantenimiento en espera",
                  action: () => void run(cancelMaintenance),
                  danger: true,
                  selected: true
                });
              }
            }), _el$46);
            _$insert(_el$45, _$createComponent(Show, {
              get when() {
                return _$memo(() => !!(!maintenanceLoading() && !maintenanceError() && !armedPlan()))() && (!offlinePlan() || offlinePlan().selectedFamilies.length === 0);
              },
              get children() {
                return _$createComponent(Button, {
                  label: "Sin familias candidatas para mantenimiento",
                  action: () => {
                  }
                });
              }
            }), _el$46);
            _$insert(_el$45, _$createComponent(Show, {
              get when() {
                return _$memo(() => !!(!maintenanceLoading() && !maintenanceError() && !armedPlan() && offlinePlan()))() && offlinePlan().selectedFamilies.length > 0;
              },
              get children() {
                return _$createComponent(Button, {
                  label: "Mantenimiento suspendido: operaci\xF3n interrumpida / exclusi\xF3n no garantizada",
                  action: () => {
                  },
                  danger: true
                });
              }
            }), _el$46);
            _$setProp(_el$46, "flexDirection", "row");
            _$setProp(_el$46, "gap", 1);
            _$setProp(_el$46, "flexShrink", 0);
            _$insert(_el$46, _$createComponent(Button, {
              label: "[\u2190/h] Ant",
              action: prevMaintenancePage,
              get selected() {
                return maintenancePage() > 0;
              }
            }), null);
            _$insert(_el$46, _$createComponent(Button, {
              label: "[\u2192/l] Sig",
              action: nextMaintenancePage,
              get selected() {
                return maintenancePage() < maintenanceTotalPages() - 1;
              }
            }), null);
            _$insert(_el$46, _$createComponent(Button, {
              label: "[r] Actualizar",
              action: () => void run(loadMaintenance)
            }), null);
            _$insert(_el$46, _$createComponent(Button, {
              label: "\u2190 Volver a sesiones",
              action: () => go("list")
            }), null);
            return _el$45;
          }
        }), _$createComponent(Show, {
          get when() {
            return _$memo(() => screen() === "preview")() && canClean();
          },
          get children() {
            return _$createComponent(Button, {
              label: "[c] Borrar por API con respaldo\u2026",
              danger: true,
              action: clean
            });
          }
        }), _$createComponent(Show, {
          get when() {
            return _$memo(() => screen() !== "list")() && screen() !== "maintenance";
          },
          get children() {
            return _$createComponent(Button, {
              label: "\u2190 Volver a sesiones",
              action: () => go("list")
            });
          }
        })];
      }
    }), null);
    _$setProp(_el$47, "height", 2);
    _$setProp(_el$47, "flexShrink", 0);
    _$setProp(_el$47, "wrapMode", "word");
    _$insert(_el$47, () => busy() ? "Procesando\u2026 " : "", null);
    _$insert(_el$47, message, null);
    _$effect((_p$) => {
      var _v$10 = COLOR.bg, _v$11 = COLOR.blue, _v$12 = props.inHostDialog ? -Math.floor(dimensions().height / 4) + 1 : 0, _v$13 = Math.max(15, dimensions().height - 4), _v$14 = COLOR.blue, _v$15 = COLOR.muted, _v$16 = COLOR.blue, _v$17 = COLOR.panel, _v$18 = state()?.config.automatic ? COLOR.green : COLOR.amber, _v$19 = error() ? COLOR.red : busy() ? COLOR.cyan : COLOR.muted;
      _v$10 !== _p$.e && (_p$.e = _$setProp(_el$1, "backgroundColor", _v$10, _p$.e));
      _v$11 !== _p$.t && (_p$.t = _$setProp(_el$1, "borderColor", _v$11, _p$.t));
      _v$12 !== _p$.a && (_p$.a = _$setProp(_el$1, "marginTop", _v$12, _p$.a));
      _v$13 !== _p$.o && (_p$.o = _$setProp(_el$1, "maxHeight", _v$13, _p$.o));
      _v$14 !== _p$.i && (_p$.i = _$setProp(_el$11, "fg", _v$14, _p$.i));
      _v$15 !== _p$.n && (_p$.n = _$setProp(_el$13, "fg", _v$15, _p$.n));
      _v$16 !== _p$.s && (_p$.s = _$setProp(_el$33, "borderColor", _v$16, _p$.s));
      _v$17 !== _p$.h && (_p$.h = _$setProp(_el$33, "backgroundColor", _v$17, _p$.h));
      _v$18 !== _p$.r && (_p$.r = _$setProp(_el$36, "fg", _v$18, _p$.r));
      _v$19 !== _p$.d && (_p$.d = _$setProp(_el$47, "fg", _v$19, _p$.d));
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0,
      n: void 0,
      s: void 0,
      h: void 0,
      r: void 0,
      d: void 0
    });
    return _el$1;
  })();
}

// src/tui.tsx
var activeRuntime;
function getActiveSessionVault() {
  return activeRuntime;
}
function resetSessionVaultStateForTests() {
  activeRuntime = void 0;
}
async function initSessionVault(api, options = {}) {
  if (activeRuntime) return activeRuntime;
  const version = api.app?.version?.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (version && (Number(version[1]) !== 1 || Number(version[2]) < 18 || Number(version[2]) === 18 && Number(version[3]) < 29)) {
    api.ui?.toast?.({
      title: "Session Vault",
      message: "Este paquete requiere OpenCode 1.18.29 o posterior de la rama 1.x. OpenCode 2 usa otra API.",
      variant: "error",
      duration: 12e3
    });
    return void 0;
  }
  const store = new Store();
  try {
    await store.migrate();
  } catch (e) {
    api.ui?.toast?.({
      title: "Session Vault",
      message: `Aviso de inicio: ${errorText(e)}`,
      variant: "error",
      duration: 8e3
    });
    return void 0;
  }
  const leases = new Leases(store);
  const currentID = () => api.route?.current?.name === "session" ? api.route?.current?.params?.sessionID : void 0;
  let leaseActive = /* @__PURE__ */ new Set();
  const project = await api.client?.project?.current?.({
    directory: api.state?.path?.directory
  }, {
    throwOnError: true
  });
  if (!project?.data?.id) throw new Error("Session Vault: no se pudo resolver el proyecto actual.");
  const service = new VaultService({
    gateway: new OpenCodeGateway(api.client, {
      activeDirectory: api.state?.path?.directory,
      activeWorkspaceID: api.state?.workspace?.id ?? api.state?.path?.workspace
    }),
    store,
    projectID: project.data.id,
    projectDirectory: api.state?.path?.directory,
    signal: api.lifecycle?.signal,
    active: () => /* @__PURE__ */ new Set([...leaseActive, ...currentID() ? [currentID()] : []]),
    allowed: async () => {
      const transport = api.client;
      const url = transport.client?.getConfig?.().baseUrl;
      if (!url || !["opencode.internal", "localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
        throw new Error("Esta versi\xF3n solo limpia servidores locales. La conexi\xF3n remota queda en modo consulta.");
      }
      await leases.heartbeat(currentID());
      const other = await leases.read();
      leaseActive = other.active;
      if (other.unknownPids && other.unknownPids.size > 0) {
        throw new Error("Estado de proceso desconocido o acceso denegado. Limpieza suspendida por seguridad.");
      }
      if (other.pids.size > 1) throw new Error("Cierra las otras instancias de OpenCode antes de limpiar. Puedes seguir revisando y poniendo candados.");
    }
  });
  let heartbeatRunning = false;
  const heartbeat = async () => {
    if (heartbeatRunning || api.lifecycle?.signal?.aborted) return;
    heartbeatRunning = true;
    try {
      await leases.heartbeat(currentID());
      leaseActive = (await leases.read()).active;
    } finally {
      heartbeatRunning = false;
    }
  };
  await heartbeat();
  const notify = (message, variant = "info") => api.ui?.toast?.({
    title: "Session Vault",
    message,
    variant,
    duration: 7e3
  });
  let checking = false;
  let tickLastError = "";
  let tickConsecutiveFailures = 0;
  let nextTickAttempt = 0;
  const tick = async () => {
    if (checking || api.lifecycle?.signal?.aborted || api.ui?.dialog?.open) return;
    if (Date.now() < nextTickAttempt) return;
    checking = true;
    try {
      const state = await store.read();
      if (!state.config.automatic || Date.now() - state.lastRun < state.config.intervalMinutes * 6e4) return;
      const preview = await service.preview({
        liveness: true
      });
      if (api.lifecycle?.signal?.aborted || api.ui?.dialog?.open) return;
      const result = await service.cleanup(preview, true);
      if (result.error) throw new Error(result.error);
      if (result.deleted.length) notify(`${result.deleted.length} familias eliminadas con respaldo previo.`, "success");
      tickLastError = "";
      tickConsecutiveFailures = 0;
      nextTickAttempt = 0;
    } catch (e) {
      tickConsecutiveFailures++;
      const message = errorText(e);
      if (message !== tickLastError) {
        notify(message, "error");
        tickLastError = message;
      }
      const state = await store.read().catch(() => null);
      const intervalMinutes = state?.config?.intervalMinutes ?? 30;
      nextTickAttempt = Date.now() + computeBackoff(tickConsecutiveFailures, intervalMinutes);
    } finally {
      checking = false;
    }
  };
  let heartbeatLastError = "";
  const timers = [setInterval(() => void heartbeat().catch((e) => {
    const msg = errorText(e);
    if (msg !== heartbeatLastError) {
      heartbeatLastError = msg;
    }
  }), 5e3), setInterval(() => void tick(), 6e4)];
  const open2 = () => {
    if (api.lifecycle?.signal?.aborted) return;
    if (api.renderer && (api.renderer.width < 70 || api.renderer.height < 30)) {
      notify("Ampl\xEDa la terminal a un m\xEDnimo de 70 columnas y 30 filas.", "info");
      return;
    }
    api.ui?.dialog?.replace?.(() => _$createComponent2(ErrorBoundary, {
      fallback: (e) => (() => {
        var _el$ = _$createElement2("box"), _el$2 = _$createElement2("text"), _el$3 = _$createTextNode2(`Session Vault: `), _el$4 = _$createTextNode2(`. Pulsa Esc y vuelve a abrir.`);
        _$insertNode2(_el$, _el$2);
        _$setProp2(_el$, "padding", 2);
        _$insertNode2(_el$2, _el$3);
        _$insertNode2(_el$2, _el$4);
        _$insert2(_el$2, () => errorText(e), _el$4);
        _$effect2((_$p) => _$setProp2(_el$2, "fg", COLOR.red, _$p));
        return _el$;
      })(),
      get children() {
        return _$createComponent2(VaultApp, {
          api,
          service,
          inHostDialog: true,
          onClose: () => api.ui?.dialog?.clear?.()
        });
      }
    }));
    api.ui?.dialog?.setSize?.("xlarge");
  };
  const dispose = async () => {
    timers.forEach(clearInterval);
    await leases.close();
    if (activeRuntime === runtime) {
      activeRuntime = void 0;
    }
  };
  const runtime = {
    service,
    store,
    leases,
    open: open2,
    dispose
  };
  activeRuntime = runtime;
  api.lifecycle?.onDispose?.(dispose);
  if (options?.registerKeymap !== false && api.keymap?.registerLayer) {
    createRoot((disposeRoot) => {
      api.lifecycle?.onDispose?.(disposeRoot);
      const key = options?.keybinding ?? "alt+shift+s";
      const off = api.keymap.registerLayer({
        priority: 80,
        commands: [{
          namespace: "palette",
          name: "session-vault.open",
          title: "Session Vault \xB7 gestionar sesiones",
          category: "Session Vault",
          slashName: "session-vault",
          slashAliases: ["sesiones-db"],
          run: () => {
            open2();
            return true;
          }
        }],
        bindings: [{
          key,
          cmd: "session-vault.open"
        }]
      });
      if (off) api.lifecycle?.onDispose?.(off);
    });
  }
  return runtime;
}
async function openSessionVault(api) {
  if (activeRuntime) {
    activeRuntime.open();
    return;
  }
  const runtime = await initSessionVault(api, {
    registerKeymap: false
  });
  runtime?.open();
}
var tui = async (api) => {
  await initSessionVault(api);
};
var tui_default = {
  id: "opencode-session-vault",
  tui
};
export {
  tui_default as default,
  getActiveSessionVault,
  initSessionVault,
  openSessionVault,
  resetSessionVaultStateForTests
};
