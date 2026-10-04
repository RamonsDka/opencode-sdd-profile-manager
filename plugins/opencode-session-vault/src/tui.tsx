/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createV2Host } from "../../../src/host-v2.ts";
import { V2Gateway, V2_DELETION_BLOCKED, disabledV2Helper } from "./api-v2.ts";
import { createRoot, ErrorBoundary } from "solid-js";
import { OpenCodeGateway } from "./api.ts";
import { Store } from "./store.ts";
import { VaultService } from "./service.ts";
import { Leases } from "./leases.ts";
import { VaultApp, COLOR } from "./ui.tsx";
import { errorText, computeBackoff } from "./model.ts";

export interface SessionVaultRuntime {
  service: VaultService;
  store: Store;
  leases: Leases;
  open: () => void;
  dispose: () => Promise<void>;
}

export interface InitSessionVaultOptions {
  registerKeymap?: boolean;
  keybinding?: string;
  throwOnProjectError?: boolean;
}

let activeRuntime: SessionVaultRuntime | undefined;

export function getActiveSessionVault(): SessionVaultRuntime | undefined {
  return activeRuntime;
}

export function resetSessionVaultStateForTests(): void {
  activeRuntime = undefined;
}

export async function initSessionVault(api: any, options: InitSessionVaultOptions = {}): Promise<SessionVaultRuntime | undefined> {
  if (activeRuntime) return activeRuntime;

  const nativeV2 = api.app?.version?.startsWith("2.");
  const version = nativeV2 ? undefined : api.app?.version?.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (version && (Number(version[1]) !== 1 || Number(version[2]) < 18 || (Number(version[2]) === 18 && Number(version[3]) < 29))) {
    api.ui?.toast?.({ title: "Session Vault", message: "Este paquete requiere OpenCode 1.18.29 o posterior de la rama 1.x. OpenCode 2 usa otra API.", variant: "error", duration: 12000 });
    return undefined;
  }
  const store = new Store();
  try {
    await store.migrate();
  } catch (e) {
    api.ui?.toast?.({ title: "Session Vault", message: `Aviso de inicio: ${errorText(e)}`, variant: "error", duration: 8000 });
    return undefined;
  }
  const leases = new Leases(store);
  const currentID = () => api.route?.current?.name === "session" ? api.route?.current?.params?.sessionID as string | undefined : undefined;
  let leaseActive = new Set<string>();
  const project = nativeV2
    ? { data: (await api.client.location.get({ location: { directory: api.state?.path?.directory } })).project }
    : await api.client?.project?.current?.({ directory: api.state?.path?.directory }, { throwOnError: true });
  if (!project?.data?.id) throw new Error("Session Vault: no se pudo resolver el proyecto actual.");
  const service = new VaultService({
    gateway: nativeV2 ? new V2Gateway(api.client) : new OpenCodeGateway(api.client, {
      activeDirectory: api.state?.path?.directory,
      activeWorkspaceID: api.state?.workspace?.id ?? api.state?.path?.workspace,
    }),
    store,
    projectID: project.data.id,
    projectDirectory: api.state?.path?.directory,
    signal: api.lifecycle?.signal,
    active: () => new Set([...leaseActive, ...(currentID() ? [currentID()!] : [])]),
    allowed: async () => {
      if (nativeV2) throw new Error(V2_DELETION_BLOCKED);
      const transport = api.client as unknown as { client?: { getConfig?: () => { baseUrl?: string } } };
      const url = transport.client?.getConfig?.().baseUrl;
      if (!url || !["opencode.internal", "localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
        throw new Error("Esta versión solo limpia servidores locales. La conexión remota queda en modo consulta.");
      }
      await leases.heartbeat(currentID());
      const other = await leases.read(); leaseActive = other.active;
      if (other.unknownPids && other.unknownPids.size > 0) {
        throw new Error("Estado de proceso desconocido o acceso denegado. Limpieza suspendida por seguridad.");
      }
      if (other.pids.size > 1) throw new Error("Cierra las otras instancias de OpenCode antes de limpiar. Puedes seguir revisando y poniendo candados.");
    } });
  let heartbeatRunning = false;
  const heartbeat = async () => {
    if (heartbeatRunning || api.lifecycle?.signal?.aborted) return;
    heartbeatRunning = true;
    try { await leases.heartbeat(currentID()); leaseActive = (await leases.read()).active; }
    finally { heartbeatRunning = false; }
  };
  await heartbeat();
  const notify = (message: string, variant: "info" | "error" | "success" = "info") => api.ui?.toast?.({ title: "Session Vault", message, variant, duration: 7000 });
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
      if (!state.config.automatic || Date.now() - state.lastRun < state.config.intervalMinutes * 60000) return;
      const preview = await service.preview({ liveness: true });
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
    }
    finally { checking = false; }
  };
  let heartbeatLastError = "";
  const timers = [
    setInterval(() => void heartbeat().catch(e => {
      const msg = errorText(e);
      if (msg !== heartbeatLastError) {
        heartbeatLastError = msg;
      }
    }), 5000),
    setInterval(() => void tick(), 60000),
  ];
  const open = () => {
    if (api.lifecycle?.signal?.aborted) return;
    if (api.renderer && (api.renderer.width < 70 || api.renderer.height < 30)) {
      notify("Amplía la terminal a un mínimo de 70 columnas y 30 filas.", "info"); return;
    }
    api.ui?.dialog?.replace?.(() => <ErrorBoundary fallback={e => <box padding={2}><text fg={COLOR.red}>Session Vault: {errorText(e)}. Pulsa Esc y vuelve a abrir.</text></box>}>
      <VaultApp api={api} service={service} helperClient={nativeV2 ? disabledV2Helper() : undefined} inHostDialog onClose={() => api.ui?.dialog?.clear?.()} />
    </ErrorBoundary>);
    api.ui?.dialog?.setSize?.("xlarge");
  };

  const dispose = async () => {
    timers.forEach(clearInterval);
    await leases.close();
    if (activeRuntime === runtime) {
      activeRuntime = undefined;
    }
  };

  const runtime: SessionVaultRuntime = {
    service,
    store,
    leases,
    open,
    dispose,
  };
  activeRuntime = runtime;

  api.lifecycle?.onDispose?.(dispose);

  if (options?.registerKeymap !== false && api.keymap?.registerLayer) {
    createRoot(disposeRoot => {
      api.lifecycle?.onDispose?.(disposeRoot);
      const key = options?.keybinding ?? "alt+shift+s";
      const off = api.keymap.registerLayer({ priority: 80, commands: [{ namespace: "palette", name: "session-vault.open", title: "Session Vault · gestionar sesiones", category: "Session Vault",
        slashName: "session-vault", slashAliases: ["sesiones-db"], run: () => { open(); return true; } }],
        bindings: [{ key, cmd: "session-vault.open" }] });
      if (off) api.lifecycle?.onDispose?.(off);
    });
  }

  return runtime;
}

export async function openSessionVault(api: any): Promise<void> {
  if (activeRuntime) {
    activeRuntime.open();
    return;
  }
  const runtime = await initSessionVault(api, { registerKeymap: false });
  runtime?.open();
}

export default Plugin.define({
  id: "opencode-session-vault",
  async setup(context) {
    const api = createV2Host(context, () => {});
    try {
      await initSessionVault(api);
      return () => api.dispose();
    } catch (error) { api.dispose(); throw error; }
  },
});
