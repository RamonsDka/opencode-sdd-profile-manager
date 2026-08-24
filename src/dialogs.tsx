/** @jsxImportSource @opentui/solid */
/**
 * Plugin UI Dialogs
 * 
 * Contains all interactive dialogs for profile management, model selection,
 * and memory viewing.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  BULK_ASSIGNMENT_MODE,
  BULK_ASSIGNMENT_TARGET,
  BulkAssignmentOperation,
  PROFILE_VERSION_SOURCE,
  ProfileVersion,
  ProfileVersionMetadata,
  NAV_CATEGORY,
  type BadgeDisplayMode,
  type CatalogEntry,
  type AgentFamily,
  type ModelMutationContext,
} from "./types";
import {
  resolveModelInfo,
  formatMemoryDate,
  truncateText,
  parseActiveProfileFromRaw,
  formatContext,
  isFallbackEligibleSddAgent,
  isEditablePrimaryAgent,
  isPrimarySddAgent,
} from "./utils";
import { buildCatalogSections, CATALOG_GROUPS, isFallbackCatalogAgent } from "./catalog";
import { safeSetDialogSize } from "./host-compat";
import { resolveEngramProjectName, resolvePaths, ensureProfilesDir, resolveProjectName } from "./config";
import {
  listProfileFiles,
  readProfileData,
  sanitizeProfileName,
  writeProfileData,
  writeProfileModels,
  updateProfileWithBulkPhaseAssignment,
  updateProfilePhaseModel,
  updateProfileReasoningWithoutVersion,
  stageProfileModelSelection,
  commitPendingModelSelection,
  listProfileVersions,
  readProfileVersion,
  restoreProfileVersion,
  detectActiveProfileFile,
  activateProfileFile,
  deleteProfileFile,
  renameProfileFile,
} from "./profiles";
import { buildReasoningEditState, updateProfileReasoningEffort } from "./profile-reasoning";
import { deleteProjectMemory, listProjectMemories } from "./memories";
import {
  activeProfile,
  badgeDisplayMode,
  setActiveProfile,
  setBadgeDisplayMode,
  setShowModelBadge,
  showModelBadge,
} from "./state";
import { createLogger } from "./logger";
import { canonicalizeProfileModels, getOrchestratorPolicy, type OrchestratorPolicy } from "./orchestrator";

export const BADGE_VISIBLE_KV_KEY = "sdd-show-model-badge";
export const BADGE_DISPLAY_MODE_KV_KEY = "sdd-badge-display-mode";
export const ACTIVE_PROFILE_NAME_KV_KEY = "sdd-active-profile-name";

const log = createLogger("dialogs");

const UI_TEXT = {
  profile: "Perfil",
  primaryModels: "Modelos primarios",
  reasoningEffort: "Nivel de esfuerzo",
  fallbackModels: "Modelos fallback",
  back: "← Volver",
  inherited: "Heredado",
  defaultEffort: "Predeterminado",
  unconfigured: "Sin configurar",
  error: "Error",
  updated: "Actualizado",
  noChanges: "Sin cambios",
  deleted: "Eliminado",
  renamed: "Renombrado",
  restored: "Restaurado",
} as const;

const NAV_TEXT = {
  back: UI_TEXT.back,
  close: "✕ Cerrar",
  deleteMemory: "✕ Eliminar memoria",
  noProviders: "Sin proveedores",
  noProfiles: "Sin perfiles",
  noVersions: "Sin versiones",
  noMemories: "Sin memorias",
  profileManagement: "Gestión de perfiles SDD",
  createProfile: "󰏪 Crear nuevo perfil SDD",
  manageProfiles: "󰓅 Gestionar perfiles SDD",
  viewMemories: "󰄄 Ver memorias del proyecto",
  activate: "Activar",
} as const;

function buildCatalogRows<T>(
  groups: readonly (typeof CATALOG_GROUPS)[number][],
  mapAgent: (key: (typeof CATALOG_GROUPS)[number]["agents"][number]) => T,
): T[] {
  return groups.flatMap((group) => group.agents.map(mapAgent));
}

function buildBackOption() {
  return { title: NAV_TEXT.back, value: "__back__", category: NAV_CATEGORY };
}

function localizedModelInfo(api: any, modelId?: string): string {
  return modelId ? resolveModelInfo(api, modelId).replace("ctx: N/A", "contexto: N/D") : "Sin asignar";
}

function localizedEffortLabel(value: string): string {
  if (value === "provider-default") return UI_TEXT.defaultEffort;
  return value;
}

function localizedFamilyLabel(family: AgentFamily): string {
  return {
    Orchestrator: "Orquestador",
    SDD: "Núcleo SDD",
    JD: "Día del Juicio",
    Review: "Revisores",
    Tools: "Herramientas",
    Fallbacks: UI_TEXT.fallbackModels,
    Custom: "Personalizados",
  }[family];
}

function catalogCategory(agentName: string): string {
  return CATALOG_GROUPS.find((group) => group.agents.includes(agentName as never))?.labelEs || UI_TEXT.primaryModels;
}

function localizedMemoryScope(scope?: string): string {
  return scope === "project" || !scope ? "proyecto" : scope;
}

function localizedMemoryType(type?: string): string {
  return {
    architecture: "arquitectura",
    discovery: "descubrimiento",
    decision: "decisión",
    bugfix: "corrección",
    pattern: "patrón",
    manual: "manual",
  }[type || "manual"] || type || "manual";
}

const CATALOG_FAMILY_BY_GROUP = {
  orchestrator: "Orchestrator",
  "sdd-core": "SDD",
  "judgment-day": "JD",
  reviewers: "Review",
  auxiliaries: "Tools",
} as const;

function buildCatalogEntries(field: "model" | "fallback"): CatalogEntry[] {
  return CATALOG_GROUPS.flatMap((group, groupIndex) =>
    group.agents.map((key, agentIndex) => ({
      displayName: key,
      profileKey: key,
      field,
      family: CATALOG_FAMILY_BY_GROUP[group.id as keyof typeof CATALOG_FAMILY_BY_GROUP],
      base: true,
      isFallback: field === "fallback",
      orderIndex: groupIndex * 100 + agentIndex,
    })),
  );
}

export function resolveRuntimeOrchestratorPolicy(config: any): OrchestratorPolicy {
  return getOrchestratorPolicy(
    Object.keys(config?.agent || {}),
    config?.default_agent
  );
}

export function buildProfileAgentRows(
  sddAgentNames: string[],
  profileData: any,
  policy: OrchestratorPolicy
): Array<{ title: string; value: string; modelId?: string }> {
  const models = canonicalizeProfileModels(profileData?.models || {}, policy);
  const canonicalNames = Array.from(new Set([...sddAgentNames, policy.canonicalName]));
  return canonicalNames
    .filter((name) => name !== "sdd-orchestrator" || policy.canonicalName === "sdd-orchestrator")
    .filter((name) => name !== "gentle-orchestrator" || policy.canonicalName === "gentle-orchestrator")
    .map((name) => ({ title: name, value: `model:${name}`, modelId: models[name] }));
}

export function buildReasoningRowForAgent(profileData: any, agentName: string): { title: string; value: string; category: string } {
  const saved = profileData?.configs?.[agentName]?.reasoningEffort;
  return {
    title: `${agentName}: ${saved || "Sin asignar"}`,
    value: `reasoning:${agentName}`,
    category: catalogCategory(agentName),
  };
}

export function buildReasoningBlockedMessage(state: any): string {
  if (state?.kind === "missing-model") return `Asigna un modelo primario a ${state.agentName} antes de editar el esfuerzo de razonamiento.`;
  if (state?.kind === "unsupported") return `El modelo ${state.modelId} no expone opciones de esfuerzo de razonamiento.`;
  return "El esfuerzo de razonamiento no se puede editar para esta selección.";
}

export const PROFILE_DETAIL_SUBMENU = {
  PRIMARY: "__submenu_primary__",
  REASONING: "__submenu_reasoning__",
  FALLBACK: "__submenu_fallback__",
} as const;

export type ProfileDetailReturnTarget = "hub" | "primary" | "reasoning" | "fallback";

export function returnToProfileDetailTarget(
  api: any,
  profileOpt: any,
  returnTarget: ProfileDetailReturnTarget = "hub",
  deps?: any
) {
  const showHub = deps?.showProfileDetail || showProfileDetailFn;
  const readProfile = deps?.readProfileData || readProfileData;
  const buildSections = deps?.buildProfileDetailAgentSections || buildProfileDetailAgentSections;
  const showPrimary = deps?.showProfileDetailSubmenuPrimary || showProfileDetailSubmenuPrimary;
  const showReasoning = deps?.showProfileDetailSubmenuReasoning || showProfileDetailSubmenuReasoning;
  const showFallback = deps?.showProfileDetailSubmenuFallback || showProfileDetailSubmenuFallback;

  if (returnTarget === "hub") {
    showHub(api, profileOpt);
    return;
  }

  try {
    const { profilesDir } = resolvePaths();
    const profilePath = path.join(profilesDir, profileOpt.value);
    const profileData = readProfile(profilePath);
    const sections = buildSections(api.state.config, profileData);

    if (returnTarget === "primary") showPrimary(api, profileOpt, profileData, sections);
    else if (returnTarget === "reasoning") showReasoning(api, profileOpt, profileData, sections);
    else showFallback(api, profileOpt, profileData, sections);
  } catch (error) {
    log.warn(`returnToProfileDetailTarget: failed to return to ${returnTarget} for ${profileOpt?.value}`, error);
    showHub(api, profileOpt);
  }
}

export function resolveProfileDetailNavigationAction(optionValue: string):
  | { action: "submenu-primary" }
  | { action: "submenu-reasoning" }
  | { action: "submenu-fallback" }
  | { action: "back" }
  | { action: "selection" }
  | { action: "noop" } {
  if (!optionValue) return { action: "noop" };
  if (optionValue === PROFILE_DETAIL_SUBMENU.PRIMARY) return { action: "submenu-primary" };
  if (optionValue === PROFILE_DETAIL_SUBMENU.REASONING) return { action: "submenu-reasoning" };
  if (optionValue === PROFILE_DETAIL_SUBMENU.FALLBACK) return { action: "submenu-fallback" };
  if (optionValue === "__back__") return { action: "back" };
  if (optionValue.startsWith("__")) return { action: "noop" };
  if (
    optionValue.startsWith("model:")
    || optionValue.startsWith("reasoning:")
    || optionValue.startsWith("fallback:")
  ) {
    return { action: "selection" };
  }
  return { action: "noop" };
}

export function buildProfileDetailHubOptions(api: any, profileOpt: any, profileData: any) {
  const { sddAgents, fallbackAgents } = buildProfileDetailAgentSections(api.state.config, profileData);
  const reasoningSaved = sddAgents.filter(([name]) => Boolean(profileData?.configs?.[name]?.reasoningEffort)).length;
  const reasoningSummary = `${reasoningSaved}/${sddAgents.length} guardados`;
  const fallbackConfigured = fallbackAgents.filter(([, modelId]) => Boolean(modelId)).length;
  const fallbackSummary = `${fallbackConfigured}/${fallbackAgents.length} configurados`;

  return [
    { title: `✏ Nombre: ${profileOpt.title}`, value: "__rename__", category: UI_TEXT.profile },
    {
      title: "Acciones masivas...",
      value: "__bulk_actions__",
      description: "Completa o sobrescribe asignaciones primarias y fallback de fases SDD",
      category: "Navegación de modelos",
    },
    ...buildPrimaryModelOptions(profileData, api),
    {
      title: `${UI_TEXT.reasoningEffort}...`,
      value: PROFILE_DETAIL_SUBMENU.REASONING,
      description: reasoningSummary,
      category: "Navegación",
    },
    {
      title: `${UI_TEXT.fallbackModels}...`,
      value: PROFILE_DETAIL_SUBMENU.FALLBACK,
      description: fallbackSummary,
      category: "Navegación",
    },
    {
      title: "Versiones del perfil...",
      value: "__profile_versions__",
      description: "Previsualiza y restaura versiones anteriores del perfil",
      category: "Agentes",
    },
    { title: "✓ Activar perfil", value: "__assign__", category: NAV_CATEGORY },
    { title: "✕ Eliminar perfil", value: "__delete__", category: NAV_CATEGORY },
    buildBackOption(),
  ];
}

export function resolveProfileDetailSelectionAction(optionValue: string):
  | { action: "model"; agentName: string }
  | { action: "reasoning"; agentName: string }
  | { action: "fallback"; agentName: string }
  | { action: "noop" } {
  if (!optionValue || optionValue.startsWith("__")) return { action: "noop" };
  if (optionValue.startsWith("model:")) return { action: "model", agentName: optionValue.replace("model:", "") };
  if (optionValue.startsWith("reasoning:")) return { action: "reasoning", agentName: optionValue.replace("reasoning:", "") };
  if (optionValue.startsWith("fallback:")) return { action: "fallback", agentName: optionValue.replace("fallback:", "") };
  return { action: "noop" };
}

export function buildProfileDetailAgentSections(
  config: any,
  profileData: any
): {
  sddAgentNames: string[];
  sddAgents: Array<[string, string | undefined]>;
  fallbackAgents: Array<[string, string | undefined]>;
  policy: OrchestratorPolicy;
  catalogSections: Map<AgentFamily, CatalogEntry[]>;
} {
  const catalogSections = buildCatalogSections(config, profileData);
  const sddAgentNames = Object.keys(config?.agent || {})
    .filter(isPrimarySddAgent)
    .sort();
  const policy = resolveRuntimeOrchestratorPolicy(config);
  const sddAgents = buildProfileAgentRows(sddAgentNames, profileData, policy)
    .map((row) => [row.title, row.modelId] as [string, string | undefined]);
  const fallbackModelMap = profileData?.fallback || {};
  const fallbackAgents = sddAgentNames
    .filter((name) => isFallbackEligibleSddAgent(name))
    .map((name) => [name, fallbackModelMap[name]] as [string, string | undefined]);

  return { sddAgentNames, sddAgents, fallbackAgents, policy, catalogSections };
}

function buildPrimaryModelOptions(profileData: any, api?: any) {
  const agentConfig = api?.state?.config?.agent ?? api?.agent ?? {};
  const policy = resolveRuntimeOrchestratorPolicy(api?.state?.config ?? { agent: agentConfig });
  const models = canonicalizeProfileModels(profileData?.models || {}, policy);
  const entries = buildCatalogEntries("model");

  return buildCatalogRows(CATALOG_GROUPS, (key) => {
    const entry = entries.find((candidate) => candidate.profileKey === key);
    if (!entry) return null;
      const modelId = entry.profileKey === "sdd-ORCHETATOR"
        ? models[policy.canonicalName]
        : models[entry.profileKey];
      const desc = api ? localizedModelInfo(api, modelId) : (modelId || "Sin asignar");
      const isUnconfigured = !Object.hasOwn(agentConfig, entry.displayName);
      const option: any = {
        title: entry.displayName,
        value: `model:${entry.profileKey}`,
        description: desc,
        category: catalogCategory(entry.profileKey),
      };
      if (isUnconfigured && entry.profileKey !== "sdd-spec") {
        option.badge = UI_TEXT.unconfigured;
      }
      return option;
  }).filter((option): option is NonNullable<typeof option> => option !== null);
}

export function buildPrimaryModelSubmenuOptions(profileData: any, sections: any, api?: any) {
  const options = buildPrimaryModelOptions(profileData, api);
  return [...options, buildBackOption()];
}

export function buildReasoningSubmenuOptions(profileData: any, sections: any) {
  const entries = buildCatalogEntries("model");

  const options = buildCatalogRows(CATALOG_GROUPS, (key) => {
    const entry = entries.find((candidate) => candidate.profileKey === key);
    return entry ? buildReasoningRowForAgent(profileData, entry.profileKey) : null;
  });
  return [...options.filter((option): option is NonNullable<typeof option> => option !== null), buildBackOption()];
}

export function buildFallbackSubmenuOptions(profileData: any, sections: any, api?: any) {
  const agentConfig = api?.state?.config?.agent ?? api?.agent ?? {};
  const entries = buildCatalogEntries("fallback");

  const options = buildCatalogRows(CATALOG_GROUPS, (key) => {
    if (!isFallbackCatalogAgent(key)) return null;
    const entry = entries.find((candidate) => candidate.profileKey === key);
    if (!entry) return null;
      const fallbackModel = profileData?.fallback?.[entry.profileKey];
      const desc = fallbackModel
        ? (api ? localizedModelInfo(api, fallbackModel) : fallbackModel)
        : UI_TEXT.inherited;
      const isUnconfigured = !Object.hasOwn(agentConfig, `${entry.profileKey}-fallback`);
      const option: any = {
        title: entry.displayName,
        value: `fallback:${entry.profileKey}`,
        description: desc,
        category: catalogCategory(entry.profileKey),
      };
      if (isUnconfigured && Boolean(fallbackModel)) {
        option.badge = UI_TEXT.unconfigured;
      }
      return option;
  });
  return [...options.filter((option): option is NonNullable<typeof option> => option !== null), buildBackOption()];
}

export function sanitizeMemoryDisplayText(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/→/g, "->");
}

export function wrapDisplayText(value: string, max = 80): string[] {
  if (!value) return [" "];
  const sanitized = sanitizeMemoryDisplayText(value);
  const words = sanitized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [" "];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (`${current} ${word}`.length <= max) {
      current = `${current} ${word}`;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [value];
}

/**
 * Displays a detailed view of a specific memory observation
 *
 * @param api - The TUI API instance
 * @param memory - The memory object to display
 */
