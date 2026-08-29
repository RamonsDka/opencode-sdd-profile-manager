import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface TaskManagerProjectIdentity {
  root: string;
  canonicalRoot: string;
  key: string;
  confirmed: boolean;
}

export interface TaskManagerRootCandidates {
  cwd: string;
  gitRoot?: string;
  manifestRoot?: string;
}

export type TaskManagerPreference = { consent: boolean; enabled: boolean };

function canonicalize(candidate: string): string {
  return path.win32.normalize(candidate).replaceAll("\\", "/").replace(/\/$/, "");
}

export function resolveTaskManagerRoot(candidates: TaskManagerRootCandidates): TaskManagerProjectIdentity {
  const selected = candidates.gitRoot ?? candidates.manifestRoot ?? candidates.cwd;
  const canonicalRoot = canonicalize(selected);
  return {
    root: canonicalRoot,
    canonicalRoot,
    key: canonicalRoot.toLowerCase(),
    confirmed: candidates.gitRoot !== undefined || candidates.manifestRoot !== undefined,
  };
}

export function detectGitRootForDirectory(directory: string): string | undefined {
  if (!directory || !fs.existsSync(directory)) {
    return undefined;
  }
  try {
    const root = child_process.execFileSync(
      "git",
      ["-C", directory, "rev-parse", "--show-toplevel"],
      {
        encoding: "utf-8",
        timeout: 2000,
        stdio: ["ignore", "pipe", "ignore"],
      }
    ).trim();
    return root ? path.normalize(root) : undefined;
  } catch {
    return undefined;
  }
}

export function buildTaskManagerRootCandidates(directory: string): TaskManagerRootCandidates {
  const gitRoot = detectGitRootForDirectory(directory);
  return {
    cwd: directory,
    ...(gitRoot ? { gitRoot } : {}),
  };
}

export function buildTaskManagerConsentNotice(project: TaskManagerProjectIdentity): string {
  return `Con tu consentimiento, se usará ${project.canonicalRoot} para crear o actualizar el Task Manager portátil. Se abrirá una base funcional y continuará una actualización asíncrona; se podrá abrir en el navegador.`;
}

export function createTaskManagerConsentStore() {
  const preferences = new Map<string, TaskManagerPreference>();
  return {
    get: async <T extends { key: string }>(project: T) => preferences.get(project.key),
    accept: async <T extends { key: string }>(project: T) => { preferences.set(project.key, { consent: true, enabled: true }); },
    optOut: async <T extends { key: string }>(project: T) => { preferences.set(project.key, { consent: true, enabled: false }); },
  };
}
