import { randomUUID } from "node:crypto";
import type { Gateway } from "./api.ts";
import { backupFamily, saveManifest } from "./archive.ts";
import type { Config, Plan } from "./model.ts";
import { errorText } from "./model.ts";
import { familyFingerprint, makePlan, scopeKey, isFamilyActiveProject, familiesOf } from "./policy.ts";
import { checkManualApiAvailability } from "./coordination.ts";
import { Store } from "./store.ts";

export type CleanupResult = {
  deleted: string[];
  skipped: string[];
  error?: string;
  archives: string[];
  operationId?: string;
  timestamp?: number;
  status?: "success" | "partial" | "failed";
  deletedFamiliesCount?: number;
  deletedSessionsCount?: number;
  targetFamiliesCount?: number;
  targetSessionsCount?: number;
  backupVerified?: boolean;
  uncertainDescendants?: boolean;
  dbSizeBytesBefore?: number;
  dbSizeBytesAfter?: number;
  dbSizeDeltaBytes?: number;
  walSizeBytesBefore?: number;
  walSizeBytesAfter?: number;
};
export interface ReadonlyMetricsBackend {
  getDiskStats: () => { sizeBytes: number; walSizeBytes?: number } | Promise<{ sizeBytes: number; walSizeBytes?: number }>;
}
export class VaultService {
  gateway: Gateway; store: Store; projectID: string; projectDirectory?: string;
  active: () => Set<string>; allowed: () => Promise<void>;
  signal?: AbortSignal;
  metricsBackend?: ReadonlyMetricsBackend;
  constructor(options: {
    gateway: Gateway;
    store: Store;
    projectID: string;
    projectDirectory?: string;
    active: () => Set<string>;
    allowed?: () => Promise<void>;
    signal?: AbortSignal;
    metricsBackend?: ReadonlyMetricsBackend;
  }) {
    this.gateway = options.gateway; this.store = options.store; this.projectID = options.projectID;
    this.projectDirectory = options.projectDirectory;
    this.active = options.active; this.allowed = options.allowed ?? (async () => {}); this.signal = options.signal;
    this.metricsBackend = options.metricsBackend;
  }
  assertAlive() { if (this.signal?.aborted) throw new Error("OpenCode está cerrando; limpieza cancelada."); }
  async preview(options?: {
    liveness?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
    manualApi?: boolean;
    maxManualFamilies?: number;
  }): Promise<Plan> {
    const state = await this.store.read();
    const liveness = options?.liveness ?? false;
    let candidateDirectories: Set<string> | undefined;
    if (liveness) {
      const inv = await this.gateway.snapshot(this.active(), this.projectDirectory, this.projectID, {
        signal: options?.signal ?? this.signal,
        liveness: false,
        timeoutMs: options?.timeoutMs,
      });
      const prePlan = makePlan(inv, state, this.projectID, Date.now(), {
        manualApi: options?.manualApi,
        maxManualFamilies: options?.maxManualFamilies,
      });
      // Liveness must cover possible (retention/pins outside) needing verification, not legacy candidates.
      const livenessSource = (prePlan as Plan).possible?.length ? (prePlan as Plan).possible : prePlan.candidates;
      candidateDirectories = new Set(livenessSource.flatMap(f => f.members.map(m => m.directory)));
    }
    const snapshot = await this.gateway.snapshot(this.active(), this.projectDirectory, this.projectID, {
      signal: options?.signal ?? this.signal,
      liveness,
      timeoutMs: options?.timeoutMs,
      candidateDirectories,
    });
    return makePlan(snapshot, state, this.projectID, Date.now(), {
      manualApi: options?.manualApi,
      maxManualFamilies: options?.maxManualFamilies,
    });
  }
  async configure(patch: Partial<Config>, recalculate = false) {
    await this.store.update(state => {
      state.config = { ...state.config, ...patch };
      if (recalculate) delete state.quotas[scopeKey(state.config, this.projectID)];
    });
  }
  async pin(id: string) {
    await this.store.update(s => { s.pins = s.pins.includes(id) ? s.pins.filter(p => p !== id) : [...s.pins, id]; });
  }
  async cleanup(
    approved: Plan,
    automatic = false,
    options?: { manualApi?: boolean; metricsBackend?: ReadonlyMetricsBackend }
  ): Promise<CleanupResult> {
    return this.store.exclusive(async () => {
      this.assertAlive(); await this.allowed();
      if (!this.projectID || typeof this.projectID !== "string" || !this.projectID.trim()) {
        throw new Error("No se pudo identificar el proyecto activo. Limpieza suspendida.");
      }
      const state = await this.store.read();
      if (automatic && (state.schema < 2 || !state.config.automatic || Date.now() - state.lastRun < state.config.intervalMinutes * 60000)) return { deleted: [], skipped: [], archives: [] };

      const isManualApi = Boolean(options?.manualApi || approved.manualApi) && !automatic;

      if (isManualApi && approved.candidates.length > 5) {
        throw new Error("El lote manual por API supera el límite máximo de 5 familias.");
      }

      if (state.revision !== approved.revision || Date.now() - approved.at > 5 * 60000) throw new Error("La vista previa cambió o venció. Actualízala antes de limpiar.");
      const candidateDirs = new Set(((approved as Plan).possible ?? approved.candidates).flatMap(f => f.members.map(m => m.directory)));
      const beforeSnapshot = await this.gateway.snapshot(this.active(), this.projectDirectory, this.projectID, {
        signal: this.signal,
        liveness: true,
        candidateDirectories: candidateDirs,
      });
      const before = makePlan(beforeSnapshot, state, this.projectID, Date.now(), { manualApi: isManualApi });
      if (before.fingerprint !== approved.fingerprint) throw new Error("Las sesiones cambiaron. Revisa una vista previa nueva.");
      if (JSON.stringify(state.quotas[before.scopeKey]) !== JSON.stringify(before.quota)) {
        state.quotas[before.scopeKey] = before.quota;
        await this.store.save(state);
      }
      const result: CleanupResult = { deleted: [], skipped: [], archives: [] };

      if (!isManualApi) {
        // Automatic and legacy path remains strictly fail-closed
        const targets = [...approved.candidates].reverse().slice(0, state.config.maxDeletePerRun);
        if (targets.length > 0 || (approved as Plan).verified?.length > 0) {
          throw new Error("Limpieza no admitida en este host: falta exclusión entre instancias. No se borrará nada.");
        }
        const latest = await this.store.read();
        latest.lastRun = Date.now();
        latest.revision++;
        await this.store.save(latest);
        await this.store.audit({ at: Date.now(), mode: automatic ? "automatic" : "manual", ...result });
        return result;
      }

      // Safe Manual API Deletion
      const availability = await checkManualApiAvailability(this.store);
      if (!availability.available) {
        throw new Error(`Limpieza por API no disponible: ${availability.reason}`);
      }

      const metrics = options?.metricsBackend ?? this.metricsBackend;
      let statsBefore: { sizeBytes: number; walSizeBytes?: number } | undefined;
      if (metrics && typeof metrics.getDiskStats === "function") {
        try {
          statsBefore = await metrics.getDiskStats();
        } catch {
          // Stat failure never couples to deletion
        }
      }

      const targets = approved.candidates;
      const operationId = `${Date.now()}-${randomUUID()}`;
      const targetFamiliesCount = targets.length;
      const targetSessionsCount = targets.reduce((sum, f) => sum + f.members.length, 0);
      let deletedFamiliesCount = 0;
      let deletedSessionsCount = 0;
      let backupVerified = true;
      let uncertainDescendants = false;

      try {
        for (const family of targets) {
          this.assertAlive(); await this.allowed();
          if (state.config.scope === "project" && !isFamilyActiveProject(family, this.projectID)) {
            throw new Error("La familia no pertenece al proyecto activo. Limpieza abortada.");
          }

          const freshSnapshot = await this.gateway.snapshot(this.active(), this.projectDirectory, this.projectID, {
            signal: this.signal,
            liveness: true,
            candidateDirectories: new Set(family.members.map(m => m.directory)),
          });

          const currentFamilies = familiesOf(freshSnapshot.sessions);
          const current = currentFamilies.find(f => f.root.id === family.root.id);
          if (!current) {
            throw new Error("La familia ya no existe en el inventario. Limpieza abortada.");
          }

          if (current.members.length !== family.members.length) {
            throw new Error("Se detectaron cambios en los miembros de la familia (nueva hija o sesión faltante). Limpieza abortada; genera una nueva vista previa.");
          }
          for (const m of family.members) {
            const freshMember = current.members.find(s => s.id === m.id);
            if (!freshMember) {
              throw new Error("Miembro de familia ausente. Limpieza abortada.");
            }
            if (freshMember.time.updated !== m.time.updated) {
              throw new Error("La actividad de una sesión cambió tras la vista previa. Limpieza abortada.");
            }
            if (freshMember.parentID !== m.parentID) {
              throw new Error("La jerarquía de la familia cambió. Limpieza abortada.");
            }
          }

          const freshState = await this.store.read();
          if (current.members.some(m => freshState.pins.includes(m.id))) {
            throw new Error("Se añadió un candado a la familia tras la vista previa. Limpieza abortada.");
          }

          if (current.members.some(m => this.active().has(m.id))) {
            throw new Error("La familia tiene una sesión abierta activa. Limpieza abortada.");
          }
          if (current.members.some(m => freshSnapshot.busy.has(m.id))) {
            throw new Error("La familia tiene una sesión trabajando. Limpieza abortada.");
          }
          if (current.members.some(m => freshSnapshot.unverified?.has(m.id))) {
            throw new Error("La familia tiene actividad no verificada. Limpieza abortada.");
          }

          const backup = await backupFamily(this.store, this.gateway, current);
          result.archives.push(backup.id);

          try {
            this.assertAlive(); await this.allowed();
            if (JSON.stringify(await this.store.read()) !== JSON.stringify(state)) {
              throw new Error("La configuración cambió durante la limpieza.");
            }

            // Pre-delete tree & activity recheck
            const preDeleteSnapshot = await this.gateway.snapshot(this.active(), this.projectDirectory, this.projectID, {
              signal: this.signal,
              liveness: true,
              candidateDirectories: new Set(family.members.map(m => m.directory)),
            });
            const preDeleteFamilies = familiesOf(preDeleteSnapshot.sessions);
            const preDelete = preDeleteFamilies.find(f => f.root.id === family.root.id);
            if (
              !preDelete ||
              preDelete.members.length !== family.members.length ||
              preDelete.members.some(
                m =>
                  !family.members.some(
                    orig =>
                      orig.id === m.id &&
                      orig.time.updated === m.time.updated &&
                      orig.parentID === m.parentID
                  )
              )
            ) {
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
            if (current.members.some(m => remaining.some(s => s.id === m.id))) {
              uncertainDescendants = true;
              throw new Error("Eliminación parcial por API: se conserva el respaldo para revisión.");
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

      let statsAfter: { sizeBytes: number; walSizeBytes?: number } | undefined;
      if (metrics && typeof metrics.getDiskStats === "function") {
        try {
          statsAfter = await metrics.getDiskStats();
        } catch {
          // Stat failure never couples to deletion
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
}