export function showMemoryDetail(api: any, memory: any) {
  safeSetDialogSize(api, "xlarge");
  const title = memory.title || memory.topic_key || `Memoria #${memory.id}`;
  const metadata = `[${localizedMemoryType(memory.type).toUpperCase()}] ${formatMemoryDate(
    memory.updated_at || memory.created_at
  )} · ${localizedMemoryScope(memory.scope)}`;
  const contentLines = (memory.content || "Sin contenido")
    .split("\n")
    .flatMap((line: string) => wrapDisplayText(line || " ", 80));

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title={truncateText(title, 60)}
      options={[
        {
          title: metadata,
          value: "__meta__",
          category: "Memoria",
        },
        ...contentLines.map((line: string, index: number) => ({
          title: line || " ",
          value: `__line__${index}`,
        })),
        { title: NAV_TEXT.deleteMemory, value: "__delete__", category: NAV_CATEGORY },
        buildBackOption(),
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "__back__") showProjectMemoriesMenuFn(api);
        else if (opt.value === "__delete__") showDeleteMemory(api, memory);
        else showMemoryDetail(api, memory);
      }}
      onCancel={() => showProjectMemoriesMenuFn(api)}
    />
  ));
}

/**
 * Displays a confirmation dialog before deleting a memory
 * 
 * @param api - The TUI API instance
 * @param memory - The memory object to delete
 */
