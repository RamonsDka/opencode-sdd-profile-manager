import { ConsentLedger, registerMessageGrant } from "../core/grants.ts";
import { Plugin as V2Plugin, Model } from "@opencode/plugin";
import { messageText, parseCanonicalConsent } from "../core/grants.ts";
import { decideTaskGate, isAuthorizedInternalAgent, SDD_ORCHESTRATOR, transformTaskPermission } from "../core/policy.ts";
import { defaultSuitePath, loadSuiteConfig } from "../core/persistence.ts";
import type { Config as PluginConfig, Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";
import type { Part } from "@opencode-ai/sdk";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { handleTaskManagerMilestoneEvent } from "../../../../src/plugins/task-manager-routing";
import { GITHUB_AGENT_ID, GITHUB_AGENT_LEGACY_ID, isCanonicalBuiltInAgent, normalizeAgentId } from "../core/built-in-agents.ts";

type RuntimePermission = NonNullable<PluginConfig["permission"]> & {
  task?: Record<string, "allow" | "deny" | "ask">;
};

type RuntimeAgentConfig = {
  permission?: RuntimePermission;
  [key: string]: unknown;
};

type RuntimePluginConfig = PluginConfig & {
  permission?: RuntimePermission;
  agent?: Record<string, RuntimeAgentConfig | undefined>;
};

function applyRuntimeTaskPermission(
  config: PluginConfig,
  disabledAgents: readonly string[] = [],
  registeredAgents: readonly string[] = [],
): void {
  const runtimeConfig = config as RuntimePluginConfig;
  const taskPermission = transformTaskPermission(disabledAgents, registeredAgents);
  runtimeConfig.permission = {
    ...(runtimeConfig.permission ?? {}),
    task: taskPermission,
  };

  const orchestrator = runtimeConfig.agent?.[SDD_ORCHESTRATOR];
  if (!orchestrator || typeof orchestrator !== "object") return;
  const permission = orchestrator.permission;
  orchestrator.permission = {
    ...(permission && typeof permission === "object" ? permission : {}),
    task: taskPermission,
  };
}

function normalizeRuntimeAgentEntries(config: PluginConfig): void {
  const agents = (config as RuntimePluginConfig).agent;
  if (!agents?.[GITHUB_AGENT_LEGACY_ID]) return;
  const legacy = agents[GITHUB_AGENT_LEGACY_ID];
  const canonical = agents[GITHUB_AGENT_ID];
  agents[GITHUB_AGENT_ID] = { ...(legacy ?? {}), ...(canonical ?? {}) };
  delete agents[GITHUB_AGENT_LEGACY_ID];
}

export function applyRuntimeModelAssignments(config: PluginConfig, assignments: Record<string, string>, variants: Record<string, string> = {}): void {
  const runtimeConfig = config as RuntimePluginConfig;
  for (const [agentID, model] of Object.entries(assignments)) {
    const agent = runtimeConfig.agent?.[normalizeAgentId(agentID)];
    if (!agent || typeof agent !== "object") continue;
    agent.model = model;
    const variant = variants[agentID];
    if (variant === undefined) delete agent.variant;
    else agent.variant = variant;
  }
}

export function applyRuntimeBuiltInOverrides(config: PluginConfig, overrides: Record<string, { description?: string; skills?: string[]; operations?: string }>): void {
  const runtimeConfig = config as RuntimePluginConfig;
  for (const [agentID, override] of Object.entries(overrides)) {
    const agent = runtimeConfig.agent?.[normalizeAgentId(agentID)];
    if (!agent || typeof agent !== "object") continue;
    if (override.description !== undefined) agent.description = override.description;
    if (override.skills !== undefined) agent.skills = [...override.skills];
    if (override.operations !== undefined) agent.prompt = override.operations;
  }
}

export function applyRuntimeDisabledAgents(config: PluginConfig, disabledAgents: readonly string[]): void {
  const runtimeConfig = config as RuntimePluginConfig;
  for (const agentID of disabledAgents) {
    const canonicalID = normalizeAgentId(agentID);
    if (runtimeConfig.agent && Object.prototype.hasOwnProperty.call(runtimeConfig.agent, canonicalID)) delete runtimeConfig.agent[canonicalID];
  }
}

export interface AgentSuiteServerOptions {
  knownAgents?: () => string[];
  sessionAgent?: (sessionID: string) => string | undefined | Promise<string | undefined>;
  ledger?: ConsentLedger;
  disabledAgents?: () => readonly string[];
  securityState?: () => { disabledAgents: readonly string[]; customAgentIds?: readonly string[]; available: boolean };
  onMilestone?: (milestone: string, sessionID: string) => Promise<void> | void;
}

interface ChatMessageInput { sessionID: string; agent?: string; messageID?: string; }
interface ChatMessageOutput { message?: { id?: string; agent?: string }; parts: Part[]; }
interface ToolBeforeInput { tool: string; sessionID: string; callID: string; }
interface ToolBeforeOutput { args: Record<string, unknown>; }

const SECURITY_STATE_RETRY_DELAYS_MS = [10, 25, 50] as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shouldEnqueueMilestoneEvent(event: string): boolean {
  return event === "sdd-tasks" || event === "sdd-verify" || event === "sdd-archive" || event === "verified-significant";
}

export function createAgentSuiteServer(options: AgentSuiteServerOptions = {}) {
  const ledger = options.ledger ?? new ConsentLedger();
  const knownAgents = options.knownAgents ?? (() => []);
  const currentTurns = new Map<string, { messageID: string; agent?: string }>();
  const readSecurityState = () => options.securityState?.() ?? { disabledAgents: options.disabledAgents?.() ?? [], customAgentIds: [], available: true };
  return {
    "chat.message": async (input: ChatMessageInput, output: ChatMessageOutput) => {
      const messageID = input.messageID ?? output.message?.id;
      if (!messageID) {
        currentTurns.delete(input.sessionID);
        return;
      }
      const sessionAgent = input.agent ?? output.message?.agent ?? await options.sessionAgent?.(input.sessionID);
      currentTurns.set(input.sessionID, { messageID, agent: sessionAgent });
      const state = readSecurityState();
      const disabled = new Set(state.disabledAgents.map(normalizeAgentId));
      const customSet = new Set((state.customAgentIds ?? []).map(normalizeAgentId));
      const isDegraded = state.available === false;
      const known = knownAgents().filter((agent) => {
        const norm = normalizeAgentId(agent);
        if (disabled.has(norm)) return false;
        if (isDegraded && customSet.has(norm)) return false;
        return true;
      });
      registerMessageGrant(ledger, { sessionID: input.sessionID, messageID, parts: output.parts }, known, sessionAgent);
      if (sessionAgent === SDD_ORCHESTRATOR) {
        const text = messageText({ sessionID: input.sessionID, messageID, parts: output.parts });
        const existing = new Set(output.parts.flatMap((part) => part.type === "agent" ? [part.name] : []));
        for (const agent of parseCanonicalConsent(text, known)) {
          if (existing.has(agent)) continue;
          output.parts.push({
            id: `prt_agent_suite_${randomBytes(8).toString("hex")}`,
            sessionID: input.sessionID,
            messageID,
            type: "agent",
            name: agent,
            source: { value: `usa también agente: ${agent}`, start: 0, end: `usa también agente: ${agent}`.length },
          });
        }
      }
    },
    "tool.execute.before": async (input: ToolBeforeInput, output: ToolBeforeOutput) => {
      if (input.tool !== "task") return;
      let state = readSecurityState();
      for (const retryDelay of SECURITY_STATE_RETRY_DELAYS_MS) {
        if (state.available) break;
        await delay(retryDelay);
        state = readSecurityState();
      }
      const disabledAgents = state.disabledAgents;
      const turn = currentTurns.get(input.sessionID);
      if (!turn) throw new Error("Suite de Agentes: cannot resolve the current turn for this task");
      const sessionAgent = turn.agent ?? await options.sessionAgent?.(input.sessionID);
      if (!sessionAgent) throw new Error("Suite de Agentes: cannot resolve the session agent for the current turn");
      const target = typeof output.args.subagent_type === "string" ? output.args.subagent_type : "";
      if (!target && sessionAgent === SDD_ORCHESTRATOR) throw new Error("Suite de Agentes: task target subagent_type is missing");

      const canonicalTarget = normalizeAgentId(target);
      const isTargetDisabled = disabledAgents.map(normalizeAgentId).includes(canonicalTarget);
      if (isTargetDisabled) {
        throw new Error(`Suite de Agentes: Disabled agent '${target}' cannot be dispatched.`);
      }

      if (sessionAgent !== SDD_ORCHESTRATOR) {
        return;
      }

      if (isAuthorizedInternalAgent(canonicalTarget)) {
        return;
      }

      const allKnownAgents = knownAgents().map(normalizeAgentId);
      const isKnown = allKnownAgents.includes(canonicalTarget);
      if (!isKnown) {
        throw new Error(`Suite de Agentes: Blocked agent '${target}': target is unknown or unregistered.`);
      }

      const isCanonicalNative = isCanonicalBuiltInAgent(canonicalTarget);
      const customSet = new Set((state.customAgentIds ?? []).map(normalizeAgentId));
      const isCustom = customSet.has(canonicalTarget) || !isCanonicalNative;

      if (!state.available && isCustom) {
        throw new Error(`Suite de Agentes: custom agent '${target}' is unavailable due to corrupt suite configuration`);
      }

      const decision = decideTaskGate({
        sessionAgent,
        target,
        sessionID: input.sessionID,
        messageID: turn.messageID,
        ledger,
        disabledAgents,
        knownAgents: [SDD_ORCHESTRATOR, ...allKnownAgents.filter((agent) => !disabledAgents.map(normalizeAgentId).includes(agent))],
      });
      if (!decision.allowed) throw new Error(`Suite de Agentes: ${decision.reason}`);
    },
    "tool.execute.after": async () => undefined,
    "command.execute.before": async (input: { command: string; sessionID: string; arguments: string }, output: { parts: Part[] }) => {
      if (input.command === "agent-suite-grants") {
        const grants = ledger.list(input.sessionID);
        output.parts.push({ type: "text", text: grants.length ? grants.map((grant) => `${grant.id} ${grant.requester} -> ${grant.target} (${grant.purpose}; ${grant.duration})`).join("\n") : "No active session grants." } as Part);
      }
      if (input.command === "agent-suite-revoke") ledger.revokeTarget(input.sessionID, input.arguments.trim());
    },
    event: async (input: { event: Event }) => {
      if (input.event.type === "session.deleted") {
        const sessionID = input.event.properties.info.id;
        if (sessionID) { ledger.clearSession(sessionID); currentTurns.delete(sessionID); }
      } else if (input.event.type === "command.executed") {
        const cmdName = input.event.properties.name;
        if (typeof cmdName === "string" && shouldEnqueueMilestoneEvent(cmdName)) {
          try {
            await options.onMilestone?.(cmdName, input.event.properties.sessionID);
          } catch {
            // Milestone notification must never block or crash the host event loop
          }
        }
      }
    },
    grantConsent: (input: Parameters<ConsentLedger["grant"]>[0]) => ledger.grant(input),
    listGrants: (sessionID?: string) => ledger.list(sessionID),
  };
}

async function resolveSessionAgent(input: PluginInput, sessionID: string): Promise<string | undefined> {
  try {
    const response = await input.client.session.messages({ path: { id: sessionID }, query: { limit: 20 } });
    const messages = response.data ?? [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const info = messages[index]?.info;
      if (info?.role === "user") return info.agent;
    }
  } catch { return undefined; }
  return undefined;
}

export const serverPlugin: Plugin = async (input) => {
  const registeredAgents = new Set<string>();
  let disabledAgents: string[] = [];
  let customAgentIds = new Set<string>();
  let suiteConfigLoaded = false;
  let suiteFileExisted = false;

  const liveSecurityState = () => {
    const path = defaultSuitePath();
    const exists = existsSync(path);
    if (!exists) {
      if (suiteFileExisted) {
        return { disabledAgents, customAgentIds: [...customAgentIds], available: false };
      }
      return { disabledAgents, customAgentIds: [...customAgentIds], available: true };
    }
    try {
      const suite = loadSuiteConfig(path);
      disabledAgents = [...(suite.disabledAgents ?? [])];
      customAgentIds = new Set(Object.keys(suite.customAgents ?? {}).map(normalizeAgentId));
      suiteConfigLoaded = true;
      suiteFileExisted = true;
      return { disabledAgents, customAgentIds: [...customAgentIds], available: true };
    } catch {
      return { disabledAgents, customAgentIds: [...customAgentIds], available: false };
    }
  };

  const hooks = createAgentSuiteServer({
    knownAgents: () => [...registeredAgents],
    sessionAgent: (sessionID) => resolveSessionAgent(input, sessionID),
    disabledAgents: () => liveSecurityState().disabledAgents,
    securityState: liveSecurityState,
  });

  return {
    ...hooks,
    config: async (config: PluginConfig) => {
      normalizeRuntimeAgentEntries(config);
      const configuredAgents = Object.keys(config.agent ?? {});
      try {
        const suitePath = defaultSuitePath();
        const suite = loadSuiteConfig(suitePath);
        disabledAgents = [...(suite.disabledAgents ?? [])];
        customAgentIds = new Set(Object.keys(suite.customAgents ?? {}).map(normalizeAgentId));
        suiteConfigLoaded = true;
        if (existsSync(suitePath)) suiteFileExisted = true;
        applyRuntimeDisabledAgents(config, disabledAgents);
        applyRuntimeBuiltInOverrides(config, suite.builtInOverrides ?? {});
        applyRuntimeTaskPermission(config, disabledAgents, configuredAgents);
        applyRuntimeModelAssignments(config, suite.modelAssignments, suite.variantAssignments);
      } catch {
        suiteConfigLoaded = false;
        applyRuntimeTaskPermission(config, disabledAgents, configuredAgents); /* TUI reports malformed suite config. */
      }
      registeredAgents.clear();
      for (const agentID of configuredAgents) registeredAgents.add(normalizeAgentId(agentID));
    },
  };
};
export async function setupAgentSuiteServer(ctx: V2Plugin.Context, options: Pick<AgentSuiteServerOptions, "onMilestone"> = {}): Promise<() => Promise<void>> {
  const hooks = await serverPlugin({
    client: { session: { messages: async ({ path }: { path: { id: string } }) => ({
      data: [{ info: { role: "user", agent: (await ctx.session.get({ sessionID: path.id })).agent } }],
    }) } },
  } as unknown as PluginInput);
  const registrations: Array<{ dispose(): Promise<void> }> = [];
  const abort = new AbortController();
  const pendingMilestones = new Map<string, string>();
  const notifyMilestone = async (milestone: string, sessionID: string) => {
    try {
      if (options.onMilestone) await options.onMilestone(milestone, sessionID);
      else await handleTaskManagerMilestoneEvent(milestone, sessionID, { projectDirectory: ctx.location.directory, client: { session: ctx.session, nativeV2: true } });
    } catch (error) { console.error("Agent suite milestone dispatch failed", error); }
  };
  try {
    registrations.push(await ctx.agent.transform((editor) => {
      const agents = editor.list();
      const config = { permission: {}, agent: Object.fromEntries(agents.map((agent) => [agent.id, {
        model: agent.model ? `${agent.model.providerID}/${agent.model.id}` : undefined,
        variant: agent.model?.variant, description: agent.description, prompt: agent.system,
      }])) };
      // Reuse the synchronous policy configuration without the V1 host lifecycle.
      void hooks.config?.(config as PluginConfig);
      for (const agent of agents) {
        const id = String(agent.id);
        const entry = config.agent[normalizeAgentId(id)];
        if (!entry) { editor.remove(id); continue; }
        editor.update(id, (draft) => {
          if (entry.model) draft.model = { ...Model.Ref.parse(entry.model), ...(entry.variant === undefined ? {} : { variant: entry.variant as NonNullable<typeof draft.model>["variant"] }) };
          draft.description = entry.description;
          draft.system = entry.prompt;
          const rules = transformTaskPermission([], Object.keys(config.agent));
          const taskRules = (config.permission as RuntimePermission).task ?? rules;
          draft.permissions = [...draft.permissions.filter((rule) => rule.action !== "task"),
            ...Object.entries(taskRules).map(([resource, effect]) => ({ action: "task", resource, effect }))];
        });
      }
    }));
    registrations.push(await ctx.session.hook("prompt", async (input) => {
      const milestone = /^\/(sdd-tasks|sdd-verify|sdd-archive|verified-significant)(?:\s|$)/.exec(input.prompt.text)?.[1];
      if (milestone) pendingMilestones.set(input.sessionID, milestone);
      else pendingMilestones.delete(input.sessionID);
      const agent = (await ctx.session.get({ sessionID: input.sessionID })).agent;
      const existing = input.prompt.agents ?? [];
      const parts = [{ type: "text", text: input.prompt.text }, ...existing.map((item) => ({ type: "agent", name: item.name }))];
      await hooks["chat.message"]?.({ sessionID: input.sessionID, messageID: input.messageID, agent }, { message: { id: input.messageID, agent }, parts } as never);
      input.prompt.agents = parts.flatMap((part) => "name" in part ? [existing.find((item) => item.name === part.name) ?? { name: part.name }] : []);
    }));
    registrations.push(await ctx.tool.hook("execute.before", async (input) => {
      if (!input.input || typeof input.input !== "object" || Array.isArray(input.input)) {
        if (input.tool === "task") throw new Error("Suite de Agentes: task input must be an object");
        return;
      }
      await hooks["tool.execute.before"]?.({ tool: input.tool, sessionID: input.sessionID, callID: input.id }, { args: input.input as Record<string, unknown> });
    }));
    registrations.push(await ctx.command.transform((editor) => {
      for (const command of ["agent-suite-grants", "agent-suite-revoke"]) editor.add({
        name: command,
        execute: async ({ sessionID, prompt }) => {
          const output = { parts: [] as Part[] };
          await hooks["command.execute.before"]?.({ command, sessionID, arguments: prompt.text }, output);
          if (output.parts.length) await ctx.session.synthetic({ sessionID, text: messageText({ sessionID, messageID: "grants", parts: output.parts }) });
        },
      });
    }));
    registrations.push(await ctx.tool.hook("execute.after", async (input) => {
      if (input.tool !== "task" || input.status !== "completed" || input.agent === "agent-task-manager") return;
      const target = input.input && typeof input.input === "object" && "subagent_type" in input.input ? input.input.subagent_type : undefined;
      if (typeof target === "string" && shouldEnqueueMilestoneEvent(target)) await notifyMilestone(target, input.sessionID);
    }));
    const events = (async () => {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        if (event.type === "session.deleted") {
          pendingMilestones.delete(event.data.sessionID);
          await hooks.event?.({ event: { type: "session.deleted", properties: { info: { id: event.data.sessionID } } } } as never);
        } else if (event.type === "session.execution.succeeded") {
          const milestone = pendingMilestones.get(event.data.sessionID);
          pendingMilestones.delete(event.data.sessionID);
          if (milestone) await notifyMilestone(milestone, event.data.sessionID);
        } else if (event.type === "session.execution.failed" || event.type === "session.execution.interrupted") pendingMilestones.delete(event.data.sessionID);
      }
    })();
    void events.catch((error) => { if (!abort.signal.aborted) console.error("Agent suite event subscription failed", error); });
    return async () => { abort.abort(); await Promise.all(registrations.map((registration) => registration.dispose())); };
  } catch (error) {
    abort.abort();
    await Promise.all(registrations.map((registration) => registration.dispose()));
    throw error;
  }
}
const plugin = V2Plugin.define({ id: "agent-suite", setup: setupAgentSuiteServer });
export default plugin;
export { ConsentLedger };
