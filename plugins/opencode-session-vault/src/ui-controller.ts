import { createSignal, type Accessor, type Setter } from "solid-js";
import { errorText, type Plan, type State, type ManualApiOutcome } from "./model.ts";
import type { VaultService } from "./service.ts";
import { VaultHelperClient } from "./helper-client.ts";
import type {
  InspectResult,
  OfflinePlan,
  ArmedPlan,
  MaintenanceReceipt,
  ClaimedStateReport,
} from "./coordination.ts";
import { checkManualApiAvailability } from "./coordination.ts";

export const MAINTENANCE_PAGE_SIZE = 6;

export type Screen = "list" | "profiles" | "settings" | "preview" | "backups" | "detail" | "maintenance";

export interface VaultControllerOptions {
  service: VaultService;
  signal?: AbortSignal;
  isMounted?: () => boolean;
  onClose?: () => void;
  onPlanUpdate?: (plan: Plan) => void;
  onNavigate?: (next: Screen) => void;
  askConfirmation?: (
    title: string,
    placeholder: string,
    action: (value: string) => Promise<void>,
    description?: string
  ) => void;
  closeConfirmation?: () => void;
  helperClient?: VaultHelperClient;
  _trustedTestExecution?: boolean;
  manualApi?: boolean;
}

export function createVaultNavigationController(options: VaultControllerOptions) {
  const isMounted = options.isMounted ?? (() => true);
  const helperClient =
    options.helperClient ??
    new VaultHelperClient({ store: options.service.store });

  const [screen, setScreen] = createSignal<Screen>("list");
  const [plan, setPlan] = createSignal<Plan | undefined>(undefined);
  const [state, setState] = createSignal<State | undefined>(undefined);
  const [busy, setBusy] = createSignal(false);
  const [inventoryError, setInventoryError] = createSignal(false);
  const [operationError, setOperationError] = createSignal(false);
  const error = () => inventoryError() || operationError();
  const setError = (val: boolean) => {
    setOperationError(val);
    if (!val) setInventoryError(false);
  };
  const [message, setMessage] = createSignal("Leyendo el inventario de OpenCode…");
  const [livePlan, setLivePlan] = createSignal(false);
  const [manualApiAvailable, setManualApiAvailable] = createSignal(false);
  const [manualApiReason, setManualApiReason] = createSignal<string | undefined>(undefined);
  const [lastManualResult, setLastManualResult] = createSignal<ManualApiOutcome | null>(null);
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
    setShowLastManualDetail(prev => !prev);
  }

  // Offline maintenance state
  const [quickDisk, setQuickDisk] = createSignal<{ dbPath: string; sizeBytes: number; exists: boolean; walSizeBytes?: number } | undefined>(
    undefined
  );
  const [dbInspect, setDbInspect] = createSignal<InspectResult | undefined>(undefined);
  const [dbStatsLoading, setDbStatsLoading] = createSignal(false);
  const [dbStatsError, setDbStatsError] = createSignal<string | undefined>(undefined);
  const [dbStatsReady, setDbStatsReady] = createSignal(false);

  async function loadDbStats(force = false) {
    if (!force && dbStatsReady()) return;
    setDbStatsLoading(true);
    setDbStatsError(undefined);
    try {
      if (typeof helperClient.getQuickDiskStats === "function") {
        const q = helperClient.getQuickDiskStats();
        if (isMounted()) setQuickDisk(q);
      }
      if (typeof helperClient.inspectDatabase === "function") {
        const insp = await helperClient.inspectDatabase(undefined, { timeout: 5000, checkIntegrity: false });
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

  const [offlinePlan, setOfflinePlan] = createSignal<OfflinePlan | undefined>(undefined);
  const [armedPlan, setArmedPlan] = createSignal<ArmedPlan | undefined>(undefined);
  const [claimedReport, setClaimedReport] = createSignal<ClaimedStateReport | undefined>(undefined);
  const [receipt, setReceipt] = createSignal<MaintenanceReceipt | undefined>(undefined);
  const [maintenanceLoading, setMaintenanceLoading] = createSignal(false);
  const [maintenanceError, setMaintenanceError] = createSignal<string | undefined>(undefined);
  const [maintenancePage, setMaintenancePage] = createSignal(0);
  const [maintenanceFocus, setMaintenanceFocus] = createSignal(0);

  const maintenanceTotalPages = () =>
    Math.max(1, Math.ceil((offlinePlan()?.selectedFamilies.length ?? 0) / MAINTENANCE_PAGE_SIZE));
  const maintenancePageStart = () => maintenancePage() * MAINTENANCE_PAGE_SIZE;
  const maintenanceVisibleFamilies = () =>
    (offlinePlan()?.selectedFamilies ?? []).slice(
      maintenancePageStart(),
      maintenancePageStart() + MAINTENANCE_PAGE_SIZE
    );

  function nextMaintenancePage() {
    if (maintenanceLoading() || busy()) return;
    const total = maintenanceTotalPages();
    if (maintenancePage() < total - 1) {
      setMaintenancePage(p => p + 1);
      setMaintenanceFocus(maintenancePage() * MAINTENANCE_PAGE_SIZE);
    }
  }

  function prevMaintenancePage() {
    if (maintenanceLoading() || busy()) return;
    if (maintenancePage() > 0) {
      setMaintenancePage(p => p - 1);
      setMaintenanceFocus(maintenancePage() * MAINTENANCE_PAGE_SIZE);
    }
  }

  function setMaintenanceIndex(index: number) {
    if (maintenanceLoading() || busy()) return;
    const count = offlinePlan()?.selectedFamilies.length ?? 0;
    if (count === 0) return;
    const clamped = Math.max(0, Math.min(count - 1, index));
    setMaintenanceFocus(clamped);
    setMaintenancePage(Math.floor(clamped / MAINTENANCE_PAGE_SIZE));
  }

  let runInFlight = false;
  async function run(action: () => Promise<void>) {
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
    setMaintenanceError(undefined);
    setMaintenancePage(0);
    setMaintenanceFocus(0);
    setMessage("Inspeccionando base de datos y calculando lote de mantenimiento…");
    try {
      // Obtain fast filesystem metadata synchronously before expensive inspect/plan
      const q = helperClient.getQuickDiskStats();
      if (isMounted()) setQuickDisk(q);

      // Check claimed state (incident 57 / interrupted worker detection)
      const claimed = typeof helperClient.inspectClaimed === "function" ? await helperClient.inspectClaimed() : null;
      if (isMounted()) setClaimedReport(claimed ?? undefined);

      // Check receipts and armed plan
      const r = await helperClient.getReceipt();
      if (isMounted()) setReceipt(r ?? undefined);

      const armed = await helperClient.getArmed();
      if (isMounted()) setArmedPlan(armed ?? undefined);

      // Read-only inspection
      const insp = await helperClient.inspectDatabase();
      if (isMounted()) setDbInspect(insp);

      // Read-only plan generation
      const offPlan = await helperClient.generatePlan({
        projectID: options.service.projectID,
      });
      if (isMounted()) {
        setOfflinePlan(offPlan);
        setMaintenancePage(0);
        setMaintenanceFocus(0);
        if (claimed) {
          setMessage("Mantenimiento suspendido: operación interrumpida / exclusión no garantizada");
        } else if (!options._trustedTestExecution) {
          setMessage("Mantenimiento suspendido: operación interrumpida / exclusión no garantizada");
        } else {
          const count = offPlan.selectedFamilies.length;
          setMessage(
            count > 0
              ? `${count} familias candidatas en lote fuera de línea. Revisa el lote completo antes de aprobar.`
              : "0 familias candidatas en mantenimiento fuera de línea."
          );
        }
      }
    } catch (err) {
      if (isMounted()) {
        const text = errorText(err);
        setMaintenanceError(text);
        setMessage(text);
        setOfflinePlan(undefined);
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
          helperClient: typeof helperClient.inspectClaimed === "function" ? helperClient : undefined,
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
      setManualApiReason(undefined);
    }

    try {
      const next = await options.service.preview({
        liveness: isPreview,
        signal: options.signal,
        manualApi,
      });
      const settings = await options.service.store.read();
      if (!isMounted()) return;
      setPlan(next);
      setLivePlan(isPreview);
      setState(settings);
      options.onPlanUpdate?.(next);
      setInventoryError(false);
      const unverifiedCount = next.families.filter(f => f.reasons.includes("Actividad no verificada")).length;
      const unverifiedSuffix = unverifiedCount > 0 ? ` · ${unverifiedCount} sin verificar protegidas` : "";
      if (isPreview && manualApi) {
        const candidateCount = next.candidates.length;
        setMessage(
          candidateCount > 0
            ? `Lote por API: ${candidateCount} ${candidateCount === 1 ? "familia candidata" : "familias candidatas"} (máx. 5). Borrado seguro con respaldo.${unverifiedSuffix}`
            : `0 familias candidatas en este lote por API.${unverifiedSuffix}`
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

  // Check pending receipt or armed status on controller init
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
    } catch {}
  })();

  function go(next: Screen) {
    if (next !== "preview") {
      setLivePlan(false);
    }
    setScreen(next);
    options.onNavigate?.(next);
    if (next === "maintenance") {
      void loadMaintenance();
    } else if (next === "list" && plan()) {
      const p = plan()!;
      const unverifiedCount = p.families.filter(f => f.reasons.includes("Actividad no verificada")).length;
      const unverifiedSuffix = unverifiedCount > 0 ? ` · ${unverifiedCount} sin verificar protegidas` : "";
      setMessage(`${p.candidates.length} familias candidatas${unverifiedSuffix}. El candado siempre tiene prioridad.`);
    }
  }

  async function openPreview() {
    if (busy() && screen() === "preview") return;
    if (busy()) {
      go("preview");
      setPlan(undefined);
      setLivePlan(false);
      await refresh();
    } else {
      await run(async () => {
        go("preview");
        setPlan(undefined);
        setLivePlan(false);
        await refresh();
      });
    }
  }

  function isApprovedPlanValid(approved?: Plan): boolean {
    if (screen() !== "preview") return false;
    if (!livePlan()) return false;
    if (!manualApiAvailable()) return false;
    const currentPlan = plan();
    if (!currentPlan || !approved || currentPlan !== approved) return false;
    return approved.candidates.length > 0 && approved.candidates.length <= 5;
  }

  function canClean(): boolean {
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
      async value => {
        if (value !== "LIMPIAR") {
          throw new Error("Escribe LIMPIAR para confirmar.");
        }
        if (executed) {
          return;
        }
        if (!isApprovedPlanValid(approved)) {
          options.closeConfirmation?.();
          setPlan(undefined);
          setLivePlan(false);
          throw new Error("La vista previa no es válida o está desactualizada.");
        }
        executed = true;
        try {
          const metricsBackend = typeof helperClient.getQuickDiskStats === "function"
            ? { getDiskStats: () => helperClient.getQuickDiskStats() }
            : undefined;
          const result = await options.service.cleanup(approved, false, { manualApi: true, metricsBackend });
          options.closeConfirmation?.();
          const outcome: ManualApiOutcome = {
            operationId: result.operationId,
            timestamp: result.timestamp ?? Date.now(),
            status: result.status ?? (result.error ? (result.deleted.length > 0 ? "partial" : "failed") : "success"),
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
            walSizeBytesAfter: result.walSizeBytesAfter,
          };
          setLastManualResult(outcome);
          await refresh();
          go("list");
          setMessage(
            `${result.deleted.length} familias eliminadas por API · ${result.skipped.length} omitidas${
              result.error ? ` · ${result.error}` : " · respaldos guardados"
            }`
          );
          setOperationError(Boolean(result.error));
        } catch (err) {
          options.closeConfirmation?.();
          try {
            const outcome = await options.service.store.getLastManualApiOutcome();
            if (isMounted() && outcome) {
              setLastManualResult(outcome);
            }
          } catch {}
          // Invalidate approved plan before retry unsafe, but PRESERVE INVENTORY for readonly browsing & pins!
          setLivePlan(false);
          setOperationError(true);
          throw err;
        }
      },
      "Borrado seguro mediante API oficial de OpenCode. El tamaño del archivo SQLite en disco no se reduce sin compactación fuera de línea (VACUUM)."
    );
  }

  function canArmMaintenance(): boolean {
    // In production without trusted test injection, arming is centrally disabled.
    if (!options._trustedTestExecution) return false;
    // Pending claim blocks arming even in test mode
    if (Boolean(claimedReport())) return false;
    if (maintenanceLoading() || busy() || Boolean(maintenanceError())) return false;
    if (Boolean(armedPlan())) return false;
    const currentOfflinePlan = offlinePlan();
    return Boolean(currentOfflinePlan && currentOfflinePlan.selectedFamilies.length > 0);
  }

  function armMaintenance() {
    if (!options._trustedTestExecution) {
      setMessage("Mantenimiento suspendido: operación interrumpida / exclusión no garantizada");
      return;
    }
    if (!canArmMaintenance()) {
      if (claimedReport()) {
        setMessage("Mantenimiento suspendido: operación interrumpida / exclusión no garantizada");
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
      async value => {
        if (value !== "LIMPIAR") throw new Error("Escribe LIMPIAR para confirmar el armado.");
        if (offlinePlan() !== currentOfflinePlan) {
          throw new Error("El plan de mantenimiento cambió o fue invalidado. Revisa el nuevo lote.");
        }
        const result = await helperClient.armAndSpawn({
          plan: currentOfflinePlan,
          ownerPid: process.pid,
          ttlMs: 5 * 60 * 1000,
          _trustedTestExecution: true,
        });
        setArmedPlan(result.armed);
        setMessage(
          "Monitor visible activo. Cierra todas las instancias de OpenCode en <5m. El monitor indicará cuándo volver a abrirlo."
        );
      },
      "Se abrirá una ventana de monitorización visible. Tras confirmar, cierra OpenCode en <5m. El monitor indicará cuándo es seguro volver a abrirlo."
    );
  }

  async function cancelMaintenance() {
    await helperClient.cancelArmed();
    setArmedPlan(undefined);
    setMessage("Mantenimiento en espera cancelado. No se realizarán cambios.");
    await loadMaintenance();
  }

  async function dismissReceipt() {
    await helperClient.getReceipt(true);
    setReceipt(undefined);
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
    loadLastManualResult,
  };
}