export function showDeleteMemory(api: any, memory: any) {
  safeSetDialogSize(api, "medium");
  const title = memory.title || memory.topic_key || `Memoria #${memory.id}`;

  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title="Eliminar memoria"
      message={`¿Eliminar permanentemente '${truncateText(title, 48)}'?`}
      onConfirm={async () => {
        try {
          await deleteProjectMemory(memory.id);
          api.ui.toast({ title: UI_TEXT.deleted, message: "Memoria eliminada correctamente", variant: "success" });
          showProjectMemoriesMenuFn(api);
        } catch (e: any) {
          log.error(`showDeleteMemory: failed to delete memory ${memory?.id}`, e);
          api.ui.toast({ title: UI_TEXT.error, message: e.message || "No se pudo eliminar la memoria", variant: "error" });
          showMemoryDetail(api, memory);
        }
      }}
      onCancel={() => showMemoryDetail(api, memory)}
    />
  ));
}

// Internal function references to resolve circular dependencies between dialogs
let showProfilesMenuFn: (api: any) => void | Promise<void>;
let showProfileListFn: (api: any) => void | Promise<void>;
let showProfileDetailFn: (api: any, profileOpt: any) => void | Promise<void>;
let showProjectMemoriesMenuFn: (api: any) => void | Promise<void>;

export type BulkProfileActionOption = {
  title: string;
  value: string;
  operation: BulkAssignmentOperation;
  requiresConfirmation: boolean;
};

export function buildBulkProfileActionOptions(): BulkProfileActionOption[] {
  return [
    {
      title: "Asignar todas las fases primarias",
      value: "bulk:fill-only:primary",
      operation: { target: BULK_ASSIGNMENT_TARGET.PRIMARY, mode: BULK_ASSIGNMENT_MODE.FILL_ONLY },
      requiresConfirmation: false,
    },
    {
      title: "Asignar todas las fases fallback",
      value: "bulk:fill-only:fallback",
      operation: { target: BULK_ASSIGNMENT_TARGET.FALLBACK, mode: BULK_ASSIGNMENT_MODE.FILL_ONLY },
      requiresConfirmation: false,
    },
    {
      title: "Asignar todas las fases y fallback",
      value: "bulk:fill-only:both",
      operation: { target: BULK_ASSIGNMENT_TARGET.BOTH, mode: BULK_ASSIGNMENT_MODE.FILL_ONLY },
      requiresConfirmation: false,
    },
    {
      title: "Sobrescribir todas las fases primarias",
      value: "bulk:overwrite:primary",
      operation: { target: BULK_ASSIGNMENT_TARGET.PRIMARY, mode: BULK_ASSIGNMENT_MODE.OVERWRITE },
      requiresConfirmation: true,
    },
    {
      title: "Sobrescribir todas las fases fallback",
      value: "bulk:overwrite:fallback",
      operation: { target: BULK_ASSIGNMENT_TARGET.FALLBACK, mode: BULK_ASSIGNMENT_MODE.OVERWRITE },
      requiresConfirmation: true,
    },
    {
      title: "Sobrescribir todas las fases y fallback",
      value: "bulk:overwrite:both",
      operation: { target: BULK_ASSIGNMENT_TARGET.BOTH, mode: BULK_ASSIGNMENT_MODE.OVERWRITE },
      requiresConfirmation: true,
    },
  ];
}

export function formatProfileVersionPreviewLines(version: ProfileVersion): string[] {
  const primaryLines = Object.entries(version.preview.models || {}).map(([name, model]) => `Primario: ${name} -> ${model}`);
  const fallbackLines = Object.entries(version.preview.fallback || {}).map(([name, model]) => `fallback: ${name} -> ${model}`);
  return [
    `Perfil: ${version.profileFile}`,
    `Creado: ${formatMemoryDate(version.createdAt)}`,
    `Origen: ${formatProfileVersionSource(version.source)}`,
    `Operación: ${version.operationSummary}`,
    ...(primaryLines.length > 0 ? primaryLines : ["Primario: ninguno"]),
    ...(fallbackLines.length > 0 ? fallbackLines : ["fallback: ninguno"]),
    `Contenido: ${truncateText(version.beforeRaw.replace(/\s+/g, " "), 80)}`,
  ];
}

function formatProfileVersionSource(source: string | undefined): string {
  return source === PROFILE_VERSION_SOURCE.PHASE ? "Fase" : "Masivo";
}

export function buildProfileVersionListOption(version: ProfileVersionMetadata): { title: string; value: string; description: string } {
  return {
    title: `${formatMemoryDate(version.createdAt)} · ${formatProfileVersionSource(version.source)}`,
    value: version.id,
    description: version.operationSummary,
  };
}

/**
 * Registers callback functions for cross-dialog navigation
 * 
 * @param callbacks - Collection of dialog functions
 */
export function registerDialogCallbacks(callbacks: {
  showProfilesMenu: (api: any) => void | Promise<void>;
  showProfileList: (api: any) => void | Promise<void>;
  showProfileDetail: (api: any, profileOpt: any) => void | Promise<void>;
  showProjectMemoriesMenu: (api: any) => void | Promise<void>;
}) {
  showProfilesMenuFn = callbacks.showProfilesMenu;
  showProfileListFn = callbacks.showProfileList;
  showProfileDetailFn = callbacks.showProfileDetail;
  showProjectMemoriesMenuFn = callbacks.showProjectMemoriesMenu;
}

