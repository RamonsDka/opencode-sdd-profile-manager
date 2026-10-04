/** @jsxImportSource @opentui/solid */
import type { ProfileData, ProfileConfigs } from "./types";
import { deriveFallbackProfileKey } from "./catalog";
import { isEditablePrimaryAgent, RESERVED_RUNTIME_AGENT_NAMES } from "./utils";
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

export type ReasoningVariantOption = { variantId: string; label: string; effort?: string };

function hasNativeVariants(modelDef: any): boolean {
  return Object.values(modelDef?.variants || {}).some((variant: any) =>
    variant && ("settings" in variant || "id" in variant || "body" in variant || "headers" in variant));
}

/** Native IDs remain distinct even when multiple variants use the same effort. */
export function getReasoningVariantOptions(providers: readonly any[], modelId?: string): ReasoningVariantOption[] {
  const modelDef = resolveModelDefinition(providers, modelId || "");
  if (!hasNativeVariants(modelDef)) return [];
  return Object.entries(modelDef.variants).map(([variantId, variant]: [string, any]) => ({
    variantId,
    label: variantId,
    ...(typeof variant?.settings?.reasoningEffort === "string" ? { effort: variant.settings.reasoningEffort } : {}),
  }));
}

function listReasoningEffortsFromModel(modelDef: any): string[] {
  if (!modelDef) return [];
  const variants = modelDef?.variants;
  if (!variants || typeof variants !== "object") return [];
  if (hasNativeVariants(modelDef)) return Object.keys(variants);
  if (modelDef?.capabilities?.reasoning !== true) return [];
  const values = Object.values(variants)
    .map((variant: any) => typeof variant?.reasoningEffort === "string" ? variant.reasoningEffort.trim() : "")
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
  const next = { ...configs };
  const canonicalEffort =
    next?.[policy.canonicalName]?.reasoningEffort ||
    next?.[LEGACY_ORCHESTRATOR]?.reasoningEffort ||
    next?.[UPDATED_ORCHESTRATOR]?.reasoningEffort;
  const canonicalVariant = next?.[policy.canonicalName]?.nativeVariant ||
    next?.[LEGACY_ORCHESTRATOR]?.nativeVariant || next?.[UPDATED_ORCHESTRATOR]?.nativeVariant;

  delete next[LEGACY_ORCHESTRATOR];
  delete next[UPDATED_ORCHESTRATOR];
  if (canonicalEffort || canonicalVariant) {
    next[policy.canonicalName] = {
      ...next[policy.canonicalName],
      ...(canonicalEffort ? { reasoningEffort: canonicalEffort } : {}),
      ...(canonicalVariant ? { nativeVariant: canonicalVariant } : {}),
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
): { kind: "configured"; value: string; option: string; label: string; nativeVariant?: string } | {
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
    throw new Error(`Reasoning effort '${normalized}' is not available for ${modelId}`);
  }
  return { kind: "configured", value: normalized, option: normalized, label: normalized,
    ...(getReasoningVariantOptions(providers, modelId).some(option => option.variantId === normalized) ? { nativeVariant: normalized } : {}),
  };
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
    ...(getReasoningVariantOptions(providers, modelId).length ? { variantOptions: getReasoningVariantOptions(providers, modelId) } : {}),
    options: [PROVIDER_DEFAULT_REASONING_EFFORT, ...options.filter((opt) => opt !== PROVIDER_DEFAULT_REASONING_EFFORT)],
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
        const nativeVariant = normalizeReasoningEffortValue(config?.nativeVariant);
        return effort || nativeVariant ? [agentName, {
          ...(effort ? { reasoningEffort: effort } : {}),
          ...(nativeVariant ? { nativeVariant } : {}),
        }] : null;
      })
      .filter(Boolean) as any,
  );
  const normalized = policy ? canonicalizeProfileConfigs(normalizedBase, policy) : normalizedBase;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function updateProfileReasoningEffort(profile: ProfileData, agentName: string, value?: string, providers?: readonly any[]): ProfileData {
  if (!isReasoningOwner(agentName)) return profile;
  const nextConfigs: Record<string, any> = { ...profile?.configs };
  const trimmed = normalizeReasoningEffortValue(value) || "";
  if (!trimmed) delete nextConfigs[agentName];
  else if (providers && getReasoningVariantOptions(providers, profile.models?.[agentName]).some(option => option.variantId === trimmed)) {
    nextConfigs[agentName] = { nativeVariant: trimmed };
  } else nextConfigs[agentName] = { reasoningEffort: trimmed };
  const normalized = normalizeProfileConfigs(nextConfigs);
  const nextProfile: any = { ...(profile || { models: {} }) };
  delete nextProfile.configs;
  if (normalized) nextProfile.configs = normalized;
  return nextProfile;
}

export function clearProfileReasoningEffort(profile: ProfileData, agentName: string): ProfileData {
  const nextConfigs: Record<string, any> = { ...profile?.configs };
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
    .map((name) => profile?.configs?.[name]?.nativeVariant || profile?.configs?.[name]?.reasoningEffort)
    .find((effort) => typeof effort === "string" && effort.trim());
  if (!current || getReasoningEffortOptions(providers, modelId).includes(current)) return profile;
  return clearProfileReasoningEffort(profile, agentName);
}

