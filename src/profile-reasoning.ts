/** @jsxImportSource @opentui/solid */
import type { ProfileData, ProfileConfigs } from "./types";
import { deriveFallbackProfileKey } from "./catalog";
import { isEditablePrimaryAgent, isPrimarySddAgent, isSddFallbackAgent, RESERVED_RUNTIME_AGENT_NAMES } from "./utils";
import {
  LEGACY_ORCHESTRATOR,
  UPDATED_ORCHESTRATOR,
  canonicalizeProfileModels,
  getOrchestratorPolicy,
  type OrchestratorPolicy,
} from "./orchestrator";

export const PROVIDER_DEFAULT_REASONING_EFFORT = "provider-default" as const;
export const DEFAULT_REASONING_EFFORT_LABEL = "Predeterminado" as const;

function normalizeReasoningEffortValue(value?: string, preserveProviderDefault = false): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (preserveProviderDefault && trimmed === PROVIDER_DEFAULT_REASONING_EFFORT) {
    return PROVIDER_DEFAULT_REASONING_EFFORT;
  }
  return trimmed && trimmed !== PROVIDER_DEFAULT_REASONING_EFFORT && trimmed !== DEFAULT_REASONING_EFFORT_LABEL
    ? trimmed
    : undefined;
}

function resolveModelDefinition(providers: readonly any[], modelId: string): any | null {
  if (!modelId || typeof modelId !== "string") return null;
  const [providerId, ...rest] = modelId.split("/");
  const modelKey = rest.join("/");
  if (!providerId || !modelKey) return null;
  return (providers || []).find((provider: any) => provider?.id === providerId)?.models?.[modelKey] || null;
}