/**
 * Displays the main SDD Profiles management menu
 * 
 * @param api - The TUI API instance
 */
export function showProfilesMenu(api: any) {
  safeSetDialogSize(api, "medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title={NAV_TEXT.profileManagement}
      options={[
        {
          title: NAV_TEXT.createProfile,
          value: "create",
          description: "Crea un perfil SDD vacío para configurarlo manualmente.",
        },
        {
          title: NAV_TEXT.manageProfiles,
          value: "list",
          description: "Lista y activa tus perfiles SDD guardados.",
        },
        {
          title: NAV_TEXT.viewMemories,
          value: "view_memories",
          description: "Muestra las observaciones recientes de Engram para este proyecto.",
        },
        {
          title: `Insignia: ${showModelBadge() ? "Activada" : "Desactivada"}`,
          value: "toggle_badge_visible",
          description: "Muestra u oculta la insignia.",
        },
        {
          title: `Modo de insignia: ${badgeDisplayMode() === "profile" ? "Perfil" : "Modelo"}`,
          value: "toggle_badge_mode",
          description: "Muestra información del modelo o el nombre del perfil activo.",
        },
        {
          title: NAV_TEXT.close,
          value: "__close__",
          category: NAV_CATEGORY,
        },
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "create") showCreateProfile(api);
        else if (opt.value === "list") showProfileListFn(api);
        else if (opt.value === "view_memories") showProjectMemoriesMenuFn(api);
        else if (opt.value === "toggle_badge_visible") {
          const next = !showModelBadge();
          setShowModelBadge(next);
          Promise.resolve().then(() => api.kv.set(BADGE_VISIBLE_KV_KEY, next)).catch((e) => {
            log.warn(`toggle_badge_visible: failed to persist '${BADGE_VISIBLE_KV_KEY}'`, e);
          });
          showProfilesMenu(api);
        } else if (opt.value === "toggle_badge_mode") {
          const next: BadgeDisplayMode = badgeDisplayMode() === "model" ? "profile" : "model";
          setBadgeDisplayMode(next);
          Promise.resolve().then(() => api.kv.set(BADGE_DISPLAY_MODE_KV_KEY, next)).catch((e) => {
            log.warn(`toggle_badge_mode: failed to persist '${BADGE_DISPLAY_MODE_KV_KEY}'`, e);
          });
          showProfilesMenu(api);
        } else api.ui.dialog.clear();
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ));
}

/**
 * Displays a prompt to create a new profile from the current configuration
 * 
 * @param api - The TUI API instance
 */
export function showCreateProfile(api: any) {
  safeSetDialogSize(api, "medium");
  const { configPath, profilesDir } = resolvePaths();
  ensureProfilesDir();

  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title="Nombre del nuevo perfil SDD"
      placeholder="Escribe el nombre del perfil"
      onConfirm={(name: string) => {
        const trimmed = name?.trim();
        if (!trimmed) {
          showProfilesMenuFn(api);
          return;
        }

        try {
          const finalName = sanitizeProfileName(trimmed);
          const fileName = `${finalName}.json`;
          const profilePath = path.join(profilesDir, fileName);

          if (fs.existsSync(profilePath)) {
            api.ui.toast({
              title: UI_TEXT.error,
              message: `El perfil '${finalName}' ya existe`,
              variant: "error",
            });
            showProfilesMenuFn(api);
            return;
          }

          writeProfileModels(profilePath, {});
          
          // Defer both navigation and toast to next tick to ensure the current 
          // DialogPrompt has fully finished its state cycle, avoiding races 
          // that could prevent the new detail view from appearing reliably.
          setTimeout(() => {
            showProfileDetailFn(api, { title: finalName, value: fileName });
            api.ui.toast({
              title: "Éxito",
              message: `Perfil '${finalName}' creado correctamente`,
              variant: "success",
            });
          }, 0);
        } catch (e: any) {
          log.error(`showCreateProfile: failed to create profile '${trimmed}'`, e);
          api.ui.toast({
            title: UI_TEXT.error,
            message: `No se pudo crear el perfil: ${e.message}`,
            variant: "error",
          });
          showProfilesMenuFn(api);
        }
      }}
      onCancel={() => showProfilesMenuFn(api)}
    />
  ));
}

/**
 * Displays a list of all saved SDD profiles for selection
 * 
 * @param api - The TUI API instance
 */
export function showProfileList(api: any) {
  safeSetDialogSize(api, "xlarge");
  ensureProfilesDir();

  const files = listProfileFiles();

  if (files.length === 0) {
    api.ui.toast({
      title: NAV_TEXT.noProfiles,
      message: "No hay perfiles guardados. ¡Crea uno primero!",
      variant: "warning",
    });
    showProfilesMenuFn(api);
    return;
  }

  const activeFile = resolvePersistedActiveProfileFile(files, activeProfile()?.profileName)
    || detectActiveProfileFile(files, api);

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect {...createProfileListDialogProps(
      files,
      activeFile,
      () => showProfilesMenuFn(api),
      (file) => showProfileDetailFn(api, { title: file.replace(".json", ""), value: file }),
    )} />
  ));
}

/**
 * Displays detailed information and management options for a specific profile
 * 
 * @param api - The TUI API instance
 * @param profileOpt - Selected profile option containing title and value (filename)
 */
export function showProfileDetail(api: any, profileOpt: any) {
  safeSetDialogSize(api, "xlarge");
  const { profilesDir } = resolvePaths();
  try {
    const profilePath = path.join(profilesDir, profileOpt.value);
    const profileData = readProfileData(profilePath);
    const sections = buildProfileDetailAgentSections(api.state.config, profileData);
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        {...createProfileDetailDialogProps(api, profileOpt, profilePath, profileData, sections)}
      />
    ));
  } catch (e) {
    log.error(`showProfileDetail: failed to read profile '${profileOpt?.value}'`, e);
    api.ui.toast({ title: UI_TEXT.error, message: "No se pudieron leer los detalles del perfil", variant: "error" });
  }
}

export function createProfileDetailDialogProps(
  api: any,
  profileOpt: any,
  profilePath: string,
  profileData: any,
  sections: any,
  deps?: any,
) {
  const showProfileList = deps?.showProfileList || showProfileListFn;
  const activateProfile = deps?.handleActivateProfile || handleActivateProfile;
  const showDelete = deps?.showDeleteProfile || showDeleteProfile;
  const showRename = deps?.showRenameProfile || showRenameProfile;
  const showBulk = deps?.showBulkProfileActions || showBulkProfileActions;
  const showVersions = deps?.showProfileVersions || showProfileVersions;
  const showPrimarySubmenu = deps?.showProfileDetailSubmenuPrimary || showProfileDetailSubmenuPrimary;
  const showReasoningSubmenu = deps?.showProfileDetailSubmenuReasoning || showProfileDetailSubmenuReasoning;
  const showFallbackSubmenu = deps?.showProfileDetailSubmenuFallback || showProfileDetailSubmenuFallback;
  const showProvider = deps?.showProviderPickerForAgent || showProviderPickerForAgent;
  const showReasoning = deps?.showReasoningEffortPicker || showReasoningEffortPicker;

  return {
    title: `Perfil: ${profileOpt.title}`,
    options: buildProfileDetailHubOptions(api, profileOpt, profileData),
    onSelect: (opt: any) => {
      if (opt.value === "__back__") showProfileList(api);
      else if (opt.value === "__assign__") activateProfile(api, profilePath, profileOpt.title);
      else if (opt.value === "__delete__") showDelete(api, profileOpt);
      else if (opt.value === "__rename__") showRename(api, profileOpt);
      else if (opt.value === "__bulk_actions__") showBulk(api, profileOpt);
      else if (opt.value === "__profile_versions__") showVersions(api, profileOpt);
      else {
        const navAction = resolveProfileDetailNavigationAction(opt.value);
        if (navAction.action === "submenu-primary") {
          showPrimarySubmenu(api, profileOpt, profileData, sections);
          return;
        }
        if (navAction.action === "submenu-reasoning") {
          showReasoningSubmenu(api, profileOpt, profileData, sections);
          return;
        }
        if (navAction.action === "submenu-fallback") {
          showFallbackSubmenu(api, profileOpt, profileData, sections);
          return;
        }

        const selectionAction = resolveProfileDetailSelectionAction(opt.value);
        if (selectionAction.action === "model") {
          showProvider(api, profileOpt, selectionAction.agentName, "model", "hub");
        } else if (selectionAction.action === "reasoning") {
          showReasoning(api, profileOpt, selectionAction.agentName, "hub");
        } else if (selectionAction.action === "fallback") {
          showProvider(api, profileOpt, selectionAction.agentName, "fallback", "hub");
        }
      }
    },
    onCancel: () => showProfileList(api),
  };
}

