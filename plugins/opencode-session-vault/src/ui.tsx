/** @jsxImportSource @opentui/solid */
import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { PROFILES, errorText, safeText, emptyInventoryMessage, inventoryCountLabel, formatBytes, formatDeltaBytes, type Family, type Plan, type Profile, type State } from "./model.ts";
import { familyFingerprint } from "./policy.ts";
import { listBackups, type ArchiveManifest } from "./archive.ts";
import type { VaultService } from "./service.ts";
import { createVaultNavigationController, type Screen } from "./ui-controller.ts";

export const COLOR = { bg: "#0B111B", panel: "#111E2E", line: "#284967", blue: "#5FAFFF", cyan: "#63E6E2",
  text: "#E1EDFA", muted: "#91A8C1", green: "#72DEA8", red: "#FF8799", amber: "#F4CB80", selected: "#17334D" };
const bytesLabel = (n: number) => formatBytes(n);
const dateLabel = (n: number) => new Date(n).toLocaleString("es", { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
type Entry = { title: string; placeholder: string; description?: string; action: (value: string) => Promise<void> };

function Button(props: { label: string; action: () => void; danger?: boolean; selected?: boolean }) {
  return <box paddingLeft={1} paddingRight={1} height={1} flexShrink={0} backgroundColor={props.selected ? COLOR.selected : COLOR.panel}
    onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); props.action(); }}>
    <text height={1} truncate fg={props.danger ? COLOR.red : COLOR.blue}>{props.label}</text>
  </box>;
}
function Keycap(props: { keyText: string; label: string; highlight?: boolean }) {
  return (
    <box flexDirection="row" gap={0} flexShrink={0} height={1}>
      <box backgroundColor="#17334D" paddingLeft={1} paddingRight={1} height={1}>
        <text fg={props.highlight ? COLOR.amber : COLOR.cyan} attributes={1}>{props.keyText}</text>
      </box>
      <box paddingLeft={1} paddingRight={1} height={1}>
        <text fg={COLOR.text}>{props.label}</text>
      </box>
    </box>
  );
}
function Metric(props: { value: string; label: string; color?: string; action?: () => void }) {
  return <box flexDirection="column" flexGrow={1} paddingLeft={1} borderStyle="single" borderColor={COLOR.line}
    onMouseDown={e => { if (props.action && e.button === 0) { e.preventDefault(); e.stopPropagation(); props.action(); } }}>
    <text fg={props.color || COLOR.text} attributes={1}>{props.value}</text><text fg={COLOR.muted}>{props.label}</text>
  </box>;
}

