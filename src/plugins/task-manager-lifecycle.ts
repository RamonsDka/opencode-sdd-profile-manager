import * as fs from "node:fs";
import * as path from "node:path";
import { classifyTaskManagerHtml, currentTaskManagerMeta, isLegacyManagedTaskManagerHtml } from "./task-manager-classifier";
import { collectTaskManagerGitEvidence } from "./task-manager-git";
import {
  writeTaskManagerStateAtomically,
  withDashboardWriteLock,
} from "./task-manager-writer";

export { writeTaskManagerStateAtomically };

export interface ProvisionTaskManagerResult {
  created: boolean;
  migrated: boolean;
  path: string;
  route: "background" | "foreground";
}

const STATE_ISLAND = /(<script\b[^>]*\bid=["']tm-state["'][^>]*>)([\s\S]*?)(<\/script>)/i;

export function escapeIslandJson(state: unknown): string {
  return JSON.stringify(state).replace(/<\/script>/gi, "\\u003c/script\\u003e");
}

export function migrateLegacyTaskManagerHtml(
  existingHtml: string,
  templateHtml: string
): { migrated: boolean; html: string; error?: string } {
  if (!isLegacyManagedTaskManagerHtml(existingHtml)) {
    return { migrated: false, html: existingHtml };
  }

  const match = existingHtml.match(STATE_ISLAND);
  if (!match) {
    return { migrated: false, html: existingHtml, error: "Missing state island" };
  }

  try {
    const existingState = JSON.parse(match[2]) as Record<string, unknown>;
    const meta = currentTaskManagerMeta();
    const existingMeta = (existingState.meta && typeof existingState.meta === "object") ? (existingState.meta as Record<string, unknown>) : {};

    // Preserve all existing custom metadata while normalizing managed version markers
    const mergedMeta = {
      ...existingMeta,
      signature: meta.signature,
      pluginVersion: meta.pluginVersion,
      templateVersion: meta.templateVersion,
      schemaVersion: meta.schemaVersion,
      stateVersion: meta.stateVersion,
    };

    // Preserve the complete data payload: phases, tasks, todos, git, tree, codegraph, history, custom fields
    const mergedState: Record<string, unknown> = {
      ...existingState,
      ...meta,
      meta: mergedMeta,
    };

    const newIslandJson = escapeIslandJson(mergedState);
    if (!STATE_ISLAND.test(templateHtml)) {
      return { migrated: false, html: existingHtml, error: "Template missing state island" };
    }

    const migratedHtml = templateHtml.replace(STATE_ISLAND, (_match, open, _current, close) => `${open}${newIslandJson}${close}`);
    return { migrated: true, html: migratedHtml };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { migrated: false, html: existingHtml, error: message };
  }
}

export function setTaskManagerRunningState(filePath: string, source = "opening"): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(STATE_ISLAND);
    if (!match) return false;
    const state = JSON.parse(match[2]) as Record<string, any>;
    if (!state.meta || typeof state.meta !== "object") state.meta = {};
    state.meta.syncStatus = "running";
    delete state.meta.lastError;
    state.meta.lastSyncSource = source;
    state.meta.lastSyncStartAt = new Date().toISOString();

    const json = escapeIslandJson(state);
    const updated = content.replace(STATE_ISLAND, (_match, open, _current, close) => `${open}${json}${close}`);
    writeTaskManagerStateAtomically(filePath, updated);
    return true;
  } catch {
    return false;
  }
}

export function setTaskManagerProlongedState(
  filePath: string,
  source = "agent-task-manager"
): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(STATE_ISLAND);
    if (!match) return false;
    const state = JSON.parse(match[2]) as Record<string, any>;
    if (!state.meta || typeof state.meta !== "object") state.meta = {};
    state.meta.syncStatus = "prolonged";
    delete state.meta.lastError;
    state.meta.lastSyncSource = source;
    state.meta.lastSyncProlongedAt = new Date().toISOString();

    const json = escapeIslandJson(state);
    const updated = content.replace(STATE_ISLAND, (_match, open, _current, close) => `${open}${json}${close}`);
    writeTaskManagerStateAtomically(filePath, updated);
    return true;
  } catch {
    return false;
  }
}