export function showProfileDetailSubmenuPrimary(api: any, profileOpt: any, profileData: any, sections?: any) {
  safeSetDialogSize(api, "xlarge");
  const resolvedSections = sections || buildProfileDetailAgentSections(api.state.config, profileData);
  api.ui.dialog.replace(() => (<api.ui.DialogSelect {...createPrimarySubmenuDialogProps(api, profileOpt, profileData, resolvedSections)} />));
}

export function showProfileDetailSubmenuReasoning(api: any, profileOpt: any, profileData: any, sections?: any) {
  safeSetDialogSize(api, "xlarge");
  const resolvedSections = sections || buildProfileDetailAgentSections(api.state.config, profileData);
  api.ui.dialog.replace(() => (<api.ui.DialogSelect {...createReasoningSubmenuDialogProps(api, profileOpt, profileData, resolvedSections)} />));
}

export function showProfileDetailSubmenuFallback(api: any, profileOpt: any, profileData: any, sections?: any) {
  safeSetDialogSize(api, "xlarge");
  const resolvedSections = sections || buildProfileDetailAgentSections(api.state.config, profileData);
  api.ui.dialog.replace(() => (<api.ui.DialogSelect {...createFallbackSubmenuDialogProps(api, profileOpt, profileData, resolvedSections)} />));
}

export function createPrimarySubmenuDialogProps(api: any, profileOpt: any, profileData: any, sections: any, deps?: any) {
  const showHub = deps?.showProfileDetail || showProfileDetailFn;
  const showProvider = deps?.showProviderPickerForAgent || showProviderPickerForAgent;
  return {
    title: `${UI_TEXT.primaryModels} › ${profileOpt.title}`,
    options: buildPrimaryModelSubmenuOptions(profileData, sections, api),
    onSelect: (opt: any) => {
        if (opt.value === "__back__") showHub(api, profileOpt);
        else {
          const nextAction = resolveProfileDetailSelectionAction(opt.value);
        if (nextAction.action === "model") showProvider(api, profileOpt, nextAction.agentName, "model", "primary");
      }
    },
    onCancel: () => showHub(api, profileOpt),
  };
}

export function createReasoningSubmenuDialogProps(api: any, profileOpt: any, profileData: any, sections: any, deps?: any) {
  const showHub = deps?.showProfileDetail || showProfileDetailFn;
  const showReasoning = deps?.showReasoningEffortPicker || showReasoningEffortPicker;
  return {
    title: `${UI_TEXT.reasoningEffort} › ${profileOpt.title}`,
    options: buildReasoningSubmenuOptions(profileData, sections),
    onSelect: (opt: any) => {
        if (opt.value === "__back__") showHub(api, profileOpt);
        else {
          const nextAction = resolveProfileDetailSelectionAction(opt.value);
        if (nextAction.action === "reasoning") showReasoning(api, profileOpt, nextAction.agentName, "reasoning");
      }
    },
    onCancel: () => showHub(api, profileOpt),
  };
}

export function createFallbackSubmenuDialogProps(api: any, profileOpt: any, profileData: any, sections: any, deps?: any) {
  const showHub = deps?.showProfileDetail || showProfileDetailFn;
  const showProvider = deps?.showProviderPickerForAgent || showProviderPickerForAgent;
  return {
    title: `${UI_TEXT.fallbackModels} › ${profileOpt.title}`,
    options: buildFallbackSubmenuOptions(profileData, sections, api),
    onSelect: (opt: any) => {
        if (opt.value === "__back__") showHub(api, profileOpt);
        else {
          const nextAction = resolveProfileDetailSelectionAction(opt.value);
        if (nextAction.action === "fallback") showProvider(api, profileOpt, nextAction.agentName, "fallback", "fallback");
      }
    },
    onCancel: () => showHub(api, profileOpt),
  };
}

export function showReasoningEffortPicker(
  api: any,
  profileOpt: any,
  agentName: string,
  returnTarget: ProfileDetailReturnTarget = "hub",
  flow?: ReasoningFlow,
) {
  safeSetDialogSize(api, "medium");
  const { profilesDir } = resolvePaths();
  const profilePath = path.join(profilesDir, profileOpt.value);

  try {
      const profile = readProfileData(profilePath);
    const modelId = flow?.pending?.modelId || profile?.models?.[agentName];
    const current = profile?.configs?.[agentName]?.reasoningEffort;
    const state = buildReasoningEditState(api?.state?.provider || [], agentName, modelId, current);

    if (state.kind === "ineligible" || state.kind === "missing-model") {
      api.ui.toast({ title: "Razonamiento no disponible", message: buildReasoningBlockedMessage(state), variant: "warning" });
      returnToProfileDetailTarget(api, profileOpt, returnTarget);
      return;
    }

    const pickerProps = createReasoningEffortPickerDialogProps(
      api,
      profileOpt,
      agentName,
      profilePath,
      profile,
      state,
      returnTarget,
      flow,
      flow?.sequential
        ? { updateProfileReasoningWithoutVersion: undefined }
        : {
            updateProfileReasoningWithoutVersion: (targetPath, targetAgent, value, policy) => {
              const nextProfile = updateProfileReasoningEffort(profile, targetAgent, value);
              writeProfileData(targetPath, nextProfile, policy);
              return nextProfile;
            },
          },
    );
    api.ui.dialog.replace(() => <api.ui.DialogSelect {...pickerProps} />);
  } catch (e: any) {
    log.error(`showReasoningEffortEditor: failed to update ${agentName}`, e);
      api.ui.toast({ title: UI_TEXT.error, message: `No se pudo actualizar el esfuerzo de razonamiento: ${e.message}`, variant: "error" });
    returnToProfileDetailTarget(api, profileOpt, returnTarget);
  }
}

export function resolvePersistedActiveProfileFile(files: readonly string[], profileName?: string): string | undefined {
  if (typeof profileName !== "string" || !profileName.trim()) return undefined;
  const rawName = profileName.trim();
  if (rawName.includes("/") || rawName.includes("\\") || rawName.includes("..")) return undefined;
  const normalized = rawName.endsWith(".json") ? rawName : `${rawName}.json`;
  return files.includes(normalized) ? normalized : undefined;
}

export function buildProfileListOptions(files: readonly string[], activeFile?: string) {
  return files.map((file) => ({
    title: `${file === activeFile ? "✓ " : ""}${file.replace(/\.json$/, "")}`,
    value: file,
    description: file === activeFile ? "✓ Activo" : "Perfil SDD",
  }));
}

export function createProfileListDialogProps(
  files: readonly string[],
  activeFile: string | undefined,
  showProfilesMenu: () => void,
  showProfileDetail: (file: string) => void,
) {
  return {
    title: "Seleccionar perfil SDD",
    current: activeFile,
    options: [...buildProfileListOptions(files, activeFile), buildBackOption()],
    onSelect: (opt: any) => {
      if (opt.value === "__back__") showProfilesMenu();
      else showProfileDetail(String(opt.value));
    },
    onCancel: showProfilesMenu,
  };
}

type ModelSelectionMode = "primary" | "fallback";
type ModelPickerMode = "model" | "primary" | "fallback";

type ReasoningFlow = {
  sequential?: boolean;
  pending?: any;
  commitPendingModelSelection?: typeof commitPendingModelSelection;
  modelMutationContext?: ModelMutationContext;
};

