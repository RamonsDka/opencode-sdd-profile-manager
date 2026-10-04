import { createHash } from "node:crypto";
import { PROFILES, type Config, type Family, type Plan, type Quota, type Session, type Snapshot, type State } from "./model.ts";

export function validateState(value: unknown): State {
  if (!value || typeof value !== "object") throw new Error("Configuración inválida. Se detuvo la limpieza.");
  const s = value as State;
  const c = s.config;
  if ((s.schema !== 1 && s.schema !== 2) || !Number.isSafeInteger(s.revision) || s.revision < 0 || !c ||
    !Object.hasOwn(PROFILES, c.profile) || !["project", "global"].includes(c.scope) ||
    typeof c.automatic !== "boolean" || typeof c.includeArchived !== "boolean" ||
    !Number.isInteger(c.percent) || c.percent < 1 || c.percent > 100 ||
    !Number.isFinite(c.graceHours) || c.graceHours < 1 || c.graceHours > 8760 ||
    !Number.isInteger(c.intervalMinutes) || c.intervalMinutes < 5 || c.intervalMinutes > 10080 ||
    !Number.isInteger(c.maxDeletePerRun) || c.maxDeletePerRun < 1 || c.maxDeletePerRun > 100 ||
    !Array.isArray(s.pins) || s.pins.some(id => typeof id !== "string" || !/^ses_[a-zA-Z0-9]+$/.test(id)) ||
    !s.quotas || typeof s.quotas !== "object" || Array.isArray(s.quotas) || !Number.isFinite(s.lastRun)) {
    throw new Error("Configuración inválida. Conserva el archivo y corrígelo antes de limpiar.");
  }
  for (const q of Object.values(s.quotas)) {
    if (!q || typeof q.signature !== "string" || !Number.isInteger(q.keep) || q.keep < 1 ||
      !Number.isInteger(q.baseline) || q.baseline < 0 || !Number.isFinite(q.at)) throw new Error("Cupo inválido.");
  }
  return s;
}

export function validateSessions(sessions: Session[]) {
  const ids = new Set<string>();
  for (const s of sessions) {
    if (!s || !/^ses_[a-zA-Z0-9]+$/.test(s.id) || ids.has(s.id) || typeof s.title !== "string" ||
      typeof s.projectID !== "string" || typeof s.directory !== "string" ||
      !Number.isSafeInteger(s.time?.updated) || s.time.updated <= 0 ||
      (s.parentID !== undefined && typeof s.parentID !== "string")) throw new Error("Inventario inválido o duplicado; no se borrará nada.");
    ids.add(s.id);
  }
}

export const scopeKey = (c: Config, projectID: string) => c.scope === "global" ? "global" : `project:${projectID}`;
export const quotaSignature = (c: Config) => `${c.profile}:${c.profile === "mod" ? c.percent : PROFILES[c.profile].percent ?? 10}`;
export function resolveQuota(c: Config, total: number, previous?: Quota, now = Date.now()): Quota {
  const signature = quotaSignature(c);
  if (previous?.signature === signature) return previous;
  const percent = c.profile === "mod" ? c.percent : PROFILES[c.profile].percent;
  return { signature, baseline: total, keep: c.profile === "ten" ? 10 : Math.max(1, Math.ceil(total * percent! / 100)), at: now };
}

export function familiesOf(sessions: Session[]): Family[] {
  validateSessions(sessions);
  const byID = new Map(sessions.map(s => [s.id, s]));
  const groups = new Map<string, Family>();
  for (const session of sessions) {
    const visited = new Set<string>();
    let root = session;
    while (root.parentID) {
      if (visited.has(root.id)) throw new Error("Jerarquía circular; se detuvo la limpieza.");
      visited.add(root.id);
      const parent = byID.get(root.parentID);
      if (!parent) throw new Error("Inventario incompleto: falta una sesión padre. No se borrará nada.");
      root = parent;
    }
    let family = groups.get(root.id);
    if (!family) { family = { root, members: [], updated: 0, reasons: [] }; groups.set(root.id, family); }
    family.members.push(session);
    family.updated = Math.max(family.updated, session.time.updated);
  }
  return [...groups.values()].sort((a, b) => b.updated - a.updated || b.root.id.localeCompare(a.root.id));
}

export function isFamilyActiveProject(family: { root?: Session; members?: Session[] } | undefined | null, projectID: string): boolean {
  if (!projectID || typeof projectID !== "string" || !projectID.trim()) return false;
  if (!family?.root || !Array.isArray(family.members) || family.members.length === 0) return false;
  if (family.root.projectID !== projectID) return false;
  return family.members.every(m => Boolean(m && typeof m.projectID === "string" && m.projectID.trim() !== "" && m.projectID === projectID));
}

