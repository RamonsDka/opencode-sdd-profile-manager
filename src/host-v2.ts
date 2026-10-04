import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { applyEdits, modify, parse } from "jsonc-parser";
import type { Plugin } from "@opencode/plugin/tui";
import { createV2Host as createNativeHost } from "../plugins/suite-de-agentes/src/tui/native-host";
import { resolvePaths } from "./config";

/** V2 only exposes shell updates over HTTP; profile edits use the global document. */
export function createV2Host(context: Plugin.Context, dispose: () => void, configPath = resolvePaths().configPath) {
  const api = createNativeHost(context, dispose);
  const read = () => {
    const source = existsSync(configPath) ? readFileSync(configPath, "utf8") : "{}";
    const errors: import("jsonc-parser").ParseError[] = [];
    const config = parse(source, errors, { allowTrailingComma: true });
    if (errors.length || !config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid global configuration document");
    return { source, config };
  };
  return {
    ...api,
    client: {
      ...context.client,
      global: { config: {
        async get() {
          const { config } = read();
          const agent = config.agents ? Object.fromEntries(Object.entries(config.agents).map(([id, value]) => {
            const native = value as Record<string, any>;
            const model = typeof native.model === "string" ? native.model.split("#")[0] : native.model ? `${native.model.providerID}/${native.model.model ?? native.model.id}` : undefined;
            const variant = typeof native.model === "string" ? native.model.split("#")[1] : native.model?.variant;
            return [id, { ...native, model, variant, reasoningEffort: native.request?.body?.reasoningEffort }];
          })) : config.agent ?? {};
          return { data: { ...config, agent } };
        },
        async update({ config }: { config: Record<string, any> }) {
          const original = read();
          let source = original.source;
          const agents = Object.fromEntries(Object.entries(config.agent ?? config.agents ?? {}).map(([id, value]) => {
            const agent = { ...(value as Record<string, any>) };
            const previous = original.config.agents?.[id] ?? original.config.agent?.[id] ?? {};
            const native = Boolean(original.config.agents);
            if (native) {
              if (typeof agent.model === "string") {
                const [providerID, ...model] = agent.model.split("#")[0].split("/");
                agent.model = { providerID, model: model.join("/"), ...(agent.variant ? { variant: agent.variant } : {}) };
              }
              if (agent.reasoningEffort === undefined && previous.request?.body?.reasoningEffort !== undefined) {
                agent.request = { ...agent.request, body: { ...agent.request?.body } };
                delete agent.request.body.reasoningEffort;
              }
              delete agent.variant;
              delete agent.reasoningEffort;
            }
            return [id, agent];
          }));
          const key = original.config.agents ? "agents" : "agent";
          const changes = { ...config, [key]: agents };
          delete changes[key === "agents" ? "agent" : "agents"];
          for (const [name, value] of Object.entries(changes)) {
            source = applyEdits(source, modify(source, [name], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
          }
          writeFileSync(configPath, source, "utf8");
          await context.client.location.reload();
          await api.initialize();
          return { data: config };
        },
      } },
    },
    nativeConfigDocument: true,
  };
}