function clearAgentReasoningEffort(agentConfig: any): boolean {
  if (!agentConfig || typeof agentConfig !== "object") return false;
  const hadEffort = Object.hasOwn(agentConfig, "reasoningEffort")
    || Object.hasOwn(agentConfig, "variant")
    || (agentConfig.options && typeof agentConfig.options === "object" && Object.hasOwn(agentConfig.options, "reasoningEffort"));
  delete agentConfig.reasoningEffort;
  delete agentConfig.variant;
  if (agentConfig.request?.body) delete agentConfig.request.body.reasoningEffort;
  if (agentConfig.options && typeof agentConfig.options === "object") delete agentConfig.options.reasoningEffort;
  return hadEffort;
}

function applyAgentReasoningEffort(agentConfig: any, effort: string): any {
  return {
    ...agentConfig,
    reasoningEffort: effort,
    options: {
      ...((agentConfig && typeof agentConfig.options === "object") ? agentConfig.options : {}),
      reasoningEffort: effort,
    },
  };
}

export function applyProfileReasoningEffort(currentConfig: any, profile: ProfileData, providers: any[], policy?: OrchestratorPolicy, scopedActivation = false): {
  config: any;
  warnings: string[];
  appliedAgents: string[];
  clearedAgents: string[];
} {
  const nextConfig = JSON.parse(JSON.stringify(currentConfig || {}));
  if (!nextConfig.agent || typeof nextConfig.agent !== "object" || Array.isArray(nextConfig.agent)) {
    nextConfig.agent = {};
  }
  const warnings: string[] = [];
  const appliedAgents: string[] = [];
  const clearedAgents: string[] = [];
  const effectivePolicy = policy || getOrchestratorPolicy(
    [...Object.keys(nextConfig?.agent || {}), ...Object.keys(profile?.models || {}), ...Object.keys(profile?.configs || {})],
    nextConfig?.default_agent,
  );
  const normalizedConfigs = normalizeProfileConfigs(profile?.configs, policy ? effectivePolicy : undefined, true);
  const reasoningOwner = (agentName: string) => isReasoningOwner(agentName, policy ? effectivePolicy : undefined);

  for (const [agentName, agentConfig] of Object.entries(nextConfig?.agent || {})) {
    if (scopedActivation) continue;
    if (isFallbackOrReservedAgent(agentName) && agentName !== effectivePolicy.canonicalName && clearAgentReasoningEffort(agentConfig)) {
      clearedAgents.push(agentName);
    }
  }

  const scopedPrimaries = Object.keys(canonicalizeProfileModels(profile?.models || {}, effectivePolicy))
    .filter(reasoningOwner);
  const configuredAgents = new Set(Object.keys(normalizedConfigs || {}));
  for (const agentName of scopedPrimaries) {
    if (configuredAgents.has(agentName)) continue;
    if (nextConfig?.agent?.[agentName] && clearAgentReasoningEffort(nextConfig.agent[agentName])) {
      clearedAgents.push(agentName);
    }
  }

  for (const [agentName, cfg] of Object.entries(normalizedConfigs || {})) {
    if (!reasoningOwner(agentName)) continue;
    const runtimeAgent = nextConfig?.agent?.[agentName];
    const effort = cfg?.reasoningEffort;
    if ((!effort && !cfg.nativeVariant) || !runtimeAgent || typeof runtimeAgent !== "object") continue;
    if (effort === PROVIDER_DEFAULT_REASONING_EFFORT) {
      if (clearAgentReasoningEffort(runtimeAgent)) clearedAgents.push(agentName);
      continue;
    }
    const modelId = runtimeAgent.model;
    const modelDef = resolveModelDefinition(providers, modelId);
    const nativeOptions = getReasoningVariantOptions(providers, modelId);
    if (cfg.nativeVariant || nativeOptions.length) {
      const matches = cfg.nativeVariant
        ? nativeOptions.filter(option => option.variantId === cfg.nativeVariant)
        : nativeOptions.filter(option => option.effort === effort);
      if (matches.length !== 1) {
        warnings.push(`Skipped native variant for ${agentName}: ${!modelDef ? "exact model not found" : matches.length > 1 ? "ambiguous legacy effort" : "incompatible saved value"} for ${modelId}.`);
        continue;
      }
      clearAgentReasoningEffort(runtimeAgent);
      runtimeAgent.variant = matches[0].variantId;
      appliedAgents.push(agentName);
      continue;
    }
    const options = getReasoningEffortOptions(providers, modelId);
    if (options.length === 0) {
      const diagnostic = !modelDef ? "exact model not found"
        : modelDef?.capabilities?.reasoning === false ? "model reasoning unsupported"
        : "no effort variant metadata";
      warnings.push(`Skipped reasoning effort for ${agentName}: ${diagnostic} for ${modelId}.`);
      continue;
    }
    if (!effort) continue;
    if (!options.includes(effort)) {
      const previous = runtimeAgent.reasoningEffort || runtimeAgent.options?.reasoningEffort;
      if (!options.includes(previous) && clearAgentReasoningEffort(runtimeAgent)) clearedAgents.push(agentName);
      warnings.push(`Skipped reasoning effort for ${agentName}: saved value '${effort}' is incompatible with ${modelId}.`);
      continue;
    }
    nextConfig.agent[agentName] = applyAgentReasoningEffort(runtimeAgent, effort);
    appliedAgents.push(agentName);
  }

  return { config: nextConfig, warnings, appliedAgents, clearedAgents: Array.from(new Set(clearedAgents)) };
}