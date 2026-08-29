export type TaskManagerHtmlClass = "missing" | "current" | "old" | "unrecognized";

const SIGNATURE = "opencode-task-manager";
const TEMPLATE_VERSION = "1.4.0";
const SCHEMA_VERSION = "1.0";
const STATE_VERSION = 1;
const PLUGIN_VERSION = "1.8.0";

export const TASK_MANAGER_CAPABILITY_TOKEN_INSIGHTS = "token-insights-v2";

export function currentTaskManagerMeta() {
  return { signature: SIGNATURE, pluginVersion: PLUGIN_VERSION, templateVersion: TEMPLATE_VERSION, schemaVersion: SCHEMA_VERSION, stateVersion: STATE_VERSION };
}

export function isLegacyManagedTaskManagerHtml(html: string | undefined): boolean {
  if (typeof html !== "string" || !html.trim()) return false;
  const island = html.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!island) return false;
  try {
    const state = JSON.parse(island) as Record<string, unknown>;
    const hasValidStructure =
      state.schemaVersion === SCHEMA_VERSION ||
      Array.isArray(state.phases) ||
      Array.isArray(state.todos) ||
      (state.meta !== null && typeof state.meta === "object") ||
      Array.isArray(state.tasks);

    if (!hasValidStructure) return false;

    // Strong Task Manager or legacy markers
    const hasLegacyMarkers =
      html.includes("welcome-dialog") ||
      html.includes("Delegación y Subagente") ||
      html.includes("AUTÓNOMO + SUBAGENTE") ||
      html.includes("TMCore") ||
      html.includes("tm-error-banner") ||
      html.includes("opencode-task-manager") ||
      html.includes("Task-Manager-Portable") ||
      html.includes("drop-in-task-manager") ||
      html.includes('data-tm-capability="token-insights-v1"') ||
      html.includes(`data-tm-capability="${TASK_MANAGER_CAPABILITY_TOKEN_INSIGHTS}"`) ||
      state.signature === SIGNATURE;

    return hasLegacyMarkers;
  } catch {
    return false;
  }
}

export function classifyTaskManagerHtml(html: string | undefined): TaskManagerHtmlClass {
  if (html === undefined) return "missing";
  const island = html.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!island) return "unrecognized";
  try {
    const state = JSON.parse(island) as Partial<ReturnType<typeof currentTaskManagerMeta>> & Record<string, unknown>;
    if (state.signature !== SIGNATURE || state.schemaVersion !== SCHEMA_VERSION || state.stateVersion !== STATE_VERSION || typeof state.pluginVersion !== "string") return "unrecognized";

    // If it has legacy markers like the obsolete welcome dialog, it is considered old and eligible for shell upgrade
    if (html.includes("welcome-dialog") || html.includes("AUTÓNOMO + SUBAGENTE") || html.includes("Delegación y Subagente")) {
      return "old";
    }

    // Must have the required structural capability marker (e.g. token-insights-v2)
    if (!html.includes(`data-tm-capability="${TASK_MANAGER_CAPABILITY_TOKEN_INSIGHTS}"`)) {
      return "old";
    }

    const templateVer = state.templateVersion || (state.meta && typeof state.meta === "object" && (state.meta as any).templateVersion);
    const pluginVer = state.pluginVersion || (state.meta && typeof state.meta === "object" && (state.meta as any).pluginVersion);

    return templateVer === TEMPLATE_VERSION && pluginVer === PLUGIN_VERSION ? "current" : "old";
  } catch {
    return "unrecognized";
  }
}