type DialogFlowDependencies = {
  updateProfilePhaseModel?: typeof updateProfilePhaseModel;
  readProfileData?: typeof readProfileData;
  stageProfileModelSelection?: typeof stageProfileModelSelection;
  commitPendingModelSelection?: typeof commitPendingModelSelection;
  updateProfileReasoningWithoutVersion?: typeof updateProfileReasoningWithoutVersion;
  updateProfileWithBulkPhaseAssignment?: typeof updateProfileWithBulkPhaseAssignment;
  showReasoningEffortPicker?: (
    api: any,
    profileOpt: any,
    agentName: string,
    returnTarget: ProfileDetailReturnTarget,
    flow?: ReasoningFlow,
  ) => void;
  showProviderPickerForAgent?: typeof showProviderPickerForAgent;
  returnToProfileDetailTarget?: typeof returnToProfileDetailTarget;
  showProfileDetail?: typeof showProfileDetailFn;
  onModelSelected?: (modelId: string) => void;
};

export function buildModelMutationContext(api: any, mode: ModelSelectionMode): ModelMutationContext {
  return {
    providers: api?.state?.provider || [],
    runtimePrimaryNames: mode === "primary" ? Object.keys(api?.state?.config?.agent || {}).filter(isEditablePrimaryAgent) : undefined,
    effortPolicy: mode === "primary" ? "interactive-clear" : "none",
  };
}

export function buildBulkModelMutationContext(api: any, runtimePrimaryNames: string[]): ModelMutationContext {
  return {
    providers: api?.state?.provider || [],
    runtimePrimaryNames,
    effortPolicy: "bulk-compatible-prune",
  };
}

function buildModelSelectionToast(agentName: string, fullModelId: string, mode: ModelSelectionMode, changed: boolean) {
  const target = mode === "fallback" ? " fallback" : "";
  return {
      title: changed ? "Actualizado" : "Sin cambios",
    message: changed
      ? `${agentName}${target} usa ${fullModelId}. Versión guardada.`
      : `${agentName}${target} ya usa ${fullModelId}`,
    variant: changed ? "success" : "warning",
  };
}

export function createModelSelectionHandler(
  api: any,
  profileOpt: any,
  agentName: string,
  mode: ModelSelectionMode,
  returnTarget: ProfileDetailReturnTarget,
  deps: DialogFlowDependencies = {},
) {
  const stageModel = deps.stageProfileModelSelection || stageProfileModelSelection;
  const commitModel = deps.commitPendingModelSelection || commitPendingModelSelection;
  const legacyUpdateModel = deps.updateProfilePhaseModel;
  const readProfile = deps.readProfileData || readProfileData;
  const showReasoning = deps.showReasoningEffortPicker || showReasoningEffortPicker;
  const returnToTarget = deps.returnToProfileDetailTarget || returnToProfileDetailTarget;
  const { profilesDir } = resolvePaths();
  const profilePath = path.join(profilesDir, profileOpt.value);

  return (fullModelId: string) => {
    try {
      if (legacyUpdateModel) {
        const result = legacyUpdateModel(
          profilePath,
          agentName,
          mode,
          fullModelId,
          resolveRuntimeOrchestratorPolicy(api.state.config),
          buildModelMutationContext(api, mode),
        );
        if (mode === "primary") {
          showReasoning(api, profileOpt, agentName, returnTarget, { sequential: true });
          return;
        }
        api.ui.toast(buildModelSelectionToast(agentName, fullModelId, mode, result.changed));
        returnToTarget(api, profileOpt, returnTarget);
        return;
      }
      const profile = readProfileData(profilePath);
      const staged = stageModel(profile, agentName, mode, fullModelId);

      if (mode === "primary") {
        showReasoning(api, profileOpt, agentName, returnTarget, {
          sequential: true,
          pending: staged.pending,
          commitPendingModelSelection: commitModel,
          modelMutationContext: buildModelMutationContext(api, mode),
        });
        return;
      }

      const result = commitModel(
        profilePath,
        staged.pending,
        undefined,
        resolveRuntimeOrchestratorPolicy(api.state.config),
        buildModelMutationContext(api, mode),
      );
      api.ui.toast(buildModelSelectionToast(agentName, fullModelId, mode, result.changed));
      returnToTarget(api, profileOpt, returnTarget);
    } catch (error: any) {
      log.error(`handleModelSelection: failed to update ${agentName}`, error);
      api.ui.toast({ title: UI_TEXT.error, message: `No se pudo actualizar el agente: ${error.message}`, variant: "error" });
      returnToTarget(api, profileOpt, returnTarget);
    }
  };
}

export function createModelPickerDialogProps(
  api: any,
  profileOpt: any,
  agentName: string,
  provider: any,
  mode: ModelPickerMode,
  returnTarget: ProfileDetailReturnTarget,
  deps: DialogFlowDependencies = {},
) {
  const showProvider = deps.showProviderPickerForAgent || showProviderPickerForAgent;
  const selectionMode: ModelSelectionMode = mode === "fallback" ? "fallback" : "primary";
  const providerMode = mode === "primary" ? "model" : mode;
  const onModelSelected = (deps as any).onModelSelected || createModelSelectionHandler(api, profileOpt, agentName, selectionMode, returnTarget, deps);
  const models = provider?.models || {};
  return {
      title: `${provider?.name || provider?.id} › ${agentName}${mode === "fallback" ? " (fallback)" : ""}`,
    options: [
      ...Object.keys(models).map((key) => ({
        title: models[key].name || key,
        value: `${provider.id}/${key}`,
        description: models[key].limit?.context ? formatContext(models[key].limit.context) : "contexto: N/D",
      })),
      buildBackOption(),
    ],
    onSelect: (opt: any) => {
      if (opt.value === "__back__") showProvider(api, profileOpt, agentName, providerMode, returnTarget);
      else onModelSelected(opt.value);
    },
    onCancel: () => showProvider(api, profileOpt, agentName, providerMode, returnTarget),
  };
}

function showReasoningEffortError(api: any, agentName: string, error: any) {
  log.error(`showReasoningEffortEditor: failed to update ${agentName}`, error);
  api.ui.toast({ title: UI_TEXT.error, message: `No se pudo actualizar el esfuerzo de razonamiento: ${error.message}`, variant: "error" });
}

export function createReasoningEffortPickerDialogProps(
  api: any,
  profileOpt: any,
  agentName: string,
  profilePath: string,
  profile: any,
  state: any,
  returnTarget: ProfileDetailReturnTarget,
  flow?: ReasoningFlow,
  deps: DialogFlowDependencies = {},
) {
  const updateEffort = deps.updateProfileReasoningWithoutVersion || updateProfileReasoningWithoutVersion;
  const commitModel = flow?.commitPendingModelSelection || deps.commitPendingModelSelection || commitPendingModelSelection;
  const returnToTarget = deps.returnToProfileDetailTarget || returnToProfileDetailTarget;
  const clearAndReturn = () => {
    returnToTarget(api, profileOpt, returnTarget);
  };

  return {
    title: `${UI_TEXT.reasoningEffort} › ${agentName}`,
    options: [
      ...(state?.options || []).map((value: string) => ({
        title: localizedEffortLabel(value),
        value,
      })),
      ...(!flow?.sequential ? [{ title: "Borrar valor guardado", value: "__clear__", category: NAV_CATEGORY }] : []),
      buildBackOption(),
    ],
    onSelect: (opt: any) => {
      if (opt.value === "__back__") {
        clearAndReturn();
        return;
      }
      try {
        const effort = opt.value === "__clear__" ? "" : opt.value;
        if (flow?.sequential && flow.pending) {
          commitModel(
            profilePath,
            flow.pending,
            effort,
            resolveRuntimeOrchestratorPolicy(api.state.config),
            flow.modelMutationContext || buildModelMutationContext(api, "primary"),
          );
        } else {
          updateEffort(profilePath, agentName, effort, resolveRuntimeOrchestratorPolicy(api.state.config));
        }
        api.ui.toast({ title: "Actualizado", message: `${agentName}: esfuerzo de razonamiento actualizado`, variant: "success" });
        returnToTarget(api, profileOpt, returnTarget);
      } catch (error: any) {
        showReasoningEffortError(api, agentName, error);
        returnToTarget(api, profileOpt, returnTarget);
      }
    },
    onCancel: clearAndReturn,
  };
}

