/** @jsxImportSource @opentui/solid */
import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { PROFILES, errorText, safeText, emptyInventoryMessage, inventoryCountLabel, type Family, type Plan, type Profile, type State } from "./model.ts";
import { familyFingerprint } from "./policy.ts";
import { listBackups, type ArchiveManifest } from "./archive.ts";
import type { VaultService } from "./service.ts";
import { createVaultNavigationController, type Screen } from "./ui-controller.ts";

export const COLOR = { bg: "#0B111B", panel: "#111E2E", line: "#284967", blue: "#5FAFFF", cyan: "#63E6E2",
  text: "#E1EDFA", muted: "#91A8C1", green: "#72DEA8", red: "#FF8799", amber: "#F4CB80", selected: "#17334D" };
const bytesLabel = (n: number) => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const dateLabel = (n: number) => new Date(n).toLocaleString("es", { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
type Entry = { title: string; placeholder: string; action: (value: string) => Promise<void> };

function Button(props: { label: string; action: () => void; danger?: boolean; selected?: boolean }) {
  return <box paddingLeft={1} paddingRight={1} height={1} flexShrink={0} backgroundColor={props.selected ? COLOR.selected : COLOR.panel}
    onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); props.action(); }}>
    <text height={1} truncate fg={props.danger ? COLOR.red : COLOR.blue}>{props.label}</text>
  </box>;
}
function Metric(props: { value: string; label: string; color?: string; action?: () => void }) {
  return <box flexDirection="column" flexGrow={1} paddingLeft={1} borderStyle="single" borderColor={COLOR.line}
    onMouseDown={e => { if (props.action && e.button === 0) { e.preventDefault(); e.stopPropagation(); props.action(); } }}>
    <text fg={props.color || COLOR.text} attributes={1}>{props.value}</text><text fg={COLOR.muted}>{props.label}</text>
  </box>;
}

