import type { Plugin } from "@opencode/plugin/tui";
type Context = Plugin.Context;
import { createRoot, createSignal, getOwner, runWithOwner } from "solid-js";
import type { JSX } from "@opentui/solid";

type LegacyCommand = { name: string; title?: string; desc?: string; category?: string; run(input: { event?: unknown }): unknown };
type LegacyLayer = { priority?: number; commands: LegacyCommand[]; bindings: { key: string; cmd: string }[] };
type Option = { title: string; value: unknown; description?: string; footer?: string; category?: string; disabled?: boolean };
type DialogProps = { title: string; message?: string; description?: string; placeholder?: string; initialValue?: string; value?: string; options?: Option[]; current?: unknown; onSelect?: (option: Option) => unknown; onConfirm?: (value?: any) => unknown; onCancel?: () => unknown };

/** Shared native V2 boundary for the host's existing views and the suite UI. */
export function createV2Host(context: Context, dispose: () => void) {
  const owner = getOwner();
  let renderOwner = owner;
  const cleanups: (() => void)[] = [];
  const [configuration, setConfiguration] = createSignal<Record<string, any>>({});
  let listening = false;
  const [preferences, updatePreferences] = context.storage.store<Record<string, unknown>>("sdd-profile-manager", { initial: {} });
  let presentation: { size?: "medium" | "large" | "xlarge" } = {};
  let nativeDialogStarted = false;
  const nativeDialog = (kind: "select" | "confirm" | "prompt" | "alert", props: DialogProps): JSX.Element => {
    nativeDialogStarted = true;
    context.ui.dialog.set(presentation);
    if (kind === "select") {
      void context.ui.dialog.select({ title: props.title, options: props.options ?? [], current: props.current, placeholder: props.placeholder }).then(value => {
        const option = props.options?.find(option => option.value === value);
        return option ? props.onSelect?.(option) : props.onCancel?.();
      });
    } else if (kind === "confirm") {
      void context.ui.dialog.confirm({ title: props.title, message: props.message ?? "" }).then(value => value === true ? props.onConfirm?.() : props.onCancel?.());
    } else if (kind === "prompt") {
      void context.ui.dialog.prompt({ title: props.title, description: props.description, placeholder: props.placeholder, value: props.value ?? props.initialValue }).then(value => value === undefined ? props.onCancel?.() : props.onConfirm?.(value));
    } else {
      void context.ui.dialog.alert({ title: props.title, message: props.message ?? "" }).then(() => props.onConfirm?.());
    }
    return null;
  };
  const onDispose = (cleanup: () => void) => { cleanups.push(cleanup); };
  const theme = () => {
    const color = (value: Context["theme"]["text"]["base"]) => value;
    const primary = color(context.theme.text.action.primary.base);
    return {
      primary, accent: primary, borderActive: primary,
      text: color(context.theme.text.base), textMuted: color(context.theme.text.muted),
      background: color(context.theme.background.base),
      backgroundPanel: color(context.theme.background.raised.base),
      backgroundElement: color(context.theme.background.raised.high),
      backgroundMenu: color(context.theme.background.raised.max),
      selectedListItemText: color(context.theme.text.base), border: color(context.theme.border.base),
      error: color(context.theme.text.feedback.error.base), warning: color(context.theme.text.feedback.warning.base),
      success: color(context.theme.text.feedback.success.base), info: color(context.theme.text.feedback.info.base),
    };
  };
  const providers = () => (context.data.location.provider.list(context.location) ?? []).map(provider => ({
    ...provider,
    models: Object.fromEntries((context.data.location.model.list(context.location) ?? []).filter(model => model.providerID === provider.id).map(model => [model.id, { ...model, variants: Array.isArray(model.variants) ? Object.fromEntries(model.variants.map(variant => [variant.id, { ...variant }])) : model.variants }])),
  }));
  const api = {
    ...context,
    lifecycle: { onDispose },
    async initialize() {
      const entries = await context.client.config.get({ location: context.location });
      const merged: Record<string, any> = {};
      for (const entry of entries) {
        if (entry.type !== "document") continue;
        Object.assign(merged, entry.info, { agents: { ...merged.agents, ...entry.info.agents } });
      }
      setConfiguration(merged);
      if (!listening) {
        listening = true;
        onDispose(context.data.listen(({ details }) => {
          if (details.type.startsWith("config.")) void api.initialize().catch(error => context.ui.toast.show({ message: `Configuration refresh failed: ${String(error)}`, variant: "error" }));
        }));
      }
    },
    kv: { get: (key: string) => preferences[key], set: (key: string, value: unknown) => updatePreferences(draft => { draft[key] = value; }) },
    keymap: {
      ...context.keymap,
      registerLayer(layer: LegacyLayer) {
        const release = context.ui.slot({ append: "app", render: () => {
          renderOwner = getOwner();
          context.keymap.layer(() => ({
          mode: "global",
          priority: layer.priority,
          commands: layer.commands.flatMap(command => {
            const keys = layer.bindings.filter(binding => binding.cmd === command.name);
            const id = command.name.replace(/^:/, "");
            return (keys.length ? keys : [{ key: undefined }]).map((binding, index) => ({
              ...(index === 0 ? { id, title: command.title, description: command.desc, group: command.category, palette: true as const, slash: { name: id } } : {}),
              bind: binding.key,
               run: (_input, event) => command.run({ event }) === false ? false : undefined,
            }));
          }),
          bindings: layer.commands.map(command => command.name.replace(/^:/, "")),
          }));
          return null;
        } });
        onDispose(release);
        return release;
      },
    },
    route: { get current() { const route = context.ui.router.current(); return route.type === "session" ? { name: "session", params: { sessionID: route.sessionID } } : { name: route.type }; } },
    theme: { get current() { return theme(); } },
    async getInstalledAgentDefinitions() {
      return Object.fromEntries((context.data.location.agent.list(context.location) ?? []).map(agent => {
        const { name, model, ...definition } = agent;
        return [name, { ...definition, ...(model ? { model: model.providerID + "/" + model.id, ...(model.variant ? { variant: model.variant } : {}) } : {}) }];
      }));
    },
    state: {
      get provider() { return providers(); },
      get config() {
        const config = configuration();
        return { ...config, default_agent: config.default_agent as string | undefined, agent: Object.fromEntries((context.data.location.agent.list(context.location) ?? []).map(agent => [agent.name, { ...config.agents?.[agent.name], ...agent, model: agent.model ? agent.model.providerID + "/" + agent.model.id : undefined, variant: agent.model?.variant, reasoningEffort: agent.request?.body?.reasoningEffort }])) };
      },
      path: { directory: context.location?.directory },
      session: { messages: (id: string) => {
        const session = context.data.session.get(id);
        const model = session?.model;
        const messages = context.data.session.message.list(id).flatMap(message => {
          if (message.type !== "assistant") return [];
          return [{ ...message, role: "assistant", providerID: message.model.providerID, modelID: message.model.id }];
        });
        // V2 user messages do not carry agent/model. Session selection owns those values.
        return [...messages, { role: "user", agent: session?.agent, model: model ? { providerID: model.providerID, modelID: model.id, variant: model.variant } : undefined }];
      } },
    },
    ui: {
      ...context.ui,
      toast: (options: string | Parameters<Context["ui"]["toast"]["show"]>[0]) => context.ui.toast.show(typeof options === "string" ? { message: options } : options),
      dialog: {
        ...context.ui.dialog,
        setSize(size: "medium" | "large" | "xlarge") { presentation = { size }; context.ui.dialog.set(presentation); },
        replace(render: () => JSX.Element, onClose?: () => void) {
          nativeDialogStarted = false;
          const content = runWithOwner(renderOwner, render);
          if (!nativeDialogStarted) { context.ui.dialog.show(() => content, onClose); context.ui.dialog.set(presentation); }
        },
      },
      DialogSelect: (props: DialogProps) => nativeDialog("select", props),
      DialogConfirm: (props: DialogProps) => nativeDialog("confirm", props),
      DialogPrompt: (props: DialogProps) => nativeDialog("prompt", props),
      DialogAlert: (props: DialogProps) => nativeDialog("alert", props),
    },
    slots: {
      register(input: { slots: Record<string, (input: any) => JSX.Element> }) {
        for (const [name, render] of Object.entries(input.slots)) {
          const append = name === "home_bottom" ? "home.footer" : "sidebar.content";
          onDispose(runWithOwner(owner, () => context.ui.slot({ append, render: (input: { sessionID?: string }) => render({ ...input, session_id: "sessionID" in input ? input.sessionID : undefined, theme: { current: theme() } }) }))!);
        }
      },
    },
    dispose() { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); dispose(); },
  };
  return api;
}