export function createBulkModelSelectionHandler(
  api: any,
  profileOpt: any,
  fullModelId: string,
  action: BulkProfileActionOption,
  deps: DialogFlowDependencies = {},
) {
  const updateBulk = deps.updateProfileWithBulkPhaseAssignment || updateProfileWithBulkPhaseAssignment;
  const showDetail = deps.showProfileDetail || showProfileDetailFn;
  const runtimePrimaryNames = Object.keys(api?.state?.config?.agent || {}).filter(isPrimarySddAgent);
  const { profilesDir } = resolvePaths();
  const profilePath = path.join(profilesDir, profileOpt.value);

  return () => {
    try {
      const result = updateBulk(
        profilePath,
        runtimePrimaryNames,
        fullModelId,
        action.operation,
        resolveRuntimeOrchestratorPolicy(api.state.config),
        buildBulkModelMutationContext(api, runtimePrimaryNames),
      );
      const totalAssigned = (result.assignment?.modelsAssigned || 0) + (result.assignment?.fallbackAssigned || 0);
      api.ui.toast({
        title: totalAssigned > 0 ? UI_TEXT.updated : UI_TEXT.noChanges,
        message: totalAssigned > 0 ? `${action.title}: ${totalAssigned} asignaciones establecidas en ${fullModelId}. Versión guardada.` : "No hay fases SDD primarias o fallback objetivo que actualizar",
        variant: totalAssigned > 0 ? "success" : "warning",
      });
      showDetail(api, profileOpt);
    } catch (error: any) {
      log.error(`handleBulkModelSelection: failed for profile '${profileOpt?.value}'`, error);
      api.ui.toast({ title: UI_TEXT.error, message: `No se pudieron actualizar las fases: ${error.message}`, variant: "error" });
      showDetail(api, profileOpt);
    }
  };
}

/**
 * Handles the activation of a profile and updates global state
 */
export async function handleActivateProfile(api: any, profilePath: string, profileName: string) {
  const updatedConfig = await activateProfileFile(api, profilePath, profileName);
  if (!updatedConfig) return;

  try {
    await api.kv.set(ACTIVE_PROFILE_NAME_KV_KEY, profileName);
  } catch (e) {
    log.warn(`handleActivateProfile: failed to persist active profile name`, e);
  }

  // Sync global state after activation; attach profileName so the badge can render it.
  const next = parseActiveProfileFromRaw(JSON.stringify(updatedConfig), api);
  setActiveProfile(next ? { ...next, profileName } : next);

  safeSetDialogSize(api, "medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title="Perfil activado"
      message={`El perfil '${profileName}' se aplicó correctamente a la configuración global.`}
      onConfirm={() => api.ui.dialog.clear()}
      onCancel={() => api.ui.dialog.clear()}
    />
  ));
}

/**
 * Displays a confirmation dialog before deleting a profile
 */
export function showDeleteProfile(api: any, profileOpt: any) {
  safeSetDialogSize(api, "medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title="Eliminar perfil"
      message={`¿Eliminar permanentemente '${profileOpt.title}'?`}
      onConfirm={() => {
        try {
          deleteProfileFile(profileOpt.value);
          api.ui.toast({ title: UI_TEXT.deleted, message: `Perfil '${profileOpt.title}' eliminado` });
          showProfileListFn(api);
        } catch (e: any) {
          log.error(`showDeleteProfile: failed to delete profile '${profileOpt?.value}'`, e);
          api.ui.toast({ title: UI_TEXT.error, message: `No se pudo eliminar: ${e.message}`, variant: "error" });
          showProfileDetailFn(api, profileOpt);
        }
      }}
      onCancel={() => showProfileDetailFn(api, profileOpt)}
    />
  ));
}

/**
 * Displays a prompt to rename an existing profile
 */
export function showRenameProfile(api: any, profileOpt: any) {
  safeSetDialogSize(api, "medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title="Renombrar perfil"
      value={profileOpt.title}
      onConfirm={(newName: string) => {
        const trimmed = newName?.trim();
        if (!trimmed || trimmed === profileOpt.title) {
          showProfileDetailFn(api, profileOpt);
          return;
        }

        try {
          const finalName = sanitizeProfileName(trimmed);
          const newFileName = `${finalName}.json`;

          const { profilesDir } = resolvePaths();
          const newPath = path.join(profilesDir, newFileName);

          if (fs.existsSync(newPath)) {
            api.ui.toast({ title: UI_TEXT.error, message: "Ya existe un perfil con este nombre", variant: "error" });
            showProfileDetailFn(api, profileOpt);
            return;
          }

          renameProfileFile(profileOpt.value, newFileName);
          api.ui.toast({ title: UI_TEXT.renamed, message: `Perfil renombrado a '${finalName}'` });
          showProfileListFn(api);
        } catch (e: any) {
          log.error(`showRenameProfile: failed to rename profile '${profileOpt?.value}' to '${newName}'`, e);
          api.ui.toast({ title: UI_TEXT.error, message: `No se pudo renombrar: ${e.message}`, variant: "error" });
          showProfileDetailFn(api, profileOpt);
        }
      }}
      onCancel={() => showProfileDetailFn(api, profileOpt)}
    />
  ));
}

/**
 * Displays bulk assignment actions for the selected profile.
 */
export function showBulkProfileActions(api: any, profileOpt: any) {
  safeSetDialogSize(api, "xlarge");
  const options = buildBulkProfileActionOptions();

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="Acciones masivas del perfil"
      options={[
        ...options.map((option) => ({
          title: option.title,
          value: option.value,
          description: option.requiresConfirmation ? "Requiere confirmación antes de sobrescribir" : "Completa solo entradas vacías o sin asignar",
        })),
        buildBackOption(),
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "__back__") showProfileDetailFn(api, profileOpt);
        else {
          const selected = options.find((option) => option.value === opt.value);
          if (!selected) return;
          if (selected.requiresConfirmation) showConfirmBulkProfileOverride(api, profileOpt, selected);
          else showProviderPickerForBulkProfilePhases(api, profileOpt, selected);
        }
      }}
      onCancel={() => showProfileDetailFn(api, profileOpt)}
    />
  ));
}

export function showConfirmBulkProfileOverride(api: any, profileOpt: any, action: BulkProfileActionOption) {
  safeSetDialogSize(api, "medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title="Confirmar sobrescritura masiva"
      message={`${action.title} reemplazará las asignaciones existentes de '${profileOpt.title}'. Primero se guardará una versión fechada.`}
      onConfirm={() => showProviderPickerForBulkProfilePhases(api, profileOpt, action)}
      onCancel={() => showBulkProfileActions(api, profileOpt)}
    />
  ));
}

/**
 * Displays a menu to select a provider for bulk phase assignment.
 */
export function showProviderPickerForBulkProfilePhases(api: any, profileOpt: any, action: BulkProfileActionOption) {
  safeSetDialogSize(api, "xlarge");
  const providers = (api.state.provider || []).filter((p: any) => Object.keys(p.models || {}).length > 0);

  if (providers.length === 0) {
    api.ui.toast({ title: NAV_TEXT.noProviders, message: "No se encontraron proveedores autenticados.", variant: "warning" });
    showBulkProfileActions(api, profileOpt);
    return;
  }

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title={`Proveedor › ${action.title}`}
      options={[
        ...providers.map((p: any) => ({
          title: p.name || p.id,
          value: p.id,
          description: `${Object.keys(p.models || {}).length} modelos disponibles`,
        })),
        buildBackOption(),
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "__back__") showBulkProfileActions(api, profileOpt);
        else {
          const selected = providers.find((p: any) => p.id === opt.value);
          showModelPickerForBulkProfilePhases(api, profileOpt, selected, action);
        }
      }}
      onCancel={() => showBulkProfileActions(api, profileOpt)}
    />
  ));
}

/**
 * Displays a model picker for bulk phase assignment.
 */