export function VaultApp(props: { api: Pick<TuiPluginApi, "ui"> & Partial<Pick<TuiPluginApi, "keymap">>; service: VaultService; onClose: () => void; inHostDialog?: boolean }) {
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

  function ask(title: string, placeholder: string, action: Entry["action"]) { setDraft(""); setEntry({ title, placeholder, action }); }

  const controller = createVaultNavigationController({
    service: props.service,
    signal: abortController.signal,
    isMounted: () => mounted,
    onClose: props.onClose,
    askConfirmation: ask,
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
    message,
    setMessage,
    livePlan,
    canClean,
    run,
    refresh,
    openPreview,
    clean,
    go,
  } = controller;

  const compact = () => dimensions().width < 100;
  const showMetrics = () => dimensions().height >= 38;
  const pageSize = () => Math.max(2, Math.min(14, dimensions().height - (showMetrics() ? 28 : 25) - (screen() === "preview" ? 3 : 0)));
  const contentHeight = () => Math.max(5, dimensions().height - (showMetrics() ? 24 : 20));
  const rows = createMemo(() => (screen() === "preview" ? plan()?.candidates ?? [] : plan()?.families ?? [])
    .filter(f => `${f.root.title} ${f.root.id} ${f.root.directory}`.toLowerCase().includes(query().toLowerCase())));
  const pageStart = () => Math.floor(Math.min(focus(), Math.max(0, rows().length - 1)) / pageSize()) * pageSize();
  const visible = () => rows().slice(pageStart(), pageStart() + pageSize());
  const selected = () => rows()[focus()];
  const selectedPinned = (f: Family) => f.members.some(s => state()?.pins.includes(s.id));
  const back = () => {
    if (busy()) return;
    if (entry()) setEntry(undefined); else if (searching()) setSearching(false); else if (screen() !== "list") go("list"); else props.onClose();
  };
  onMount(() => {
    void run(refresh);
    const off = props.api.keymap?.registerLayer({ priority: 2000, mode: "modal", bindings: [{ key: "escape", cmd: () => { back(); return true; } }] });
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
    if (busy()) { if (key.name !== "escape") { key.preventDefault(); key.stopPropagation(); } return; }
    if (key.name === "escape") {
      key.preventDefault(); key.stopPropagation();
      back();
      return;
    }
    if (entry() || searching()) return;
    let handled = true;
    const name = key.name.toLowerCase();
    if (name === "q") props.onClose();
    else if (name === "g") go("settings");
    else if (name === "p") go("profiles");
    else if (screen() === "settings") setting(name);
    else if (screen() === "profiles" && /^[1-5]$/.test(name)) chooseProfile(Object.keys(PROFILES)[Number(name) - 1] as Profile);
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
    <text height={1} flexShrink={0} truncate fg={COLOR.muted}>BASE DE DATOS DE OPENCODE · {screen() === "list" ? "Tus sesiones, bajo control" : ({ settings: "Configuración", profiles: "Perfiles de retención", preview: "Vista previa del borrado", backups: "Respaldos locales", detail: "Detalle de la familia" }[screen() as Exclude<Screen, "list">])}</text>
    <Show when={showMetrics()} fallback={<text height={1} flexShrink={0} fg={COLOR.cyan}>Familias {plan()?.families.length ?? "—"} · Candados {plan()?.locked ?? "—"} · Cupo {plan()?.quota.keep ?? "—"} · Candidatas {plan()?.candidates.length ?? "—"}</text>}>
    <box flexDirection="row" gap={1} marginTop={1} height={4} flexShrink={0}>
      <Metric value={String(plan()?.families.length ?? "—")} label="Familias" />
      <Metric value={String(plan()?.locked ?? "—")} label="Candados" color={COLOR.green} />
      <Metric value={String(plan()?.quota.keep ?? "—")} label="Cupo" color={COLOR.cyan} />
      <Metric value={String(plan()?.candidates.length ?? "—")} label="Candidatas" color={COLOR.red} action={() => void openPreview()} />
    </box>
    </Show>
    <Show when={entry()} fallback={<>
      <Show when={screen() === "list" || screen() === "preview"}>
        <Show when={screen() === "preview"}><text height={1} flexShrink={0} truncate fg={COLOR.amber}>{state()?.config.scope === "global" ? "Alcance global: " : "Proyecto activo: "}hasta {state()?.config.maxDeletePerRun} familias por lote, primero las más antiguas.</text></Show>
        <Show when={screen() === "preview" && !canClean()}><text height={1} flexShrink={0} truncate fg={COLOR.amber}>Borrado en vivo deshabilitado por seguridad. Usa MANTENIMIENTO-OFFLINE.cmd con OpenCode cerrado.</text></Show>
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
          <Show when={!rows().length}><text fg={COLOR.muted}>{emptyInventoryMessage({ busy: busy(), error: error(), hasPlan: Boolean(plan()) })}</text></Show>
        </box>
        <box flexDirection="row" height={1} flexShrink={0} justifyContent="space-between" backgroundColor={COLOR.panel}>
          <text fg={COLOR.muted}>{inventoryCountLabel({ count: rows().length, pageStart: pageStart(), pageSize: pageSize(), busy: busy(), error: error(), hasPlan: Boolean(plan()) })}</text>
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
          <text fg={COLOR.amber}>Automático: usa una sola instancia de OpenCode. Respalda conversaciones antes de borrar.</text>
          <text fg={COLOR.muted}>La sesión abierta, las que trabajan y aquellas con actividad no verificada quedan protegidas.</text>
          <text fg={COLOR.amber}>Para liberar espacio y compactar opencode.db, ejecuta MANTENIMIENTO-OFFLINE.cmd con OpenCode cerrado.</text>
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
        <text fg={COLOR.muted}>Enter confirma · Esc cancela</text>
        <input focused value={draft()} placeholder={entry()?.placeholder} onInput={setDraft} onSubmit={() => void run(submitEntry)} />
      </box>
    </Show>
    <box flexDirection="column" flexShrink={0} borderStyle="single" borderColor={COLOR.line} marginTop={1} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" height={1} flexShrink={0} justifyContent="space-between">
        <Button label={`[p] ${state() ? PROFILES[state()!.config.profile].label : "Perfil"}`} action={() => go("profiles")} />
        <text fg={state()?.config.automatic ? COLOR.green : COLOR.amber}>{state()?.config.automatic ? "AUTO ON" : "AUTO PAUSADO"} · v0.1.0</text>
      </box>
      <box height={compact() ? 2 : 1} flexShrink={0} onMouseDown={e => { if (e.button === 0 && screen() === "list") { e.preventDefault(); e.stopPropagation(); void openPreview(); } }}>
        <text fg={COLOR.muted}>{compact() ? "↑↓ mover · Espacio candado · [i] detalle\n[v] vista previa · [b] respaldos · Esc volver" : "↑↓ mover · Espacio candado · [i] detalle · [v] vista previa · [b] respaldos · Esc volver"}</text>
      </box>
      <Show when={screen() === "preview" && canClean()}><Button label="[c] Limpiar con respaldo…" danger action={clean} /></Show>
      <Show when={screen() !== "list"}><Button label="← Volver a sesiones" action={() => go("list")} /></Show>
    </box>
    <text height={2} flexShrink={0} fg={error() ? COLOR.red : busy() ? COLOR.cyan : COLOR.muted} wrapMode="word">{busy() ? "Procesando… " : ""}{message()}</text>
  </box>;
}