export function VaultApp(props: { api: Pick<TuiPluginApi, "ui"> & Partial<Pick<TuiPluginApi, "keymap">>; service: VaultService; onClose: () => void; inHostDialog?: boolean; helperClient?: any }) {
  const dimensions = useTerminalDimensions();
  let mounted = true;
  const abortController = new AbortController();
  const [query, setQuery] = createSignal("");
  const [searching, setSearching] = createSignal(false);
  const [focus, setFocus] = createSignal(0);
  const [entry, setEntry] = createSignal<Entry>();
  const [draft, setDraft] = createSignal("");
  const [archives, setArchives] = createSignal<ArchiveManifest[]>([]);
  const [sizes, setSizes] = createSignal<Record<string, { fingerprint: string; bytes: number }>>({});
  const [detail, setDetail] = createSignal<Family>();

  function ask(title: string, placeholder: string, action: Entry["action"], description?: string) { setDraft(""); setEntry({ title, placeholder, action, description }); }

  const controller = createVaultNavigationController({
    service: props.service,
    manualApi: true,
    signal: abortController.signal,
    isMounted: () => mounted,
    onClose: props.onClose,
    askConfirmation: ask,
    closeConfirmation: () => setEntry(undefined),
    helperClient: props.helperClient,
    onPlanUpdate: next => {
      setFocus(i => Math.min(i, Math.max(0, next.families.length - 1)));
    },
    onNavigate: () => {
      setFocus(0);
      setQuery("");
      setSearching(false);
      setEntry(undefined);
    },
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
    dbStatsError,
  } = controller;

  const compact = () => dimensions().width < 100;
  const showMetrics = () => dimensions().height >= 38;
  const isMaintenance = () => screen() === "maintenance";
  const bannerHeight = () => {
    if (!lastManualResult() || (screen() !== "list" && screen() !== "preview")) return 0;
    return showLastManualDetail() ? 7 : 4;
  };

  const dbSizeDisplay = () => {
    if (dbInspect()?.sizeBytes !== undefined) {
      return formatBytes(dbInspect()!.sizeBytes);
    }
    if (quickDisk()?.exists && quickDisk()?.sizeBytes !== undefined) {
      return formatBytes(quickDisk()!.sizeBytes);
    }
    if (dbStatsLoading()) return "Detectando…";
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
    if (dbInspect()?.freeBytes !== undefined) {
      return formatBytes(dbInspect()!.freeBytes);
    }
    if (dbStatsLoading()) return "Calculando…";
    return "No disponible";
  };

  const backupCostDisplay = () => {
    const total = archives().reduce((acc, a) => acc + a.files.reduce((n, f) => n + f.compressed, 0), 0);
    return formatBytes(total);
  };
  const metricsFamilies = () => {
    if (isMaintenance()) {
      if (maintenanceLoading() || maintenanceError() || !offlinePlan()) return "—";
      return String(offlinePlan()!.totalFamilies);
    }
    return plan() ? String(plan()!.families.length) : "—";
  };
  const metricsLocked = () => {
    if (isMaintenance()) {
      if (maintenanceLoading() || maintenanceError() || !offlinePlan()) return "—";
      return String(offlinePlan()!.statePins.length);
    }
    return plan() ? String(plan()!.locked) : "—";
  };
  const metricsQuota = () => {
    if (isMaintenance()) {
      if (maintenanceLoading() || maintenanceError() || !offlinePlan()) return "—";
      return String(offlinePlan()!.quota.keep);
    }
    return plan() ? String(plan()!.quota.keep) : "—";
  };
  const metricsCandidates = () => {
    if (isMaintenance()) {
      if (maintenanceLoading() || maintenanceError() || !offlinePlan()) return "—";
      return String(offlinePlan()!.selectedFamilies.length);
    }
    return plan() ? String(plan()!.candidates.length) : "—";
  };
  const pageSize = () => Math.max(2, Math.min(14, dimensions().height - (showMetrics() ? 29 : 26) - (screen() === "preview" ? 3 : 0) - bannerHeight()));
  const contentHeight = () => Math.max(3, dimensions().height - (showMetrics() ? 26 : (isMaintenance() ? 23 : 20)));
  const rows = createMemo(() => (screen() === "preview" ? plan()?.candidates ?? [] : plan()?.families ?? [])
    .filter(f => `${f.root.title} ${f.root.id} ${f.root.directory}`.toLowerCase().includes(query().toLowerCase())));
  const pageStart = () => Math.floor(Math.min(focus(), Math.max(0, rows().length - 1)) / pageSize()) * pageSize();
  const visible = () => rows().slice(pageStart(), pageStart() + pageSize());
  const selected = () => rows()[focus()];
  const selectedPinned = (f: Family) => f.members.some(s => state()?.pins.includes(s.id));
  const back = () => {
    if (busy()) return;
    if (entry()) { setEntry(undefined); setDraft(""); } else if (searching()) setSearching(false); else if (screen() !== "list") go("list"); else props.onClose();
  };
  onMount(() => {
    void run(refresh);
    void listBackups(props.service.store).then(setArchives).catch(() => {});
    const off = props.api.keymap?.registerLayer({ priority: 2000, mode: "modal", commands: [{ name: "session-vault.back", title: "Session Vault back", run: () => { back(); return true; } }], bindings: [{ key: "escape", cmd: "session-vault.back" }] });
    if (off) onCleanup(off);
  });
  onCleanup(() => {
    abortController.abort();
    mounted = false;
  });
  async function submitEntry() { const e = entry(); if (!e) return; await e.action(draft()); setEntry(undefined); }
  async function setProfile(profile: Profile, percent?: number) {
    await props.service.configure({ profile, ...(percent !== undefined ? { percent } : {}) }, true);
    await refresh(); go("list");
  }
  function chooseProfile(profile: Profile) {
    if (profile === "mod") ask("Porcentaje a conservar", "Número entero entre 1 y 100", async value => {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new Error("Escribe un número entero de 1 a 100.");
      await setProfile(profile, Number(value));
    });
    else void run(() => setProfile(profile));
  }
  function togglePin(f = selected()) {
    if (!f) return;
    void run(async () => {
      if (selectedPinned(f) && !state()?.pins.includes(f.root.id)) throw new Error("El candado pertenece a una hija. Abre sus detalles para quitar ese candado.");
      await props.service.pin(f.root.id); await refresh();
    });
  }
  async function viewDetail(f = selected()) {
    if (!f) return;
    setDetail(f); go("detail"); setMessage("Calculando tamaño lógico de la conversación…");
    let bytes = 0;
    for (const member of f.members) bytes += Buffer.byteLength(JSON.stringify(await props.service.gateway.exportSession(member, { signal: abortController.signal })));
    setSizes(previous => ({ ...previous, [f.root.id]: { fingerprint: familyFingerprint(f), bytes } }));
    setMessage("Tamaño del JSON exportable. No equivale al espacio recuperable del archivo SQLite.");
  }
  function setting(action: string) {
    const c = state()?.config; if (!c) return;
    if (action === "a") {
      if (c.automatic) void run(async () => { await props.service.configure({ automatic: false }); await refresh(); });
      else ask("Activar limpieza automática", "Escribe ACTIVAR", async value => {
        if (value !== "ACTIVAR") throw new Error("Escribe ACTIVAR para confirmar.");
        await props.service.configure({ automatic: true }); await refresh();
        setMessage("Automático activo mientras OpenCode esté abierto y este panel cerrado. Usa una sola instancia de OpenCode.");
      });
    } else if (action === "s") void run(async () => { await props.service.configure({ scope: c.scope === "global" ? "project" : "global" }); await refresh(); });
    else if (action === "h") void run(async () => { await props.service.configure({ includeArchived: !c.includeArchived }); await refresh(); });
    else if (["t", "i", "b"].includes(action)) {
      const fields = { t: ["Horas mínimas sin actividad", "graceHours", 1, 8760], i: ["Intervalo en minutos", "intervalMinutes", 5, 10080], b: ["Máximo de familias por limpieza", "maxDeletePerRun", 1, 100] } as const;
      const [title, field, min, max] = fields[action as keyof typeof fields];
      ask(title, `${min} a ${max}`, async value => {
        const n = Number(value); if (!/^\d+$/.test(value) || n < min || n > max) throw new Error(`Escribe un entero de ${min} a ${max}.`);
        await props.service.configure({ [field]: n }); await refresh();
      });
    } else if (action === "r") ask("Recalcular cupo sobre las familias actuales", "Escribe RECALCULAR", async value => {
      if (value !== "RECALCULAR") throw new Error("Escribe RECALCULAR para confirmar.");
      await props.service.configure({}, true); await refresh();
    });
  }
  async function openBackups() { setArchives(await listBackups(props.service.store)); go("backups"); }
  useKeyboard(key => {
    if (key.name === "escape") {
      key.preventDefault(); key.stopPropagation();
      back();
      return;
    }
    if (busy() || (screen() === "maintenance" && maintenanceLoading())) {
      key.preventDefault(); key.stopPropagation();
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
    else if (screen() === "profiles" && /^[1-5]$/.test(name)) chooseProfile(Object.keys(PROFILES)[Number(name) - 1] as Profile);
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
    }
    else if (["list", "preview"].includes(screen())) {
      if (["up", "k", "down", "j", "pageup", "pagedown", "home", "end"].includes(name)) {
        const delta = ["up", "k"].includes(name) ? -1 : ["down", "j"].includes(name) ? 1 : name === "pageup" ? -pageSize() : pageSize();
        setFocus(i => name === "home" ? 0 : name === "end" ? Math.max(0, rows().length - 1) : Math.max(0, Math.min(rows().length - 1, i + delta)));
      } else if (name === "space" || name === "l") togglePin();
      else if (name === "/") setSearching(true);
      else if (name === "r") void run(refresh);
      else if (name === "i" || (name === "return" && screen() === "list")) void run(() => viewDetail());
      else if (name === "v") void openPreview();
      else if (name === "b") void run(openBackups);
      else if (name === "c" && screen() === "preview" && canClean()) clean();
      else if (name === "u" && lastManualResult()) toggleLastManualDetail();
      else if (name === "x" && lastManualResult()) dismissLastManualResult();
      else handled = false;
    } else handled = false;
    if (handled) { key.preventDefault(); key.stopPropagation(); }
  });
  const size = (f: Family) => {
    const value = sizes()[f.root.id]; return value?.fingerprint === familyFingerprint(f) ? bytesLabel(value.bytes) : "—";
  };
  const rowColor = (f: Family) => selectedPinned(f) ? COLOR.green : f.reasons.length ? COLOR.text : COLOR.red;
  return <box flexDirection="column" backgroundColor={COLOR.bg} borderStyle="rounded" borderColor={COLOR.blue} paddingLeft={1} paddingRight={1}
    width="100%" marginTop={props.inHostDialog ? -Math.floor(dimensions().height / 4) + 1 : 0} maxHeight={Math.max(15, dimensions().height - 4)}>
    <box flexDirection="row" justifyContent="space-between" paddingTop={1} height={2} flexShrink={0}>
      <text fg={COLOR.blue} attributes={1}>SESSION VAULT</text>
      <Button label="[g] ⚙ Configuración" action={() => go("settings")} />
    </box>
    <text height={1} flexShrink={0} truncate fg={COLOR.muted}>BASE DE DATOS DE OPENCODE · {screen() === "list" ? "Tus sesiones, bajo control" : ({ settings: "Configuración", profiles: "Perfiles de retención", preview: "Vista previa del borrado", backups: "Respaldos locales", detail: "Detalle de la familia", maintenance: "Mantenimiento y disco" }[screen() as Exclude<Screen, "list">])}</text>
    <Show when={showMetrics()} fallback={<text height={1} flexShrink={0} fg={COLOR.cyan}>Familias {metricsFamilies()} · Candados {metricsLocked()} · Cupo {metricsQuota()} · Candidatas {metricsCandidates()}</text>}>
    <box flexDirection="row" gap={1} marginTop={1} height={4} flexShrink={0}>
      <Metric value={metricsFamilies()} label="Familias" />
      <Metric value={metricsLocked()} label="Candados" color={COLOR.green} />
      <Metric value={metricsQuota()} label="Cupo" color={COLOR.cyan} />
      <Metric value={metricsCandidates()} label="Candidatas" color={COLOR.red} action={isMaintenance() ? undefined : () => void openPreview()} />
    </box>
    </Show>
    <Show when={screen() === "list"}>
      <box flexDirection="row" height={1} flexShrink={0} justifyContent="space-between" paddingLeft={1} paddingRight={1} backgroundColor={COLOR.panel} marginTop={1}>
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={COLOR.cyan} attributes={1}>Base de datos: {dbSizeDisplay()}{walDisplay()}</text>
          <text fg={COLOR.muted}>·</text>
          <text fg={COLOR.text}>Reutilizable: {freeSpaceDisplay()}</text>
        </box>
        <Show when={!compact()}>
          <text fg={COLOR.muted} truncate>Respaldos Vault: {backupCostDisplay()}</text>
        </Show>
      </box>
    </Show>
    <Show when={entry()} fallback={<>
      <Show when={screen() === "list" || screen() === "preview"}>
        <Show when={screen() === "preview"}>
          <text height={1} flexShrink={0} truncate fg={COLOR.amber}>
            {manualApiAvailable()
              ? "Lote por API: hasta 5 familias, primero las más antiguas. Respaldo verificado antes de borrar."
              : "Limpieza manual: suspendida mientras haya tareas fuera de línea o estado no verificado."}
          </text>
          <text height={1} flexShrink={0} truncate fg={COLOR.muted}>
            Aviso de almacenamiento: El tamaño de la base SQLite en disco no se reduce sin compactación fuera de línea (VACUUM).
          </text>
          <Button label="[m] Ir a Mantenimiento fuera de línea (sin CLI)" action={() => go("maintenance")} selected />
        </Show>
        <Show when={lastManualResult()}>
          <box flexDirection="column" borderStyle="single"
            borderColor={lastManualResult()?.status === "success" ? COLOR.green : lastManualResult()?.status === "partial" ? COLOR.amber : COLOR.red}
            paddingLeft={1} paddingRight={1} marginTop={1} flexShrink={0}>
            <box flexDirection="row" justifyContent="space-between" height={1} flexShrink={0}>
              <text fg={lastManualResult()?.status === "success" ? COLOR.green : lastManualResult()?.status === "partial" ? COLOR.amber : COLOR.red} attributes={1}>
                ÚLTIMA OPERACIÓN POR API · {lastManualResult()?.status === "success" ? "✔ ÉXITO" : lastManualResult()?.status === "partial" ? "⚠ PARCIAL" : "❌ FALLIDO"}
              </text>
              <box flexDirection="row" gap={1}>
                <Button label={showLastManualDetail() ? "[u] Menos" : "[u] Detalle"} action={toggleLastManualDetail} />
                <Button label="[x] Ocultar" action={dismissLastManualResult} />
              </box>
            </box>
            <box flexDirection="row" justifyContent="space-between" height={1} flexShrink={0}>
              <text fg={COLOR.text} truncate>
                {lastManualResult()?.deletedFamiliesCount} {lastManualResult()?.deletedFamiliesCount === 1 ? "familia" : "familias"} ({lastManualResult()?.deletedSessionsCount !== undefined ? `${lastManualResult()?.deletedSessionsCount} sesiones` : "sesiones: no disponible"}) · {dateLabel(lastManualResult()?.timestamp ?? 0)}
              </text>
              <text fg={COLOR.muted} truncate>
                {lastManualResult()?.backupVerified ? "Respaldos verificados (SHA-256)" : "Verificación no registrada"}
              </text>
            </box>
            <Show when={lastManualResult()?.dbSizeDeltaBytes !== undefined}>
              <box flexDirection="row" height={1} flexShrink={0} marginTop={0}>
                <text fg={COLOR.cyan} truncate>
                  Variación observada: {formatDeltaBytes(lastManualResult()!.dbSizeDeltaBytes!)}
                </text>
              </box>
            </Show>
            <Show when={showLastManualDetail()}>
              <box flexDirection="column" marginTop={1} gap={0} flexShrink={0}>
                <Show when={lastManualResult()?.operationId}>
                  <text fg={COLOR.muted}>Operación: {safeText(lastManualResult()?.operationId?.slice(0, 24))}</text>
                </Show>
                <Show when={lastManualResult()?.targetFamiliesCount !== undefined}>
                  <text fg={COLOR.text}>
                    Lote solicitado: {lastManualResult()?.targetFamiliesCount} familias ({lastManualResult()?.targetSessionsCount !== undefined ? `${lastManualResult()?.targetSessionsCount} sesiones` : "sesiones: no disponible"})
                  </text>
                </Show>
                <Show when={(lastManualResult()?.archivesCount ?? 0) > 0}>
                  <text fg={COLOR.text}>Respaldos guardados: {lastManualResult()?.archivesCount}</text>
                </Show>
                <Show when={lastManualResult()?.dbSizeBytesBefore !== undefined && lastManualResult()?.dbSizeBytesAfter !== undefined}>
                  <text fg={COLOR.text}>
                    Archivo en disco: {bytesLabel(lastManualResult()!.dbSizeBytesBefore!)} → {bytesLabel(lastManualResult()!.dbSizeBytesAfter!)} (variación neta: {formatDeltaBytes(lastManualResult()!.dbSizeDeltaBytes!)})
                  </text>
                  <text fg={COLOR.muted}>
                    Medición física neta de archivo. Variación observada sin atribución causal (OpenCode escribe concurrentemente).
                  </text>
                </Show>
                <Show when={lastManualResult()?.uncertainDescendants}>
                  <text fg={COLOR.amber}>Aviso: Resultado en descendientes incierto por error de API OpenCode.</text>
                </Show>
                <Show when={lastManualResult()?.error}>
                  <text fg={COLOR.red} wrapMode="word">Error: {safeText(lastManualResult()?.error)}</text>
                </Show>
              </box>
            </Show>
          </box>
        </Show>
        <box marginTop={1} borderStyle="single" borderColor={searching() ? COLOR.cyan : COLOR.line} height={3} flexShrink={0}>
          <input focused={searching()} value={query()} placeholder="[/] Buscar título, ID o proyecto…" onInput={v => { setQuery(v); setFocus(0); }}
            onSubmit={() => setSearching(false)} onMouseDown={() => setSearching(true)} />
        </box>
        <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1} paddingRight={1} backgroundColor={COLOR.panel}>
          <text width={7} fg={COLOR.muted}>LOCK</text><Show when={!compact()}><text width={12} fg={COLOR.muted}>ID</text></Show>
          <text flexGrow={1} fg={COLOR.muted}>SESIÓN / PROYECTO</text><text width={18} fg={COLOR.muted}>ÚLTIMA ACTIVIDAD</text>
          <Show when={!compact()}><text width={10} fg={COLOR.muted}>JSON ≈</text></Show>
        </box>
        <box flexDirection="column" height={pageSize()} flexShrink={0} onMouseScroll={e => { setFocus(i => Math.max(0, Math.min(rows().length - 1, i + (e.scroll?.direction === "up" ? -1 : 1)))); }}>
          <For each={visible()}>{(f, index) => <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1}
            backgroundColor={focus() === pageStart() + index() ? COLOR.selected : COLOR.bg}
            onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); setFocus(pageStart() + index()); }}>
            <box width={7} onMouseDown={e => { if (e.button !== 0) return; e.stopPropagation(); togglePin(f); }}>
              <text fg={rowColor(f)}>{selectedPinned(f) ? "● LOCK" : "○"}</text>
            </box>
            <Show when={!compact()}><text width={12} fg={COLOR.muted}>{f.root.id.slice(-10)}</text></Show>
            <text flexGrow={1} flexShrink={1} truncate fg={rowColor(f)}>{safeText(f.root.title)}{f.members.length > 1 ? ` (+${f.members.length - 1})` : ""}</text>
            <text width={18} fg={rowColor(f)}>{dateLabel(f.updated)}</text>
            <Show when={!compact()}><text width={10} fg={COLOR.muted}>{size(f)}</text></Show>
          </box>}</For>
          <Show when={!rows().length}><text fg={COLOR.muted}>{emptyInventoryMessage({ busy: busy(), error: inventoryError(), hasPlan: Boolean(plan()) })}</text></Show>
        </box>
        <box flexDirection="row" height={1} flexShrink={0} justifyContent="space-between" backgroundColor={COLOR.panel}>
          <text fg={COLOR.muted}>{inventoryCountLabel({ count: rows().length, pageStart: pageStart(), pageSize: pageSize(), busy: busy(), error: inventoryError(), hasPlan: Boolean(plan()) })}</text>
          <text fg={selected() && !selected()!.reasons.length ? COLOR.red : COLOR.green}>{selected()?.reasons.join(" · ") || (selected() ? "Candidata a limpieza" : "")}</text>
        </box>
        <text height={1} flexShrink={0} truncate fg={COLOR.muted}>{safeText(selected()?.root.directory)}</text>
      </Show>
      <Show when={screen() === "profiles"}>
        <scrollbox height={contentHeight()} flexShrink={0} marginTop={1}>
        <box flexDirection="column" gap={1}>
          <For each={Object.entries(PROFILES)}>{([id, profile], i) => <Button label={`[${i() + 1}] ${profile.label}${state()?.config.profile === id ? "  ✓ ACTUAL" : ""}`} action={() => chooseProfile(id as Profile)} selected={state()?.config.profile === id} />}</For>
          <text fg={COLOR.muted}>El porcentaje establece un cupo fijo sobre familias sin candado.</text>
          <text fg={COLOR.muted}>Se redondea hacia arriba. Mínimo: 1. Los candados se conservan además del cupo.</text>
        </box>
        </scrollbox>
      </Show>
      <Show when={screen() === "settings"}>
        <scrollbox height={contentHeight()} flexShrink={0} marginTop={1}>
        <box flexDirection="column" gap={1}>
          <Button label={`[a] Automático: ${state()?.config.automatic ? "ACTIVO" : "PAUSADO"}`} action={() => setting("a")} />
          <Button label={`[s] Alcance de limpieza: ${state()?.config.scope === "global" ? "Global (todos los proyectos)" : "Proyecto actual"}`} action={() => setting("s")} />
          <Button label={`[t] Conservar actividad de las últimas ${state()?.config.graceHours} horas`} action={() => setting("t")} />
          <Button label={`[i] Revisar cada ${state()?.config.intervalMinutes} minutos`} action={() => setting("i")} />
          <Button label={`[b] Máximo ${state()?.config.maxDeletePerRun} familias por limpieza`} action={() => setting("b")} />
          <Button label={`[h] Aplicar reglas a archivadas: ${state()?.config.includeArchived ? "Sí" : "No"}`} action={() => setting("h")} />
          <Button label="[r] Recalcular cupo porcentual" action={() => setting("r")} />
          <Button label="[m] Mantenimiento y compactación fuera de línea" action={() => go("maintenance")} />
          <text fg={COLOR.amber}>Automático: usa una sola instancia de OpenCode. Respalda conversaciones antes de borrar.</text>
          <text fg={COLOR.muted}>La sesión abierta, las que trabajan y aquellas con actividad no verificada quedan protegidas.</text>
        </box>
        </scrollbox>
      </Show>
      <Show when={screen() === "backups"}>
        <scrollbox height={Math.max(5, dimensions().height - 23)}>
          <For each={archives()}>{a => <box flexDirection="column" marginBottom={1}>
            <text fg={COLOR.cyan}>{dateLabel(a.created)} · {safeText(a.title)} · {bytesLabel(a.files.reduce((n, f) => n + f.compressed, 0))}</text>
            <text fg={COLOR.muted}>{a.id} · {a.status} · {a.files.length} sesiones</text>
          </box>}</For>
          <Show when={!archives().length}><text fg={COLOR.muted}>Todavía no hay respaldos.</text></Show>
        </scrollbox>
        <text fg={COLOR.amber}>Recupera el chat con RESTAURAR y el ID del respaldo. Los archivos externos y eventos internos no se restauran.</text>
        <text fg={COLOR.muted} wrapMode="word">{safeText(props.service.store.dir)}</text>
      </Show>
      <Show when={screen() === "maintenance"}>
        <scrollbox height={contentHeight()} flexShrink={0} marginTop={1}>
        <box flexDirection="column" gap={1}>
          <Show when={receipt()}>
            <box flexDirection="column" padding={1} borderStyle="single" borderColor={receipt()?.status === "success" ? COLOR.green : receipt()?.status === "partial_success" ? COLOR.amber : COLOR.red}>
              <text fg={receipt()?.status === "success" ? COLOR.green : receipt()?.status === "partial_success" ? COLOR.amber : COLOR.red} attributes={1}>
                {receipt()?.status === "success" ? "✔ ÚLTIMO MANTENIMIENTO: ÉXITO" : receipt()?.status === "partial_success" ? "⚠ ÚLTIMO MANTENIMIENTO: PARCIAL" : "❌ ÚLTIMO MANTENIMIENTO: FALLIDO O EXPIRADO"}
              </text>
              <text fg={COLOR.text}>
                {receipt()?.status === "success"
                  ? `${receipt()?.deletedFamilies.length} familias eliminadas. ${bytesLabel(receipt()?.spaceFreedBytes ?? 0)} liberados en disco.`
                  : receipt()?.error || receipt()?.vacuumError || "Operación no completada."}
              </text>
              <Show when={receipt()?.backupPath}>
                <text fg={COLOR.muted}>Copia de seguridad guardada en: {safeText(receipt()?.backupPath)}</text>
              </Show>
              <Button label="[x] Descartar aviso de recibo" action={() => void dismissReceipt()} />
            </box>
          </Show>

          <Show when={claimedReport()}>
            <box flexDirection="column" padding={1} borderStyle="single" borderColor={COLOR.red} backgroundColor={COLOR.panel}>
              <text fg={COLOR.red} attributes={1}>⚠ MANTENIMIENTO SUSPENDIDO: OPERACIÓN INTERRUMPIDA</text>
              <text fg={COLOR.text}>Estado del proceso: {claimedReport()?.status === "interrupted" ? "Trabajador detenido sin generar recibo (interrumpido)" : claimedReport()?.status === "active" ? "Proceso activo" : "Estado del proceso desconocido / acceso denegado"}</text>
              <text fg={COLOR.text}>Identificador: {claimedReport()?.incidentInfo.armId} · Familias en lote: {claimedReport()?.incidentInfo.selectedFamilyCount} ({claimedReport()?.incidentInfo.totalSessionCount} sesiones)</text>
              <text fg={COLOR.amber}>Resultado en datos: INCIERTO hasta validación manual. NO se ha revertido automáticamente.</text>
              <text fg={COLOR.cyan}>Acción requerida: Conserva los archivos de respaldo (.sqlite). No inicies una nueva limpieza hasta verificar la integridad de la base.</text>
            </box>
          </Show>

          <Show when={armedPlan()}>
            <box flexDirection="column" padding={1} borderStyle="single" borderColor={COLOR.amber} backgroundColor={COLOR.panel}>
              <text fg={COLOR.amber} attributes={1}>⚡ PLAN DE MANTENIMIENTO ARMADO</text>
              <text fg={COLOR.text}>Cierra todas las instancias de OpenCode para ejecutar la limpieza con respaldo previo.</text>
              <text fg={COLOR.cyan}>Monitor visible activo en ventana independiente: indica cuándo es seguro reabrir.</text>
              <text fg={COLOR.muted}>Expira si OpenCode no se cierra en: {dateLabel(armedPlan()?.expiresAt ?? 0)}</text>
              <Button label="[c] Cancelar mantenimiento en espera" action={() => void run(cancelMaintenance)} danger />
            </box>
          </Show>

          <box flexDirection="column" borderStyle="single" borderColor={COLOR.line} padding={1}>
            <text fg={COLOR.cyan} attributes={1}>DATOS Y DISCO (VERDAD FÍSICA)</text>
            <text fg={COLOR.text}>Base de datos SQLite: {safeText(dbInspect()?.dbPath || quickDisk()?.dbPath || (maintenanceLoading() ? "Detectando…" : "No disponible"))}</text>
            <text fg={COLOR.text}>Tamaño en disco: {dbInspect() ? bytesLabel(dbInspect()!.sizeBytes) : quickDisk()?.exists ? bytesLabel(quickDisk()!.sizeBytes) : (maintenanceLoading() ? "Detectando…" : "No disponible")} · Páginas libres: {dbInspect() ? bytesLabel(dbInspect()!.freeBytes) : (maintenanceLoading() ? "Calculando…" : "No disponible")}</text>
            <text fg={COLOR.text}>Sesiones registradas en SQLite: {dbInspect() ? String(dbInspect()!.sessionCount) : (maintenanceLoading() ? "Contando…" : "No disponible")} · Integridad: {dbInspect() ? (dbInspect()!.integrity === "ok" ? "ok" : dbInspect()!.integrity === "pending" ? "Pendiente" : dbInspect()!.integrity) : (maintenanceLoading() ? "Pendiente" : "No verificada")}</text>
            <text fg={COLOR.text}>Respaldos archivados en Vault: {archives().length} ({bytesLabel(archives().reduce((acc, a) => acc + a.files.reduce((n, f) => n + f.compressed, 0), 0))})</text>
          </box>

          <box flexDirection="column" borderStyle="single" borderColor={COLOR.line} padding={1}>
            <text fg={COLOR.cyan} attributes={1}>LOTE DE LIMPIEZA FUERA DE LÍNEA</text>
            <Show when={maintenanceLoading()}>
              <text fg={COLOR.amber}>Calculando plan y verificando base de datos…</text>
            </Show>
            <Show when={maintenanceError()}>
              <text fg={COLOR.red}>{maintenanceError()}</text>
            </Show>
            <Show when={!maintenanceLoading() && !maintenanceError()}>
              <Show when={offlinePlan()} fallback={<text fg={COLOR.muted}>No hay plan de mantenimiento disponible.</text>}>
                <text fg={COLOR.text}>Familias totales: {offlinePlan()!.totalFamilies} · Conservadas por perfil/candados: {offlinePlan()!.retainedFamiliesCount}</text>
                <text fg={COLOR.text}>Familias candidatas en este lote: {offlinePlan()!.selectedFamilies.length}</text>
                <text fg={COLOR.text}>Espacio adicional requerido para respaldo: {bytesLabel(dbInspect()?.sizeBytes ?? quickDisk()?.sizeBytes ?? 0)} (almacenamiento para copia de seguridad, no ahorro)</text>

                <Show when={offlinePlan()!.selectedFamilies.length === 0}>
                  <text fg={COLOR.green}>No hay familias candidatas para borrar. Tu cuota y candados protegen todas las sesiones.</text>
                </Show>

                <Show when={offlinePlan()!.selectedFamilies.length > 0}>
                  <box flexDirection="row" justifyContent="space-between" marginTop={1}>
                    <text fg={COLOR.amber}>Lote exacto a eliminar (revisión completa navegable):</text>
                    <text fg={COLOR.muted}>Pág. {maintenancePage() + 1}/{maintenanceTotalPages()} ({maintenancePageStart() + 1}–{Math.min(maintenancePageStart() + 6, offlinePlan()!.selectedFamilies.length)} de {offlinePlan()!.selectedFamilies.length})</text>
                  </box>

                  <For each={maintenanceVisibleFamilies()}>{(f, i) => {
                    const globalIdx = () => maintenancePageStart() + i();
                    const isSelected = () => maintenanceFocus() === globalIdx();
                    return (
                      <box flexDirection="row" height={1} backgroundColor={isSelected() ? COLOR.selected : COLOR.bg}
                        onMouseDown={e => { if (e.button === 0) { e.preventDefault(); setMaintenanceIndex(globalIdx()); } }}>
                        <text fg={isSelected() ? COLOR.cyan : COLOR.text} truncate>
                          {" "}[{globalIdx() + 1}] {safeText(f.title || f.rootId)} ({f.memberIds.length} sesiones) · {dateLabel(f.updated)}
                        </text>
                      </box>
                    );
                  }}</For>

                  <box flexDirection="row" gap={1} marginTop={1}>
                    <Button label="[←/h] Anterior" action={prevMaintenancePage} selected={maintenancePage() > 0} />
                    <Button label="[→/l] Siguiente" action={nextMaintenancePage} selected={maintenancePage() < maintenanceTotalPages() - 1} />
                  </box>
                </Show>
              </Show>
            </Show>
          </box>

          <Button label="[r] Actualizar diagnóstico e inspección" action={() => void run(loadMaintenance)} />
        </box>
        </scrollbox>
      </Show>
      <Show when={screen() === "detail" && detail()}>
        <scrollbox height={Math.max(7, dimensions().height - 22)}>
          <text fg={COLOR.cyan} attributes={1}>{safeText(detail()?.root.title)}</text>
          <text fg={COLOR.text}>ID: {detail()?.root.id}</text>
          <text fg={COLOR.muted}>Proyecto: {safeText(detail()?.root.directory)}</text>
          <text fg={COLOR.text}>Última actividad familiar: {dateLabel(detail()!.updated)}</text>
          <text fg={COLOR.text}>Tamaño lógico: {size(detail()!)} · {detail()?.members.length} sesiones</text>
          <text fg={COLOR.amber}>Estado: {detail()?.reasons.join(" · ") || "Candidata a limpieza"}</text>
          <For each={detail()?.members}>{member => <Button label={`${state()?.pins.includes(member.id) ? "● LOCK" : "○"} ${safeText(member.title)} · ${member.id.slice(-10)}`} action={() => void run(async () => { await props.service.pin(member.id); await refresh(); })} />}</For>
        </scrollbox>
      </Show>
    </>}>
      <box flexDirection="column" gap={1} paddingTop={1} paddingBottom={1}>
        <text fg={COLOR.amber} attributes={1}>{entry()?.title}</text>
        <Show when={entry()?.description}>
          <text fg={COLOR.cyan} wrapMode="word">{entry()?.description}</text>
        </Show>
        <Show when={busy()} fallback={
          <>
            <text fg={COLOR.muted}>Enter confirma · Esc cancela</text>
            <input focused value={draft()} placeholder={entry()?.placeholder} onInput={setDraft} onSubmit={() => void run(submitEntry)}
              onKeyDown={e => { if (e.name === "escape") { e.preventDefault(); e.stopPropagation(); back(); } }} />
          </>
        }>
          <text fg={COLOR.cyan}>Procesando borrado seguro y respaldos en curso…</text>
          <text fg={COLOR.muted}>Por favor espera, no cierres esta ventana…</text>
        </Show>
      </box>
    </Show>
    <box flexDirection="column" flexShrink={0} borderStyle="single" borderColor={COLOR.blue} marginTop={1} paddingLeft={1} paddingRight={1} backgroundColor={COLOR.panel}>
      <box flexDirection="row" height={1} flexShrink={0} justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <Button label={`[p] ${state() ? PROFILES[state()!.config.profile].label : "Perfil"}`} action={() => go("profiles")} />
          <Button label="[m] Mantenimiento" action={() => go("maintenance")} selected={screen() === "maintenance"} />
        </box>
        <text fg={state()?.config.automatic ? COLOR.green : COLOR.amber}>{state()?.config.automatic ? "AUTO ON" : "AUTO PAUSADO"} · v0.1.0</text>
      </box>
      <box height={1} flexShrink={0} marginTop={0} onMouseDown={e => { if (e.button === 0 && screen() === "list") { e.preventDefault(); e.stopPropagation(); void openPreview(); } }}>
        <Show when={screen() === "list"}>
          <box flexDirection="row" height={1} flexShrink={0} gap={1} flexWrap="no-wrap">
            <Keycap keyText="↑↓" label="Mover" />
            <Keycap keyText="Espacio" label="Candado" />
            <Keycap keyText="[i]" label="Detalle" />
            <Keycap keyText="[v]" label="Previa" />
            <Show when={!compact()}>
              <Keycap keyText="[b]" label="Respaldos" />
            </Show>
            <Keycap keyText="Esc" label={compact() ? "Salir" : "Cerrar"} highlight />
          </box>
        </Show>
        <Show when={screen() === "preview"}>
          <box flexDirection="row" height={1} flexShrink={0} gap={1} flexWrap="no-wrap">
            <Keycap keyText="↑↓" label="Mover" />
            <Keycap keyText="[c]" label={compact() ? "Borrar API" : "Borrar por API"} highlight />
            <Keycap keyText="Esc" label="Volver" />
          </box>
        </Show>
        <Show when={screen() === "maintenance"}>
          <box flexDirection="row" height={1} flexShrink={0} gap={1} flexWrap="no-wrap">
            <Keycap keyText="↑↓" label={compact() ? "Sel" : "Seleccionar"} />
            <Keycap keyText="←→" label={compact() ? "Pág" : "Página"} />
            <Show when={armedPlan()}>
              <Keycap keyText="[c]" label={compact() ? "Cancelar" : "Cancelar espera"} highlight />
            </Show>
            <Show when={!armedPlan()}>
              <Keycap keyText="[a]" label={compact() ? "Armar" : "Armar lote"} highlight />
            </Show>
            <Keycap keyText="[r]" label={compact() ? "Act" : "Actualizar"} />
            <Keycap keyText="Esc" label="Volver" />
          </box>
        </Show>
        <Show when={screen() === "profiles"}>
          <box flexDirection="row" height={1} flexShrink={0} gap={1} flexWrap="no-wrap">
            <Keycap keyText="[1–5]" label="Elegir perfil" highlight />
            <Keycap keyText="Esc" label="Volver" />
          </box>
        </Show>
        <Show when={screen() === "settings"}>
          <box flexDirection="row" height={1} flexShrink={0} gap={1} flexWrap="no-wrap">
            <Keycap keyText="[a][s][t][i][b][h][r]" label="Opciones" />
            <Keycap keyText="Esc" label="Volver" />
          </box>
        </Show>
        <Show when={screen() === "backups" || screen() === "detail"}>
          <box flexDirection="row" height={1} flexShrink={0} gap={1} flexWrap="no-wrap">
            <Keycap keyText="Esc" label="Volver" highlight />
          </box>
        </Show>
      </box>
      <Show when={!entry()}>
        <Show when={screen() === "maintenance"}>
          <box flexDirection="column" gap={1} marginTop={1} flexShrink={0}>
            <Show when={maintenanceLoading()}>
              <Button label="[a] Calculando lote de mantenimiento…" action={() => {}} />
            </Show>
            <Show when={!maintenanceLoading() && maintenanceError()}>
              <Button label="[a] Error en diagnóstico (pulsa [r] para reintentar)" action={() => void run(loadMaintenance)} danger />
            </Show>
            <Show when={!maintenanceLoading() && !maintenanceError() && armedPlan()}>
              <Button label="[c] Cancelar mantenimiento en espera" action={() => void run(cancelMaintenance)} danger selected />
            </Show>
            <Show when={!maintenanceLoading() && !maintenanceError() && !armedPlan() && (!offlinePlan() || offlinePlan()!.selectedFamilies.length === 0)}>
              <Button label="Sin familias candidatas para mantenimiento" action={() => {}} />
            </Show>
            <Show when={!maintenanceLoading() && !maintenanceError() && !armedPlan() && offlinePlan() && offlinePlan()!.selectedFamilies.length > 0}>
              <Button
                label="Mantenimiento suspendido: operación interrumpida / exclusión no garantizada"
                action={() => {}}
                danger
              />
            </Show>
            <box flexDirection="row" gap={1} flexShrink={0}>
              <Button label="[←/h] Ant" action={prevMaintenancePage} selected={maintenancePage() > 0} />
              <Button label="[→/l] Sig" action={nextMaintenancePage} selected={maintenancePage() < maintenanceTotalPages() - 1} />
              <Button label="[r] Actualizar" action={() => void run(loadMaintenance)} />
              <Button label="← Volver a sesiones" action={() => go("list")} />
            </box>
          </box>
        </Show>
        <Show when={screen() === "preview" && canClean()}><Button label="[c] Borrar por API con respaldo…" danger action={clean} /></Show>
        <Show when={screen() !== "list" && screen() !== "maintenance"}><Button label="← Volver a sesiones" action={() => go("list")} /></Show>
      </Show>
    </box>
    <text height={2} flexShrink={0} fg={error() ? COLOR.red : busy() ? COLOR.cyan : COLOR.muted} wrapMode="word">{busy() ? "Procesando… " : ""}{message()}</text>
  </box>;
}