function listReasoningEffortsFromModel(modelDef: any): string[] {
  if (!modelDef || modelDef?.capabilities?.reasoning !== true) return [];
  const variants = modelDef?.variants;
  if (!variants || typeof variants !== "object") return [];
  const values = Object.values(variants)
    .map((variant: any) => (typeof variant?.reasoningEffort === "string" ? variant.reasoningEffort.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(values)).sort();
}

function isReasoningOwner(agentName: string, policy?: OrchestratorPolicy): boolean {
  return isEditablePrimaryAgent(agentName) || Boolean(policy?.aliasNames.includes(agentName as typeof LEGACY_ORCHESTRATOR | typeof UPDATED_ORCHESTRATOR));
}

function isFallbackOrReservedAgent(agentName: string): boolean {
  return agentName.endsWith("-fallback") || RESERVED_RUNTIME_AGENT_NAMES.has(agentName);
}

function isStoredReasoningOwner(
  agentName: string,
  policy?: OrchestratorPolicy,
  fallbackModels?: Record<string, string>,
): boolean {
  if (isReasoningOwner(agentName, policy)) return true;
  const fallbackOwner = deriveFallbackProfileKey(agentName);
  return Boolean(fallbackOwner && fallbackModels?.[fallbackOwner]);
}

function canonicalizeProfileConfigs(configs: ProfileConfigs, policy: OrchestratorPolicy): ProfileConfigs {
  const next = { ...(configs || {}) };
  const canonicalEffort =
    next?.[policy.canonicalName]?.reasoningEffort ||
    next?.[LEGACY_ORCHESTRATOR]?.reasoningEffort ||
    next?.[UPDATED_ORCHESTRATOR]?.reasoningEffort;

  delete next[LEGACY_ORCHESTRATOR];
  delete next[UPDATED_ORCHESTRATOR];

  if (canonicalEffort) {
    next[policy.canonicalName] = {
      ...(next[policy.canonicalName] || {}),
      reasoningEffort: canonicalEffort,
    };
  }

  return next;
}

export function getReasoningEffortOptions(providers: readonly any[], modelId?: string): string[] {
  return listReasoningEffortsFromModel(resolveModelDefinition(providers, modelId || ""));
}

export function resolveReasoningEffortSelection(
  providers: readonly any[],
  modelId: string,
  selection: string,
): { kind: "configured"; value: string; option: string; label: string } | {
  kind: "provider-default";
  value: undefined;
  option: typeof PROVIDER_DEFAULT_REASONING_EFFORT;
  label: typeof DEFAULT_REASONING_EFFORT_LABEL;
} {
  const normalized = normalizeReasoningEffortValue(selection);
  if (!normalized) {
    return {
      kind: "provider-default",
      value: undefined,
      option: PROVIDER_DEFAULT_REASONING_EFFORT,
      label: DEFAULT_REASONING_EFFORT_LABEL,
    };
  }
  const options = getReasoningEffortOptions(providers, modelId);
  if (!options.includes(normalized)) {
    throw new Error("Reasoning effort '" + normalized + "' is not available for " + modelId);
  }
  return { kind: "configured", value: normalized, option: normalized, label: normalized };
}

export function buildReasoningEditState(
  providers: readonly any[],
  agentName: string,
  modelId?: string,
  current?: string,
): any {
  if (!isReasoningOwner(agentName)) return { kind: "ineligible", agentName };
  if (!modelId) return { kind: "missing-model", agentName };
  const options = getReasoningEffortOptions(providers, modelId);
  if (options.length === 0) {
    return {
      kind: "provider-default",
      agentName,
      modelId,
      options: [PROVIDER_DEFAULT_REASONING_EFFORT],
      optionLabel: DEFAULT_REASONING_EFFORT_LABEL,
    };
  }
  return {
    kind: "selectable",
    agentName,
    modelId,
    options,
    ...(normalizeReasoningEffortValue(current) ? { current: normalizeReasoningEffortValue(current) } : {}),
  };
}

export function normalizeProfileConfigs(
  configs: unknown,
  policy?: OrchestratorPolicy,
  preserveProviderDefault = false,
  fallbackModels?: Record<string, string>,
): ProfileConfigs | undefined {
  if (!configs || typeof configs !== "object" || Array.isArray(configs)) return undefined;
  const normalizedBase = Object.fromEntries(
    Object.entries(configs as Record<string, any>)
      .filter(([agentName]) => isStoredReasoningOwner(agentName, policy, fallbackModels))
      .map(([agentName, config]) => {
        const effort = normalizeReasoningEffortValue(config?.reasoningEffort, preserveProviderDefault) || "";
        return effort ? [agentName, { reasoningEffort: effort }] : null;
      })
      .filter(Boolean) as any,
  );

  const normalized = policy ? canonicalizeProfileConfigs(normalizedBase, policy) : normalizedBase;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function updateProfileReasoningEffort(profile: ProfileData, agentName: string, value?: string): ProfileData {
  if (!isPrimarySddAgent(agentName) || isSddFallbackAgent(agentName)) {
    return profile;
  }

  const nextConfigs: Record<string, any> = { ...(profile?.configs || {}) };
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    delete nextConfigs[agentName];
  } else {
    nextConfigs[agentName] = {
      ...(nextConfigs[agentName] || {}),
      reasoningEffort: trimmed,
    };
  }

  const normalized = normalizeProfileConfigs(nextConfigs);
  const nextProfile: any = {
    ...(profile || { models: {} }),
  };
  delete nextProfile.configs;
  if (normalized) nextProfile.configs = normalized;
  return nextProfile;
}

export function clearProfileReasoningEffort(profile: ProfileData, agentName: string): ProfileData {
  const nextConfigs: Record<string, any> = { ...(profile?.configs || {}) };
  delete nextConfigs[agentName];
  if (agentName === LEGACY_ORCHESTRATOR || agentName === UPDATED_ORCHESTRATOR) {
    delete nextConfigs[LEGACY_ORCHESTRATOR];
    delete nextConfigs[UPDATED_ORCHESTRATOR];
  }
  const normalized = normalizeProfileConfigs(nextConfigs);
  const nextProfile: any = { ...(profile || { models: {} }) };
  delete nextProfile.configs;
  if (normalized) nextProfile.configs = normalized;
  return nextProfile;
}

export function pruneProfileReasoningEffort(
  profile: ProfileData,
  agentName: string,
  modelId: string,
  providers: readonly any[],
  policy?: OrchestratorPolicy,
): ProfileData {
  if (!isReasoningOwner(agentName, policy)) return profile;
  const storedNames = policy?.aliasNames.includes(agentName as typeof LEGACY_ORCHESTRATOR | typeof UPDATED_ORCHESTRATOR)
    ? policy.aliasNames
    : [agentName];
  const current = storedNames
    .map((name) => profile?.configs?.[name]?.reasoningEffort)
    .find((effort) => typeof effort === "string" && effort.trim());
  if (!current || getReasoningEffortOptions(providers, modelId).includes(current)) return profile;
  return clearProfileReasoningEffort(profile, agentName);
}

function clearAgentReasoningEffort(agentConfig: any) {
  if (!agentConfig || typeof agentConfig !== "object") return;
  delete agentConfig.reasoningEffort;
  if (agentConfig.options && typeof agentConfig.options === "object") {
    delete agentConfig.options.reasoningEffort;
  }
}

function applyAgentReasoningEffort(agentConfig: any, effort: string) {
  const next = {
    ...(agentConfig || {}),
    reasoningEffort: effort,
    options: {
      ...((agentConfig && typeof agentConfig.options === "object") ? agentConfig.options : {}),
      reasoningEffort: effort,
    },
  };
  return next;
}

export function applyProfileReasoningEffort(currentConfig: any, profile: ProfileData, providers: any[], policy?: OrchestratorPolicy): {
  config: any;
  warnings: string[];
  appliedAgents: string[];
  clearedAgents: string[];
} {
  const nextConfig = JSON.parse(JSON.stringify(currentConfig || {}));
  const warnings: string[] = [];
  const appliedAgents: string[] = [];
  const clearedAgents: string[] = [];
  const effectivePolicy = policy || getOrchestratorPolicy(
    [
      ...Object.keys(nextConfig?.agent || {}),
      ...Object.keys(profile?.models || {}),
      ...Object.keys(profile?.configs || {}),
    ],
    nextConfig?.default_agent,
  );
  const normalizedConfigs = normalizeProfileConfigs(profile?.configs, effectivePolicy);

  const scopedPrimaryAgents = Object.keys(
    canonicalizeProfileModels(profile?.models || {}, effectivePolicy)
  ).filter((agentName) => isPrimarySddAgent(agentName) && !isSddFallbackAgent(agentName));

  const configuredAgents = new Set(Object.keys(normalizedConfigs || {}));
  for (const agentName of scopedPrimaryAgents) {
    if (configuredAgents.has(agentName)) continue;
    if (nextConfig?.agent?.[agentName] && typeof nextConfig.agent[agentName] === "object") {
      clearAgentReasoningEffort(nextConfig.agent[agentName]);
      clearedAgents.push(agentName);
    }
  }

  if (!normalizedConfigs) {
    return { config: nextConfig, warnings, appliedAgents, clearedAgents };
  }

  for (const [agentName, cfg] of Object.entries(normalizedConfigs)) {
    if (!isPrimarySddAgent(agentName) || isSddFallbackAgent(agentName)) continue;
    const effort = cfg?.reasoningEffort;
    if (!effort) continue;
    const modelId = nextConfig?.agent?.[agentName]?.model;
    if (!modelId) continue;

    const modelDef = resolveModelDefinition(providers, modelId);
    const options = listReasoningEffortsFromModel(modelDef);
    if (!modelDef || options.length === 0) {
      if (nextConfig?.agent?.[agentName] && typeof nextConfig.agent[agentName] === "object") {
        clearAgentReasoningEffort(nextConfig.agent[agentName]);
        clearedAgents.push(agentName);
      }
      warnings.push("Skipped reasoning effort for " + agentName + ": missing runtime metadata for " + modelId + ".");
      continue;
    }
    if (!options.includes(effort)) {
      if (nextConfig?.agent?.[agentName] && typeof nextConfig.agent[agentName] === "object") {
        clearAgentReasoningEffort(nextConfig.agent[agentName]);
        clearedAgents.push(agentName);
      }
      warnings.push("Skipped reasoning effort for " + agentName + ": saved value '" + effort + "' is incompatible with " + modelId + ".");
      continue;
    }

    if (!nextConfig.agent) nextConfig.agent = {};
    nextConfig.agent[agentName] = applyAgentReasoningEffort(nextConfig.agent[agentName], effort);
    appliedAgents.push(agentName);
  }

  return { config: nextConfig, warnings, appliedAgents, clearedAgents: Array.from(new Set(clearedAgents)) };
}
