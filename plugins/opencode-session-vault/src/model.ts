export type Session = {
  id: string; title: string; projectID: string; directory: string; parentID?: string;
  time: { created: number; updated: number; archived?: number };
  [key: string]: unknown;
};
export type Profile = "ten" | "basic" | "moderate" | "conservative" | "mod";
export const PROFILES: Record<Profile, { label: string; percent?: number }> = {
  ten: { label: "Últimas 10" }, basic: { label: "Básico · 15%", percent: 15 },
  moderate: { label: "Moderado · 25%", percent: 25 },
  conservative: { label: "Conservador · 40%", percent: 40 }, mod: { label: "Mod · personalizado" },
};
export type Config = {
  profile: Profile; percent: number; scope: "global" | "project";
  automatic: boolean; graceHours: number; includeArchived: boolean;
  intervalMinutes: number; maxDeletePerRun: number;
};
export type Quota = { signature: string; baseline: number; keep: number; at: number };
export type State = {
  schema: 1 | 2; revision: number; config: Config; pins: string[];
  quotas: Record<string, Quota>; lastRun: number;
};
export const defaultState = (): State => ({
  schema: 2, revision: 0,
  config: { profile: "ten", percent: 25, scope: "global", automatic: false,
    graceHours: 24, includeArchived: false, intervalMinutes: 30, maxDeletePerRun: 10 },
  pins: [], quotas: {}, lastRun: 0,
});
export type Family = { root: Session; members: Session[]; updated: number; reasons: string[] };
export type Plan = {
  at: number; revision: number; scopeKey: string; families: Family[]; candidates: Family[];
  retained: Family[]; quota: Quota; locked: number; fingerprint: string;
  // possible is retention/pins only BEFORE activity; verified needs host exclusion (empty here).
  // protected lists families with reasons (same as retained, overlapping allowed).
  possible: Family[]; verified: Family[]; protected: Family[];
  manualApi?: boolean;
};
export type Snapshot = { sessions: Session[]; busy: Set<string>; active: Set<string>; unverified?: Set<string> };
export type ManualApiOutcome = {
  operationId?: string;
  timestamp: number;
  status: "success" | "partial" | "failed";
  deletedFamiliesCount: number;
  deletedSessionsCount?: number;
  targetFamiliesCount?: number;
  targetSessionsCount?: number;
  backupVerified?: boolean;
  uncertainDescendants?: boolean;
  error?: string;
  archivesCount?: number;
  dbSizeBytesBefore?: number;
  dbSizeBytesAfter?: number;
  dbSizeDeltaBytes?: number;
  walSizeBytesBefore?: number;
  walSizeBytesAfter?: number;
};
export const safeText = (s: unknown) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ");
export const errorText = (e: unknown) => safeText(e instanceof Error ? e.message : e);

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const kib = n / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(1)} MiB`;
  const gib = mib / 1024;
  return `${gib.toFixed(2)} GiB`;
}

export function formatDeltaBytes(delta: number): string {
  if (!Number.isFinite(delta)) return "—";
  if (delta === 0) return "0 B";
  if (delta > 0) return `+${formatBytes(delta)}`;
  return `-${formatBytes(Math.abs(delta))}`;
}

export function emptyInventoryMessage(options: { busy: boolean; error: boolean; hasPlan: boolean }): string {
  if (options.busy) return "Cargando…";
  if (options.error) return "No se pudo cargar el inventario.";
  if (!options.hasPlan) return "Cargando…";
  return "No hay sesiones para mostrar.";
}

export function inventoryCountLabel(options: { count: number; pageStart: number; pageSize: number; busy: boolean; error: boolean; hasPlan: boolean }): string {
  if (options.count > 0) {
    return `${options.pageStart + 1}–${Math.min(options.pageStart + options.pageSize, options.count)} de ${options.count}`;
  }
  if (options.error) return "Error al cargar";
  if (options.busy || !options.hasPlan) return "Cargando…";
  return "0 sesiones";
}

export function computeBackoff(consecutiveFailures: number, intervalMinutes = 30): number {
  const intervalMs = Math.max(60000, intervalMinutes * 60000);
  return Math.min(intervalMs, 60000 * Math.pow(2, Math.min(consecutiveFailures, 6)));
}
