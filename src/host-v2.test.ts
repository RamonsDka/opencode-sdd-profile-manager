import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createComponent, createContext, createRoot, useContext } from "solid-js";
// Same Solid runtime as the suite native host via the portable bare specifier.
import { createComponent as nativeComponent, createContext as nativeContext, createRoot as nativeRoot, useContext as nativeUseContext } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createV2Host } from "./host-compat";

function fixture() {
  const dialog = { show: vi.fn(), set: vi.fn(), clear: vi.fn(), select: vi.fn().mockResolvedValue("chosen"), confirm: vi.fn().mockResolvedValue(false), prompt: vi.fn().mockResolvedValue("renamed"), alert: vi.fn().mockResolvedValue(undefined) };
  const layer = vi.fn();
  const values = {};
  const context = { app: { version: "2.0.21" }, location: { directory: "/project" }, storage: { store: () => [values, async (mutate: any) => mutate(values)] }, keymap: { layer }, ui: { dialog, toast: { show: vi.fn() }, router: { current: () => ({ type: "session", sessionID: "session-1" }) } }, data: { location: { provider: { list: () => [{ id: "test", name: "Test" }] }, model: { list: () => [{ id: "m", providerID: "test", name: "Model", variants: [{ id: "high" }], limit: { context: 100 } }] }, agent: { list: () => [] } }, session: { get: () => ({ model: { providerID: "test", modelID: "m" } }), message: { list: () => [] } } } };
    context.ui = { ...context.ui, slot: vi.fn((claim: any) => { createRoot(dispose => { claim.render({}); dispose(); }); return () => {}; }) } as never;
  return { context, dialog, layer };
}

