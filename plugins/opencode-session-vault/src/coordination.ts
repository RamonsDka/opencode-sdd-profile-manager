import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite, type Store } from "./store.ts";
import type { Quota } from "./model.ts";

export interface OfflineFamilySummary {
  rootId: string;
  memberIds: string[];
  updated: number;
  title: string;
  members: Array<{ id: string; parentId?: string; timeUpdated: number }>;
}

export interface OfflinePlan {
  version: 1;
  createdAt: number;
  expiresAt: number;
  canonicalDbPath: string;
  dbStat: { size: number; mtimeMs: number };
  stateRevision: number;
  statePins: string[];
  scope: "global" | "project";
  projectID?: string;
  profile: string;
  totalSessions: number;
  totalFamilies: number;
  candidateFamiliesCount: number;
  retainedFamiliesCount: number;
  selectedFamilies: OfflineFamilySummary[];
  quota: Quota;
  snapshotHash: string;
  dataVersion: number;
  fingerprint: string;
}

export interface InspectResult {
  dbPath: string;
  sizeBytes: number;
  pageSize: number;
  freelistCount: number;
  freeBytes: number;
  sessionCount: number;
  tables: string[];
  integrity: string;
}

export interface ArmedPlan {
  version: 1;
  id: string;
  armedAt: number;
  expiresAt: number;
  ownerPid: number;
  workerPid?: number;
  monitorPid?: number;
  plan: OfflinePlan;
  status: "armed" | "cancelled" | "claimed";
}

export type PidLiveness = "alive" | "dead" | "unknown";

export interface ClaimedStateReport {
  status: "active" | "interrupted" | "unknown";
  pidStatus: PidLiveness;
  claimedPlan: ArmedPlan;
  workerPid?: number;
  claimedFile: string;
  hasReceipt: boolean;
  workerPidFile?: string;
  incidentInfo: {
    armId: string;
    canonicalDbPath: string;
    selectedFamilyCount: number;
    totalSessionCount: number;
    armedAt: number;
    outcome: "uncertain";
    actionableMessage: string;
  };
}

export interface MaintenanceReceipt {
  version: 1;
  id: string;
  planFingerprint: string;
  completedAt: number;
  status: "success" | "partial_success" | "failed" | "cancelled" | "expired";
  deletedFamilies: string[];
  deletedSessions: string[];
  backupPath?: string;
  initialSizeBytes?: number;
  finalSizeBytes?: number;
  spaceFreedBytes?: number;
  error?: string;
  vacuumError?: string;
  revalidated?: boolean;
  workerPid?: number;
}

export const ARMED_PLAN_FILE = "armed-plan.json";
export const CLAIMED_PLAN_FILE = "claimed-plan.json";
export const RECEIPT_FILE = "maintenance-receipt.json";

export function checkPidLiveness(
  pid: number | undefined,
  customChecker?: (pid: number) => PidLiveness | boolean
): { status: PidLiveness; reason?: string } {
  if (pid === undefined || pid <= 0 || !Number.isInteger(pid)) {
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
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return { status: "dead" };
    }
    if (code === "EPERM" || code === "EACCES") {
      return { status: "unknown", reason: "Acceso denegado (EPERM/EACCES): proceso no descartable como muerto" };
    }
    return { status: "unknown", reason: String(err) };
  }
}

export async function getClaimedPlan(store: Store): Promise<ArmedPlan | null> {
  const claimedFile = path.join(store.dir, CLAIMED_PLAN_FILE);
  try {
    const raw = await fs.readFile(claimedFile, "utf8");
    return JSON.parse(raw) as ArmedPlan;
  } catch {
    return null;
  }
}

export async function inspectClaimedState(
  store: Store,
  options?: { isPidAlive?: (pid: number) => PidLiveness | boolean }
): Promise<ClaimedStateReport | null> {
  const claimedFile = path.join(store.dir, CLAIMED_PLAN_FILE);
  const claimed = await getClaimedPlan(store);
  if (!claimed) return null;

  let workerPid = claimed.workerPid;
  let workerPidFile: string | undefined;
  const potentialPidFile = path.join(store.dir, `worker-pid-${claimed.id}.json`);
  try {
    const rawPid = await fs.readFile(potentialPidFile, "utf8");
    const pidData = JSON.parse(rawPid);
    if (typeof pidData.workerPid === "number") {
      workerPid = pidData.workerPid;
      workerPidFile = potentialPidFile;
    }
  } catch {}

  const receipt = await getReceipt(store);
  const hasReceipt = Boolean(receipt && receipt.id === claimed.id);

  const { status: pidStatus } = checkPidLiveness(workerPid, options?.isPidAlive);

  let status: "active" | "interrupted" | "unknown";
  if (pidStatus === "alive") {
    status = "active";
  } else if (pidStatus === "dead") {
    status = hasReceipt ? "unknown" : "interrupted";
  } else {
    status = "unknown";
  }

  const selectedFamilyCount = claimed.plan.selectedFamilies?.length ?? 0;
  const totalSessionCount = claimed.plan.selectedFamilies?.flatMap(f => f.memberIds ?? []).length ?? 0;

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
      actionableMessage:
        "Operación interrumpida: proceso trabajador ausente sin recibo. Preservar respaldos (.sqlite). No se ha revertido automáticamente. Resultado incierto hasta validación manual.",
    },
  };
}

