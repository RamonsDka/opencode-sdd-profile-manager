export const TASK_MANAGER_MANAGED_MARKER = "<!-- opencode-agent-suite:managed:agent-task-manager:v1 -->";

export const TASK_MANAGER_RECOMMENDED_PERMISSIONS = Object.freeze({
  read: "allow",
  glob: "allow",
  grep: "allow",
  list: "allow",
  skill: "allow",
  task: "deny",
  todowrite: "allow",
  question: "allow",
  external_directory: "ask",
  bash: Object.freeze({
    "*": "ask",
    "git status*": "allow",
    "git branch --show-current*": "allow",
    "git log*": "allow",
    "git rev-parse*": "allow",
  }),
  edit: Object.freeze({
    "*": "ask",
    "*Task-Manager-Portable.html*": "allow",
    "*drop-in-task-manager.html*": "allow",
  }),
});

export const TASK_MANAGER_PROMPT_PERMISSIONS = Object.freeze({
  read: "allow",
  glob: "allow",
  grep: "allow",
  list: "allow",
  skill: "allow",
  task: "deny",
  todowrite: "allow",
  question: "allow",
  edit: "ask",
  bash: "ask",
  external_directory: "ask",
});

export function getAgentPermissionProfile(agentId, profile = "recommended") {
  if (profile === "none") return null;
  if (agentId === "agent-task-manager") {
    return profile === "recommended"
      ? { ...TASK_MANAGER_RECOMMENDED_PERMISSIONS }
      : { ...TASK_MANAGER_PROMPT_PERMISSIONS };
  }
  return null;
}

export function isManagedTaskManagerMarkdown(content) {
  if (typeof content !== "string") return false;
  return content.includes(TASK_MANAGER_MANAGED_MARKER) || content.includes("opencode-agent-suite:managed");
}

export function formatPermissionsYaml(permissions) {
  if (!permissions || typeof permissions !== "object") return "  read: allow";
  const entries = Object.entries(permissions);
  if (entries.length === 0) return "  read: allow";

  const lines = [];
  for (const [key, rule] of entries) {
    if (typeof rule === "string") {
      lines.push(`  ${key}: ${rule}`);
    } else if (rule && typeof rule === "object") {
      lines.push(`  ${key}:`);
      const subEntries = Object.entries(rule);
      const star = subEntries.find(([k]) => k === "*");
      const others = subEntries.filter(([k]) => k !== "*");
      const orderedSubEntries = star ? [star, ...others] : others;
      for (const [subKey, subVal] of orderedSubEntries) {
        const safeKey = /^[a-zA-Z0-9_-]+$/.test(subKey) ? subKey : JSON.stringify(subKey);
        lines.push(`    ${safeKey}: ${subVal}`);
      }
    }
  }
  return lines.length > 0 ? lines.join("\n") : "  read: allow";
}

export function generateTaskManagerMarkdown(profile = "recommended", targetPath = "Task-Manager-Portable.html") {
  const permissions = getAgentPermissionProfile("agent-task-manager", profile);
  if (!permissions) return null;
  const permissionYaml = formatPermissionsYaml(permissions);
  return `---
name: agent-task-manager
description: "Specialist agent for inspecting, updating, and syncing Task-Manager-Portable.html via JSON island state. Triggers: task manager, gestor de tareas, Task-Manager-Portable, actualizar task manager, update task manager, tracker html, drop-in task manager."
mode: all
model: opencode/default
permission:
${permissionYaml}
---

${TASK_MANAGER_MANAGED_MARKER}

You are Agent Task Manager, a specialized agent dedicated to inspecting, maintaining, synchronizing, and repairing single-file portable HTML task dashboards, specifically '${targetPath}' (or workspace fallbacks 'Task-Manager-Portable.html' / 'drop-in-task-manager.html').

## Target & Boundaries
- Primary file: '${targetPath}'.
- Work exclusively on the JSON state island: '<script type="application/json" id="tm-state">'.
- Never modify HTML markup, CSS styling, or JavaScript logic outside the island unless explicitly instructed.
- Keep 'schemaVersion: "1.0"' intact.
- Ensure all closing '</script>' occurrences inside JSON strings are escaped as '\\\\u003c/script\\\\u003e' before writing.

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
- Deny unvetted task delegations. Use bash with explicit prompt confirmation ('ask') for safe read-only queries and verification.

Use the associated skills: task-tracker-manager. Follow their instructions explicitly.
`;
}