export function familyFingerprint(family: Family) {
  return createHash("sha256").update(JSON.stringify(family.members.map(s => [s.id, s.parentID, s.time.updated]).sort())).digest("hex");
}

export function makePlan(
  snapshot: Snapshot,
  state: State,
  projectID: string,
  now = Date.now(),
  options?: { manualApi?: boolean; maxManualFamilies?: number }
): Plan {
  validateState(state);
  const key = scopeKey(state.config, projectID);
  const pins = new Set(state.pins);
  // Global inventory browsing: include all families across all projects.
  const families = familiesOf(snapshot.sessions);
  const isGlobal = state.config.scope === "global";
  const activeProject = Boolean(projectID && typeof projectID === "string" && projectID.trim());
  const eligibleFamilies = isGlobal ? families : (activeProject ? families.filter(f => isFamilyActiveProject(f, projectID)) : []);
  // Pinned families are extra; they do not consume the retention quota.
  const unpinned = eligibleFamilies.filter(f => !f.members.some(s => pins.has(s.id)));
  const quota = resolveQuota(state.config, unpinned.length, state.quotas[key], now);
  const keepIDs = new Set(unpinned.slice(0, quota.keep).map(f => f.root.id));
  // possible is retention/pins only BEFORE activity; unverified already means unknown.
  const possible = eligibleFamilies.filter(f => !f.members.some(s => pins.has(s.id)) && !keepIDs.has(f.root.id));
  for (const f of families) {
    if (!activeProject) {
      f.reasons.push("Otro proyecto");
    } else if (!isGlobal && !isFamilyActiveProject(f, projectID)) {
      f.reasons.push("Otro proyecto");
    } else if (isGlobal) {
      const rootProj = f.root.projectID;
      const isMixed = !rootProj || !rootProj.trim() || f.members.some(m => !m.projectID || !m.projectID.trim() || m.projectID !== rootProj);
      if (isMixed) f.reasons.push("Otro proyecto");
    }
    const hasUnverifiableMember = f.members.some(m => !m || typeof m.projectID !== "string" || !m.projectID.trim() || typeof m.directory !== "string" || !m.directory.trim());
    if (hasUnverifiableMember) f.reasons.push("Actividad no verificada");
    if (f.members.some(s => pins.has(s.id))) f.reasons.push("Candado");
    if (f.members.some(s => snapshot.active.has(s.id))) f.reasons.push("Abierta");
    if (f.members.some(s => snapshot.busy.has(s.id))) f.reasons.push("Trabajando");
    if (f.members.some(s => snapshot.unverified?.has(s.id))) f.reasons.push("Actividad no verificada");
    if (!state.config.includeArchived && f.members.some(s => s.time.archived)) f.reasons.push("Archivada");
    if (f.updated > now - state.config.graceHours * 3600000) f.reasons.push("Actividad reciente");
    if (keepIDs.has(f.root.id)) f.reasons.push("Dentro del cupo");
    if (!options?.manualApi) {
      // Fail-closed: current host cannot prove cross-instance exclusion, including same-project.
      // Reuse Actividad no verificada; no duplicate unknown set, no bypass flag.
      f.reasons.push("Actividad no verificada");
    }
    f.reasons = [...new Set(f.reasons)];
  }

  let candidates: Family[] = [];
  if (options?.manualApi) {
    const maxFamilies = options.maxManualFamilies ?? 5;
    const eligibleWithoutReasons = families.filter(f => !f.reasons.length);
    const candidateLot = [...eligibleWithoutReasons].reverse().slice(0, maxFamilies);
    const candidateLotRootIds = new Set(candidateLot.map(f => f.root.id));
    for (const f of families) {
      if (!f.reasons.length && !candidateLotRootIds.has(f.root.id)) {
        f.reasons.push("Fuera de lote (máx. 5)");
      }
    }
    candidates = candidateLot;
  } else {
    candidates = families.filter(f => !f.reasons.length);
  }

  const retained = families.filter(f => f.reasons.length);
  // verified needs host exclusion evidence; empty on unsupported host, no public bypass.
  const verified: Family[] = [];
  return { at: now, revision: state.revision, scopeKey: key, families, candidates,
    retained, quota,
    locked: families.filter(f => f.members.some(s => pins.has(s.id))).length,
    fingerprint: createHash("sha256").update(JSON.stringify([state.revision, key, candidates.map(familyFingerprint), families.map(f => [f.root.id, familyFingerprint(f), f.reasons])])).digest("hex"),
    possible, verified, protected: retained, manualApi: Boolean(options?.manualApi) };
}