export function setTaskManagerSyncedState(
  filePath: string,
  source = "agent-task-manager",
  timestamp = new Date().toISOString()
): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(STATE_ISLAND);
    if (!match) return false;
    const state = JSON.parse(match[2]) as Record<string, any>;
    if (!state.meta || typeof state.meta !== "object") state.meta = {};
    state.meta.syncStatus = "synced";
    state.meta.lastSyncAt = timestamp;
    state.meta.lastSyncCompletedAt = timestamp;
    state.meta.lastSyncSource = source;
    delete state.meta.lastError;

    const json = escapeIslandJson(state);
    const updated = content.replace(STATE_ISLAND, (_match, open, _current, close) => `${open}${json}${close}`);
    writeTaskManagerStateAtomically(filePath, updated);
    return true;
  } catch {
    return false;
  }
}

export function setTaskManagerErrorState(
  filePath: string,
  errorMessage: string,
  source = "agent-task-manager"
): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(STATE_ISLAND);
    if (!match) return false;
    const state = JSON.parse(match[2]) as Record<string, any>;
    if (!state.meta || typeof state.meta !== "object") state.meta = {};
    state.meta.syncStatus = "error";
    state.meta.lastError = errorMessage.slice(0, 300);
    state.meta.lastSyncSource = source;

    const json = escapeIslandJson(state);
    const updated = content.replace(STATE_ISLAND, (_match, open, _current, close) => `${open}${json}${close}`);
    writeTaskManagerStateAtomically(filePath, updated);
    return true;
  } catch {
    return false;
  }
}

export function provisionTaskManagerBase(
  root: string,
  template: string,
  route: "background" | "foreground"
): ProvisionTaskManagerResult {
  const target = path.join(root, "Task-Manager-Portable.html");
  let templateSource = "";
  try {
    templateSource = fs.readFileSync(template, "utf8");
  } catch {
    templateSource = '<script id="tm-state">{"schemaVersion":"1.0"}</script>';
  }

  if (fs.existsSync(target)) {
    try {
      const existingHtml = fs.readFileSync(target, "utf8");
      const classification = classifyTaskManagerHtml(existingHtml);
      const isLegacy = isLegacyManagedTaskManagerHtml(existingHtml);

      // If already current and has no obsolete welcome dialog or delegation markers, keep as is
      if (
        classification === "current" &&
        !existingHtml.includes("welcome-dialog") &&
        !existingHtml.includes("AUTÓNOMO + SUBAGENTE") &&
        !existingHtml.includes("Delegación y Subagente")
      ) {
        return { created: false, migrated: false, path: target, route };
      }

      // If it is an old managed template or contains legacy Task Manager markers, migrate safely
      if (isLegacy) {
        const migration = migrateLegacyTaskManagerHtml(existingHtml, templateSource);
        if (migration.migrated) {
          writeTaskManagerStateAtomically(target, migration.html);
          return { created: false, migrated: true, path: target, route };
        }
      }

      return { created: false, migrated: false, path: target, route };
    } catch {
      return { created: false, migrated: false, path: target, route };
    }
  }

  const gitEvidence = collectTaskManagerGitEvidence(root);
  const initialState = {
    ...currentTaskManagerMeta(),
    meta: {
      syncStatus: "Pendiente de actualización",
      ...(gitEvidence?.branch ? { branch: gitEvidence.branch } : {}),
      ...(gitEvidence?.commits[0]?.hash ? { commit: gitEvidence.commits[0].hash } : {}),
    },
    git: gitEvidence ?? {
      branch: "",
      totalCount: 0,
      limit: 5,
      commits: [],
      syncStatus: "idle",
    },
    phases: [],
    tasks: [],
    todos: [],
  };
  const json = escapeIslandJson(initialState);
  const html = templateSource.replace(STATE_ISLAND, (_match, open, _current, close) => `${open}${json}${close}`);
  writeTaskManagerStateAtomically(target, html);
  return { created: true, migrated: false, path: target, route };
}

export function validateTaskManagerAgentOutput(value: unknown): { valid: true } | { valid: false; message: string } {
  if (!value || typeof value !== "object") return { valid: false, message: "La respuesta del agente no contiene estado válido." };
  const output = value as Record<string, unknown>;
  if (Object.keys(output).some((key) => !["state", "summary", "provenance"].includes(key))) return { valid: false, message: "La respuesta del agente excede el contrato de estado." };
  const provenance = output.provenance as Record<string, unknown> | undefined;
  if (!output.state || typeof output.summary !== "string" || provenance?.agent !== "Agent-Task-Manager" || typeof provenance.requestId !== "string") return { valid: false, message: "La respuesta del agente no contiene estado válido." };
  return { valid: true };
}

/** Opens a project-local managed dashboard without granting the agent repository authority. */
export function openManagedTaskManagerForProject(root: string): string {
  return path.join(root, "Task-Manager-Portable.html");
}