describe("V2 host bridge", () => {
  it("renders custom dialogs with the live app-slot providers instead of the setup owner", () => {
    const { context, dialog } = fixture();
    const Renderer = (nativeContext as typeof createContext)<object>();
    const renderer = { width: 100, height: 40 };
    const useRenderer = () => {
      const value = nativeUseContext(Renderer);
      if (!value) throw new Error("No renderer found");
      return value;
    };
    let claim: any;
    const unregister = vi.fn();
    context.ui = { ...context.ui, slot: vi.fn((input: any) => { claim = input; return unregister; }) } as never;
    let api!: ReturnType<typeof createV2Host>;
    let stopSetup!: () => void;
    let stopApp!: () => void;
    nativeRoot((dispose: () => void) => { stopSetup = dispose; api = createV2Host(context as never, dispose); });
    const close = vi.fn();
    const custom = vi.fn(() => useRenderer() as never);
    try {
      expect(() => api.ui.dialog.replace(custom)).toThrow("No renderer found");
      custom.mockClear();
      api.keymap.registerLayer({ commands: [{ name: ":profiles", run: vi.fn() }], bindings: [{ key: "alt+k", cmd: ":profiles" }] });
      nativeRoot((dispose: () => void) => {
        stopApp = dispose;
        nativeComponent(Renderer.Provider, { value: renderer, get children() { return claim.render({}); } });
      });
      api.ui.dialog.replace(custom, close);
      expect(custom).toHaveBeenCalledOnce();
      expect(dialog.show).toHaveBeenCalledOnce();
      const [render, onClose] = dialog.show.mock.calls[0];
      expect(render()).toBe(renderer);
      onClose();
      expect(close).toHaveBeenCalledOnce();
      api.dispose();
      expect(unregister).toHaveBeenCalledOnce();
    } finally {
      stopApp?.();
      stopSetup();
    }
  });
  it.each(["Select", "Confirm", "Prompt", "Alert"] as const)("dispatches native %s exactly once without a custom dialog", async kind => {
    const { context, dialog } = fixture();
    const api = createV2Host(context as never, () => {});
    const callback = vi.fn();
    const close = vi.fn();
    api.ui.dialog.replace(() => api.ui[`Dialog${kind}`]({ title: kind, options: [{ title: "Chosen", value: "chosen" }], onSelect: callback, onConfirm: callback, onCancel: callback }), close);
    await Promise.resolve();
    expect(dialog[kind.toLowerCase() as "select" | "confirm" | "prompt" | "alert"]).toHaveBeenCalledOnce();
    expect(dialog.show).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });
  it("retains native variant settings and overlays without flattening body", () => {
    const { context } = fixture();
    const variant = { id: "fast", settings: { reasoningEffort: "low" }, body: { reasoningEffort: "provider-specific", thinking: { budget: 64 } }, headers: { "x-mode": "fast" } };
    context.data.location.model.list = () => [{ id: "m", providerID: "test", variants: [variant] }] as never;
    const api = createV2Host(context as never, () => {});
    expect(api.state.provider[0].models.m.variants.fast).toEqual(variant);
    context.data.location.model.list = () => [{ id: "m", providerID: "test", variants: { low: { reasoningEffort: "low" } } }] as never;
    expect(api.state.provider[0].models.m.variants).toEqual({ low: { reasoningEffort: "low" } });
  });
  it("exposes current native definitions separately from the configuration document", async () => {
    const { context } = fixture();
    const agents = [{ name: "gentle-ai-worker", system: "Native worker", model: { providerID: "test", id: "m" } }];
    context.data.location.agent.list = () => agents as never;
    const api = createV2Host(context as never, () => {});
    expect(await (api as any).getInstalledAgentDefinitions()).toEqual({ "gentle-ai-worker": { system: "Native worker", model: "test/m" } });
    expect(agents[0].model).toEqual({ providerID: "test", id: "m" });
  });
  it("mounts native keymaps only inside the host app slot owner and unregisters them", () => {
    const { context, layer } = fixture();
    let claim: any;
    const unregister = vi.fn();
    context.ui = { ...context.ui, slot: vi.fn((input: any) => { claim = input; return unregister; }) } as never;
    const api = createV2Host(context as never, () => {});
    api.keymap.registerLayer({ commands: [{ name: ":profiles", run: vi.fn() }], bindings: [{ key: "alt+k", cmd: ":profiles" }] });
    expect(layer).not.toHaveBeenCalled();
    expect(claim.append).toBe("app");
    const HostKeymap = createContext<boolean>();
    context.keymap.layer = vi.fn(() => {
      if (!useContext(HostKeymap)) throw new Error("Keymap.Provider is missing");
    });
    const mountedLayer = context.keymap.layer;
    createRoot(dispose => {
      createComponent(HostKeymap.Provider, { value: true, get children() { return claim.render({}); } });
      expect(mountedLayer).toHaveBeenCalledOnce();
      dispose();
    });
    api.dispose();
    expect(unregister).toHaveBeenCalledOnce();
  });
  it("persists profile updates through native V2 config documents without calling shell-only config.update", async () => {
    const directory = mkdtempSync(join(tmpdir(), "profile-v2-"));
    const path = join(directory, "opencode.jsonc");
    writeFileSync(path, '{"default_agent":"planner","providers":{"keep":{}},"agents":{"planner":{"system":"Keep instructions"}}}');
    const { context } = fixture();
    const reload = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn();
    const native = { ...context, client: { config: { get: vi.fn().mockResolvedValue([{ type: "document", path, info: {} }]), update }, location: { reload } }, data: { ...context.data, listen: vi.fn(() => () => {}) } };
    try {
      const api = createV2Host(native as never, () => {}, path);
      const current = await api.client.global.config.get();
      expect(current.data.agent.planner.system).toBe("Keep instructions");
      await api.client.global.config.update({ config: { ...current.data, agent: { planner: { ...current.data.agent.planner, model: "test/m", variant: "high", request: { body: { keep: true }, headers: { keep: "yes" } } } } } });
      const saved = JSON.parse(readFileSync(path, "utf8"));
      expect(saved).toMatchObject({ default_agent: "planner", providers: { keep: {} }, agents: { planner: { system: "Keep instructions", model: { providerID: "test", model: "m", variant: "high" }, request: { body: { keep: true }, headers: { keep: "yes" } } } } });
      expect(saved.agents.planner.request.body.reasoningEffort).toBeUndefined();
      expect((await api.client.global.config.get()).data.agent.planner).toMatchObject({ model: "test/m", variant: "high" });
      expect(saved.agent).toBeUndefined();
      expect(update).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalledOnce();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("publishes a V2 source entry without a build lifecycle", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const entry = readFileSync(new URL("../index.tsx", import.meta.url), "utf8");
    expect(pkg.exports["./tui"].import).toBe("./index.tsx");
    expect(pkg.peerDependencies["@opencode/plugin"]).toBe("2.0.21");
    expect(pkg.scripts.prepack).toBeUndefined();
    expect(entry).toContain("export default Plugin.define({");
    expect(entry).not.toContain("@opencode-ai/plugin/tui");
  });
  it("registers real V2 commands and retains every shortcut without losing alternate bindings", () => {
    const { context, layer } = fixture();
    const run = vi.fn();
    createRoot(dispose => {
      const api = createV2Host(context as never, dispose);
      api.keymap.registerLayer({ priority: 100, commands: [{ name: ":profiles", title: "Profiles", run }], bindings: [{ key: "alt+k", cmd: ":profiles" }, { key: "super+k", cmd: ":profiles" }] });
      const registered = layer.mock.calls[0][0]();
      expect(registered.mode).toBe("global");
      expect(registered.commands[0]).toMatchObject({ id: "profiles", bind: "alt+k", palette: true, slash: { name: "profiles" } });
      expect(registered.commands[1].bind).toBe("super+k");
      registered.commands[1].run();
      expect(run).toHaveBeenCalledOnce();
      api.keymap.registerLayer({ commands: [{ name: ":session-vault", run }], bindings: [{ key: "alt+v", cmd: ":session-vault" }] });
      expect(layer.mock.calls[1][0]().commands[0].bind).toBe("alt+v");
      dispose();
    });
  });
  it("uses native selection/cancellation, native presentation, durable preferences and V2 data", async () => {
    const { context, dialog } = fixture();
    const api = createV2Host(context as never, () => {});
    const selected = vi.fn(), cancelled = vi.fn();
    api.ui.dialog.setSize("large");
    api.ui.DialogSelect({ title: "Select", options: [{ title: "Chosen", value: "chosen" }], onSelect: selected });
    api.ui.DialogConfirm({ title: "Delete", message: "Confirm", onConfirm: vi.fn(), onCancel: cancelled });
    await Promise.resolve();
    expect(selected).toHaveBeenCalledWith({ title: "Chosen", value: "chosen" });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(dialog.set).toHaveBeenCalledWith({ size: "large" });
    await api.kv.set("badge", false);
    expect(api.kv.get("badge")).toBe(false);
    expect(api.route.current).toEqual({ name: "session", params: { sessionID: "session-1" } });
    expect(api.state.provider[0].models.m.name).toBe("Model");
  });
  it("retains native agent variants, session selection, and command fallthrough", () => {
    const { context, layer, dialog } = fixture();
    context.data.location.agent.list = () => [{ name: "planner", model: { providerID: "test", id: "m", variant: "high" }, request: { body: { reasoningEffort: "high" } } }] as never;
    context.data.session.get = () => ({ agent: "planner", model: { providerID: "test", id: "m", variant: "high" } }) as never;
    const api = createV2Host(context as never, () => {});
    expect(api.state.config.agent.planner).toMatchObject({ model: "test/m", variant: "high", reasoningEffort: "high" });
    expect(api.state.session.messages("session-1")).toContainEqual(expect.objectContaining({ role: "user", agent: "planner", model: { providerID: "test", modelID: "m", variant: "high" } }));
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const run = vi.fn(() => false);
    api.keymap.registerLayer({ commands: [{ name: "escape", run }], bindings: [{ key: "escape", cmd: "escape" }] });
    expect(layer.mock.calls[0][0]().commands[0].run(undefined, event)).toBe(false);
    expect(run).toHaveBeenCalledWith({ event });
    const close = vi.fn();
    api.ui.dialog.replace(() => null, close);
    expect(dialog.show).toHaveBeenCalledWith(expect.any(Function), close);
  });
  it("loads document configuration without losing default agent or unrelated settings", async () => {
    const { context } = fixture();
    const stop = vi.fn();
    const native = { ...context, client: { config: { get: vi.fn().mockResolvedValue([{ type: "directory", path: "/project" }, { type: "document", info: { default_agent: "planner", agents: { planner: { description: "Plan" } }, permissions: [{ tool: "read" }] } }]) } }, data: { ...context.data, listen: vi.fn(() => stop) } };
    context.data.location.agent.list = () => [{ name: "planner", model: { providerID: "test", id: "m", variant: "high" }, request: { body: {} } }] as never;
    const api = createV2Host(native as never, () => {});
    await api.initialize();
    await api.initialize();
    expect(native.client.config.get).toHaveBeenCalledWith({ location: context.location });
    expect(api.state.config).toMatchObject({ default_agent: "planner", permissions: [{ tool: "read" }], agent: { planner: { description: "Plan", model: "test/m", variant: "high" } } });
    expect(native.data.listen).toHaveBeenCalledOnce();
    api.dispose();
    expect(stop).toHaveBeenCalledOnce();
  });
});