export async function armOfflinePlan(options: {
  store: Store;
  plan: OfflinePlan;
  ownerPid: number;
  ttlMs?: number;
  armId?: string;
  monitorPid?: number;
  workerPid?: number;
  _trustedTestExecution?: boolean;
}): Promise<ArmedPlan> {
  // Pending claim blocks new arm even if UI bypass
  const claimed = await getClaimedPlan(options.store);
  if (claimed) {
    throw new Error(
      "Mantenimiento suspendido: operación interrumpida / exclusión no garantizada (se detectó un plan reclamado previo sin resolver)."
    );
  }

  // Centrally disallow production destructive arming
  if (!options._trustedTestExecution) {
    throw new Error(
      "Mantenimiento suspendido: operación interrumpida / exclusión no garantizada (coordinación exclusiva de host no disponible en producción)."
    );
  }
  const armedAt = Date.now();
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  const expiresAt = armedAt + ttlMs;
  const armedPlan: ArmedPlan = {
    version: 1,
    id: options.armId ?? randomUUID(),
    armedAt,
    expiresAt,
    ownerPid: options.ownerPid,
    workerPid: options.workerPid,
    monitorPid: options.monitorPid,
    plan: options.plan,
    status: "armed",
  };

  const armedFile = path.join(options.store.dir, ARMED_PLAN_FILE);
  await atomicWrite(armedFile, JSON.stringify(armedPlan, null, 2));
  return armedPlan;
}

export async function cancelArmedPlan(store: Store): Promise<boolean> {
  const armedFile = path.join(store.dir, ARMED_PLAN_FILE);
  try {
    const raw = await fs.readFile(armedFile, "utf8");
    const armed = JSON.parse(raw) as ArmedPlan;
    if (armed.status === "claimed") {
      return false;
    }
    await fs.unlink(armedFile);
    const receipt: MaintenanceReceipt = {
      version: 1,
      id: armed.id,
      planFingerprint: armed.plan.fingerprint,
      completedAt: Date.now(),
      status: "cancelled",
      deletedFamilies: [],
      deletedSessions: [],
    };
    await writeReceipt(store, receipt);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

export async function getArmedPlan(store: Store): Promise<ArmedPlan | null> {
  const armedFile = path.join(store.dir, ARMED_PLAN_FILE);
  try {
    const raw = await fs.readFile(armedFile, "utf8");
    return JSON.parse(raw) as ArmedPlan;
  } catch {
    return null;
  }
}

export async function writeReceipt(store: Store, receipt: MaintenanceReceipt): Promise<void> {
  const receiptFile = path.join(store.dir, RECEIPT_FILE);
  await atomicWrite(receiptFile, JSON.stringify(receipt, null, 2));
}

export async function getReceipt(store: Store): Promise<MaintenanceReceipt | null> {
  const receiptFile = path.join(store.dir, RECEIPT_FILE);
  try {
    const raw = await fs.readFile(receiptFile, "utf8");
    return JSON.parse(raw) as MaintenanceReceipt;
  } catch {
    return null;
  }
}

export async function clearReceipt(store: Store): Promise<void> {
  const receiptFile = path.join(store.dir, RECEIPT_FILE);
  await fs.rm(receiptFile, { force: true });
}

export interface SafeManualApiAvailability {
  available: boolean;
  reason?: string;
  report?: ClaimedStateReport | null;
}

export async function checkManualApiAvailability(
  store: Store,
  options?: {
    isPidAlive?: (pid: number) => PidLiveness | boolean;
    helperClient?: { inspectClaimed?: () => Promise<ClaimedStateReport | null> };
  }
): Promise<SafeManualApiAvailability> {
  const claimed = options?.helperClient?.inspectClaimed
    ? await options.helperClient.inspectClaimed()
    : await inspectClaimedState(store, options);

  if (claimed) {
    if (claimed.status === "active") {
      return {
        available: false,
        reason: `Hay un trabajador de mantenimiento fuera de línea activo (PID ${claimed.workerPid ?? "desconocido"}). Limpieza por API suspendida.`,
        report: claimed,
      };
    }
    if (claimed.status === "unknown") {
      return {
        available: false,
        reason: "Estado del proceso fuera de línea desconocido (acceso denegado o incierto). Limpieza por API suspendida por seguridad.",
        report: claimed,
      };
    }
    // claimed.status === "interrupted": worker process verified dead (ESRCH), no active worker modifying DB
    return {
      available: true,
      report: claimed,
    };
  }

  const armed = await getArmedPlan(store);
  if (armed && armed.status === "armed" && Date.now() < armed.expiresAt) {
    const { status: ownerStatus } = checkPidLiveness(armed.ownerPid, options?.isPidAlive);
    if (ownerStatus === "alive") {
      return {
        available: false,
        reason: "Hay un plan de mantenimiento armado en espera. Cancela el plan antes de limpiar por API.",
      };
    }
  }

  return {
    available: true,
    report: null,
  };
}