export function showModelPickerForBulkProfilePhases(api: any, profileOpt: any, provider: any, action: BulkProfileActionOption) {
  safeSetDialogSize(api, "xlarge");
  const models = provider.models || {};
  const modelKeys = Object.keys(models);

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title={`${provider.name || provider.id} › ${action.title}`}
      options={[
        ...modelKeys.map((key) => {
          const model = models[key];
          const ctxText = model.limit?.context ? formatContext(model.limit.context) : "contexto: N/D";
          return {
            title: model.name || key,
            value: `${provider.id}/${key}`,
            description: ctxText,
          };
        }),
        buildBackOption(),
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "__back__") showProviderPickerForBulkProfilePhases(api, profileOpt, action);
        else createBulkModelSelectionHandler(api, profileOpt, opt.value, action)();
      }}
      onCancel={() => showProviderPickerForBulkProfilePhases(api, profileOpt, action)}
    />
  ));
}

/**
 * Assigns the selected model to targeted SDD profile phases and versions before mutation.
 */
export function showProfileVersions(api: any, profileOpt: any) {
  safeSetDialogSize(api, "xlarge");
  try {
    const versions = listProfileVersions(profileOpt.value);

    if (versions.length === 0) {
    api.ui.toast({ title: NAV_TEXT.noVersions, message: `No hay versiones guardadas para '${profileOpt.title}'`, variant: "warning" });
      showProfileDetailFn(api, profileOpt);
      return;
    }

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`Versiones: ${profileOpt.title}`}
        options={[
          ...versions.map(buildProfileVersionListOption),
          buildBackOption(),
        ]}
        onSelect={(opt: any) => {
          if (opt.value === "__back__") showProfileDetailFn(api, profileOpt);
          else showProfileVersionPreview(api, profileOpt, opt.value);
        }}
        onCancel={() => showProfileDetailFn(api, profileOpt)}
      />
    ));
  } catch (e: any) {
    log.error(`showProfileVersions: failed to list versions for '${profileOpt?.value}'`, e);
    api.ui.toast({ title: "Error de versiones", message: e.message || "No se pudieron listar las versiones del perfil", variant: "error" });
    showProfileDetailFn(api, profileOpt);
  }
}

export function showProfileVersionPreview(api: any, profileOpt: any, versionId: string) {
  safeSetDialogSize(api, "xlarge");
  try {
    const version = readProfileVersion(versionId);
    const lines = formatProfileVersionPreviewLines(version);

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`Previsualización: ${profileOpt.title}`}
        options={[
          ...lines.map((line, index) => ({ title: line, value: `__line__${index}` })),
          { title: "↩ Restaurar esta versión", value: "__restore__", category: NAV_CATEGORY },
          buildBackOption(),
        ]}
        onSelect={(opt: any) => {
          if (opt.value === "__restore__") showConfirmRestoreProfileVersion(api, profileOpt, version.id);
          else if (opt.value === "__back__") showProfileVersions(api, profileOpt);
          else showProfileVersionPreview(api, profileOpt, versionId);
        }}
        onCancel={() => showProfileVersions(api, profileOpt)}
      />
    ));
  } catch (e: any) {
    log.error(`showProfileVersionPreview: failed to read version '${versionId}'`, e);
    api.ui.toast({ title: "Error de versiones", message: e.message || "No se pudo leer la versión del perfil", variant: "error" });
    showProfileVersions(api, profileOpt);
  }
}

export function showConfirmRestoreProfileVersion(api: any, profileOpt: any, versionId: string) {
  safeSetDialogSize(api, "medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title="Restaurar versión del perfil"
      message={`¿Restaurar '${profileOpt.title}' desde esta versión? Se sobrescribirá el contenido actual.`}
      onConfirm={() => {
        try {
          restoreProfileVersion(profileOpt.value, versionId);
          api.ui.toast({ title: UI_TEXT.restored, message: `Perfil '${profileOpt.title}' restaurado`, variant: "success" });
          showProfileDetailFn(api, profileOpt);
        } catch (e: any) {
          log.error(`showConfirmRestoreProfileVersion: failed to restore '${versionId}'`, e);
          api.ui.toast({ title: "Error al restaurar", message: e.message || "No se pudo restaurar la versión", variant: "error" });
          showProfileVersionPreview(api, profileOpt, versionId);
        }
      }}
      onCancel={() => showProfileVersionPreview(api, profileOpt, versionId)}
    />
  ));
}

/**
 * Displays a menu to select a provider for a specific agent in the profile
 */
export function showProviderPickerForAgent(
  api: any,
  profileOpt: any,
  agentName: string,
  mode: "model" | "fallback",
  returnTarget: ProfileDetailReturnTarget = "hub"
) {
  safeSetDialogSize(api, "xlarge");
  const providers = (api.state.provider || []).filter((p: any) => Object.keys(p.models || {}).length > 0);

  if (providers.length === 0) {
    api.ui.toast({ title: NAV_TEXT.noProviders, message: "No se encontraron proveedores autenticados.", variant: "warning" });
    returnToProfileDetailTarget(api, profileOpt, returnTarget);
    return;
  }

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title={`Proveedor para ${agentName}${mode === "fallback" ? " (fallback)" : ""}`}
      options={[
        ...providers.map((p: any) => ({
          title: p.name || p.id,
          value: p.id,
          description: `${Object.keys(p.models || {}).length} modelos disponibles`,
        })),
        buildBackOption(),
      ]}
      onSelect={(opt: any) => {
        if (opt.value === "__back__") returnToProfileDetailTarget(api, profileOpt, returnTarget);
        else {
          const selected = providers.find((p: any) => p.id === opt.value);
          showModelPickerForAgent(api, profileOpt, agentName, selected, mode, returnTarget);
        }
      }}
      onCancel={() => returnToProfileDetailTarget(api, profileOpt, returnTarget)}
    />
  ));
}

/**
 * Displays a menu to select a model from a provider for a specific agent
 */
export function showModelPickerForAgent(
  api: any,
  profileOpt: any,
  agentName: string,
  provider: any,
  mode: "model" | "fallback",
  returnTarget: ProfileDetailReturnTarget = "hub"
) {
  safeSetDialogSize(api, "xlarge");
  const pickerMode = mode === "fallback" ? "fallback" : "model";
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      {...createModelPickerDialogProps(api, profileOpt, agentName, provider, pickerMode, returnTarget)}
    />
  ));
}

/**
 * Updates a specific agent's model within a profile file
 */
function updateAgentModel(
  api: any,
  profileOpt: any,
  agentName: string,
  fullModelId: string,
  mode: "model" | "fallback",
  returnTarget: ProfileDetailReturnTarget = "hub"
) {
  const selectionMode: ModelSelectionMode = mode === "fallback" ? "fallback" : "primary";
  createModelSelectionHandler(api, profileOpt, agentName, selectionMode, returnTarget)(fullModelId);
}

/**
 * Displays a list of recent memories associated with the current project
 * 
 * @param api - The TUI API instance
 */
export async function showProjectMemoriesMenu(api: any) {
  safeSetDialogSize(api, "large");
  const projectName = resolveEngramProjectName(api) || resolveProjectName(api) || "proyecto";

  try {
    const memories = await listProjectMemories(api);

    if (memories.length === 0) {
      api.ui.toast({
        title: NAV_TEXT.noMemories,
        message: `No se encontraron observaciones del proyecto para ${projectName}`,
        variant: "warning",
      });
      showProfilesMenuFn(api);
      return;
    }

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title={`Memorias: ${projectName}`}
        options={[
          ...memories.map((m) => ({
            title: truncateText(`[${m.id}] ${m.title || m.topic_key || `Memoria #${m.id}`}`, 60),
            value: String(m.id),
            description: `[${localizedMemoryType(m.type).toUpperCase()}] ${formatMemoryDate(
              m.updated_at || m.created_at
            )} · ${localizedMemoryScope(m.scope)}`,
          })),
          buildBackOption(),
        ]}
        onSelect={(opt: any) => {
          if (opt.value === "__back__") showProfilesMenuFn(api);
          else {
            const memory = memories.find((item) => String(item.id) === opt.value);
            if (!memory) return;
            showMemoryDetail(api, memory);
          }
        }}
        onCancel={() => showProfilesMenuFn(api)}
      />
    ));
  } catch (e: any) {
    log.error(`showProjectMemoriesMenu: failed to load memories for ${projectName}`, e);
    api.ui.toast({ title: UI_TEXT.error, message: `No se pudieron cargar las memorias: ${e.message}`, variant: "error" });
    showProfilesMenuFn(api);
  }
}
