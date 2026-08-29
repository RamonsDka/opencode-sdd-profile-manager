import { join } from "node:path";
import type { AgentMode, BuiltInDefinition, BuiltInOverride, BuiltInRuntimeAgent, CustomAgent } from "./types.ts";

const PUBLIC_IDS = ["general", "build", "plan", "explore"] as const;
const INTERNAL_IDS = ["compaction", "title", "summary"] as const;
const EXCLUDED_PREFIXES = ["sdd-", "review-", "jd-"];
const EXCLUDED_IDS = new Set(["gentle-orchestrator"]);

export const GITHUB_AGENT_ID = "agent-github";
export const GITHUB_AGENT_LEGACY_ID = "agent-especialit-github";
export const TASK_MANAGER_AGENT_ID = "agent-task-manager";

export function defaultTaskManagerTargetPath(home = process.env.USERPROFILE || process.env.HOME || ""): string {
  return home
    ? join(home, "projects", "0.-MEJORA-OPENCODE-TRABAJANDO", "proyecto-HTLM", "Task-Manager-Portable.html")
    : "Task-Manager-Portable.html";
}

export const TASK_MANAGER_TARGET_PATH = defaultTaskManagerTargetPath();

/** Maps persisted compatibility aliases to the one runtime identity. */
export function normalizeAgentId(id: string): string {
  return id === GITHUB_AGENT_LEGACY_ID ? GITHUB_AGENT_ID : id;
}

export function mergeCanonicalAgent<T extends object>(canonical?: T, legacy?: T): T | undefined {
  if (!canonical) return legacy ? { ...legacy } : undefined;
  return legacy ? { ...legacy, ...canonical } : { ...canonical };
}

function baseline(description: string, operations: string, skills: string[], model = "opencode/default", effort = "medium", mode?: AgentMode) {
  return Object.freeze({ description, model, effort, ...(mode !== undefined ? { mode } : {}), operations, skills: Object.freeze([...skills]) });
}

function definition(
  id: string,
  displayName: string,
  classification: "public" | "internal",
  description: string,
  operations: string,
  skills: string[],
  model = "opencode/default",
  effort = "medium",
  mode?: AgentMode,
): BuiltInDefinition {
  return Object.freeze({
    id,
    displayName,
    classification,
    curation: "curated",
    baseline: baseline(description, operations, skills, model, effort, mode),
  });
}

export const CANONICAL_BUILT_IN_AGENTS: readonly BuiltInDefinition[] = Object.freeze([
  definition("general", "General", "public", "Agente general para coordinar solicitudes de producto.", "Aclara objetivos y coordina trabajo sin sustituir especialistas.", ["planning"]),
  definition("build", "Build", "public", "Agente de implementación de cambios de código verificables.", "Implementa cambios pequeños, ejecuta pruebas y comunica evidencia.", ["testing"]),
  definition("plan", "Plan", "public", "Agente de planificación técnica y descomposición de cambios.", "Propone pasos, riesgos y límites antes de modificar código.", ["planning"]),
  definition("explore", "Explore", "public", "Agente de investigación estructural del código existente.", "Inspecciona dependencias y devuelve hallazgos respaldados por evidencia.", ["research"]),
  definition("compaction", "Compaction", "internal", "Agente interno de conservación silenciosa del contexto de sesión.", "Captura memoria durable y auditoría contextual sin editar ni delegar.", []),
  definition("title", "Title", "internal", "Agente interno para crear títulos breves de sesión.", "Genera títulos con lecturas permitidas y auditoría silenciosa, sin efectos secundarios.", []),
  definition("summary", "Summary", "internal", "Agente interno para resumir resultados durables de sesión.", "Resume contexto y registra auditoría silenciosa sin editar ni ejecutar shell libre.", []),
]);

export const CANONICAL_BUILT_IN_AGENT_IDS = Object.freeze(CANONICAL_BUILT_IN_AGENTS.map((agent) => agent.id));

const canonicalByID = new Map(CANONICAL_BUILT_IN_AGENTS.map((agent) => [agent.id, agent]));

export const CURATED_SPECIALIST_DEFINITIONS: readonly BuiltInDefinition[] = Object.freeze([
  definition(
    TASK_MANAGER_AGENT_ID,
    "Agent Task Manager",
    "public",
    "Specialist agent for inspecting, updating, and syncing Task-Manager-Portable.html via JSON island state. Triggers: task manager, gestor de tareas, Task-Manager-Portable, actualizar task manager, update task manager, tracker html, drop-in task manager.",
    `Inspect, create, update, sync, and validate tasks, phases, and quick todos in ${TASK_MANAGER_TARGET_PATH} preserving offline structure and JSON island schemaVersion 1.0.`,
    ["task-tracker-manager"],
    "opencode/default",
    "medium",
    "all",
  ),
]);

export const CURATED_BUILT_IN_AGENTS: readonly BuiltInDefinition[] = Object.freeze([
  ...CANONICAL_BUILT_IN_AGENTS,
  ...CURATED_SPECIALIST_DEFINITIONS,
]);

const curatedByID = new Map<string, BuiltInDefinition>([
  ...CANONICAL_BUILT_IN_AGENTS.map((agent) => [agent.id, agent] as const),
  ...CURATED_SPECIALIST_DEFINITIONS.map((agent) => [agent.id, agent] as const),
]);

export function getBuiltInDefinition(id: string): BuiltInDefinition | undefined {
  return curatedByID.get(normalizeAgentId(id));
}

export function isCanonicalBuiltInAgent(id: string): boolean {
  return curatedByID.has(normalizeAgentId(id));
}

export function isInternalBuiltInAgent(id: string): boolean {
  return (INTERNAL_IDS as readonly string[]).includes(id);
}

export function createPendingBuiltInDefinition(id: string): BuiltInDefinition {
  const displayName = id.replace(/(?:^|-)([a-z0-9])/g, (_, character: string) => character.toUpperCase());
  return Object.freeze({
    id,
    displayName,
    classification: "public",
    curation: "pending-curation",
    baseline: baseline(
      "Agente integrado detectado pendiente de curación.",
      "No se han definido operaciones curadas para este agente.",
      [],
    ),
    warnings: Object.freeze(["Este agente está pendiente de curación; no se hacen afirmaciones sobre sus capacidades."]),
  });
}

export function isDiscoverableBuiltInAgent(id: string, customIDs: readonly string[] = []): boolean {
  const normalized = normalizeAgentId(id);
  return !curatedByID.has(normalized)
    && !EXCLUDED_IDS.has(id)
    && !customIDs.map(normalizeAgentId).includes(normalized)
    && !EXCLUDED_PREFIXES.some((prefix) => id.startsWith(prefix))
    && !id.endsWith("-fallback");
}

export function discoverBuiltInAgents(
  runtime: Record<string, BuiltInRuntimeAgent>,
  customIDs: readonly string[] = [],
): BuiltInDefinition[] {
  return Object.keys(runtime)
    .filter((id) => isDiscoverableBuiltInAgent(id, customIDs))
    .sort((left, right) => left.localeCompare(right))
    .map((id) => getBuiltInDefinition(id) ?? createPendingBuiltInDefinition(id));
}

export function restoreBuiltInBaseline(
  id: string,
  overrides: Record<string, BuiltInOverride> = {},
): Record<string, BuiltInOverride> {
  if (!isCanonicalBuiltInAgent(id)) throw new Error(`Unknown built-in agent: ${id}`);
  const restored = { ...overrides };
  delete restored[id];
  return restored;
}

export function createTaskManagerAgent(
  model = "opencode/default",
  variant?: string,
  targetPath = TASK_MANAGER_TARGET_PATH,
): CustomAgent {
  return {
    id: TASK_MANAGER_AGENT_ID,
    description: "Specialist agent for inspecting, updating, and syncing Task-Manager-Portable.html via JSON island state. Triggers: task manager, gestor de tareas, Task-Manager-Portable, actualizar task manager, update task manager, tracker html, drop-in task manager.",
    model,
    ...(variant !== undefined ? { variant } : {}),
    mode: "all",
    prompt: `You are Agent Task Manager, a specialized agent dedicated to inspecting, maintaining, synchronizing, and repairing single-file portable HTML task dashboards, specifically '${targetPath}' (or workspace fallbacks 'Task-Manager-Portable.html' / 'drop-in-task-manager.html').

## Target & Boundaries
- Primary file: '${targetPath}'.
- Work exclusively on the JSON state island: '<script type="application/json" id="tm-state">'.
- Never modify HTML markup, CSS styling, or JavaScript logic outside the island unless explicitly instructed.
- Keep 'schemaVersion: "1.0"' intact.
- Ensure all closing '</script>' occurrences inside JSON strings are escaped as '\\u003c/script\\u003e' before writing.

## Core Capabilities & Operations
1. **Inspection**: Parse and inspect phases, tasks, status distribution, overall progress, and quick todos.
2. **Phase & Task Management**: Create, update, reorder, block, and complete phases and tasks. Ensure valid statuses: 'pending', 'in-progress', 'completed', 'blocked'.
3. **Quick Todos**: Add, toggle ('done'), prioritize ('P0', 'P1', 'P2'), or remove quick todos in 'todos'.
4. **Metadata Sync (Evidence-based only)**:
   - When 'meta.features.git' is enabled, sync branch/commit info ONLY from verifiable Git commands (e.g., 'git status', 'git branch --show-current', 'git log -1'). Never invent Git history.
   - When 'meta.features.codegraph' is enabled, sync architecture/symbol metadata ONLY from empirical CodeGraph explore/status evidence. Never hallucinate symbols.
5. **Validation & State Repair**: Validate state against schemaVersion 1.0; repair missing required arrays ('phases', 'todos'); recalculate derived completion metrics without hardcoding derived metrics incorrectly.
6. **Reporting**: Provide concise progress receipts (e.g., phase progress, overall %, active blockers, file size).

## Safety & Offline Rules
- Pure offline file:// compatibility: zero external dependencies, no fetch/XHR, no external scripts.
- Preserve host-managed 'tokenUsage' property intact; never fabricate, estimate, or overwrite tokenUsage.
- Final state contract: Upon successfully writing the state island, set meta.syncStatus to "synced", and set meta.lastSyncCompletedAt, meta.lastSyncAt, and meta.lastUpdated to the current ISO timestamp (new Date().toISOString()).
- Do not store state in localStorage (only 'tm-filter' UI preference is allowed).
- All user-facing text rendered must be HTML-escaped.
- Deny unvetted task delegations. Use bash with explicit prompt confirmation ('ask') for safe read-only queries and verification.`,
    permissions: {
      read: "allow",
      edit: "allow",
      skill: "allow",
      bash: "ask",
      task: "deny",
      write: "ask",
    },
    skills: ["task-tracker-manager"],
  };
}

export const BUILT_IN_AGENT_CLASSES = Object.freeze({ public: PUBLIC_IDS, internal: INTERNAL_IDS });
