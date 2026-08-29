---
name: task-tracker-manager
description: "Manage and synchronize portable single-file HTML task dashboards via JSON island state. Trigger: task-tracker-manager, task manager, update task manager, portable task manager, tracker html, drop-in task manager, gestor de tareas."
license: Apache-2.0
metadata:
  author: "opencode-task-manager"
  version: "1.0"
---

## Activation Contract

Load this skill when the user, orchestrator, or background event triggers: `task-tracker-manager`, `task manager`, `gestor de tareas`, `update task manager`, `actualizar task manager`, `portable task manager`, `Task-Manager-Portable`, `drop-in task manager`, `tracker html`, `update progress`, or any workflow touching `Task-Manager-Portable.html` or `drop-in-task-manager.html`.

## Target File Resolution

1. Dynamically resolve `Task-Manager-Portable.html` (or fallback `drop-in-task-manager.html`) from the canonical project root (`git rev-parse --show-toplevel` or active workspace directory).
2. If neither file exists and initialization is required, copy the portable template into the canonical project root.

## Hard Rules

- **Island-only mutation**: Modify ONLY `<script type="application/json" id="tm-state">...</script>`. Never alter HTML markup, CSS styling, or JavaScript execution logic outside this block.
- **Schema version**: Keep `schemaVersion: "1.0"` intact — never change or remove.
- **Script tag escaping**: Always escape all occurrences of `</script>` inside JSON strings as `\u003c/script\u003e` via `JSON.stringify(state).replace(/<\/script>/gi, '\\u003c/script\\u003e')` before saving.
- **Valid statuses**: Allowed task and phase `status` values are strictly `pending`, `in-progress`, `completed`, `blocked`. Unknown statuses map to `pending`. Allowed todo priorities are `P0`, `P1`, `P2`.
- **Pure offline constraint**: Zero external dependencies, no `fetch`/XHR/`import`/`<script src=`. Dashboard must function over `file://`.
- **No state in localStorage**: Application state lives solely in the HTML island; only the UI preference `tm-filter` may touch localStorage.
- **Evidence-based sync**: Sync `git`, `tree`, or `codegraph` properties only from verified command execution output; never invent commit hashes or symbols.
- **Preserve custom data**: On refresh or synchronization, never overwrite or wipe custom task IDs, user notes, custom fields, or manual modifications. All updates must be additive and status-oriented.
- **Final state contract**: On successful write, set `meta.syncStatus` to `"synced"`, `meta.lastSyncCompletedAt`, `meta.lastSyncAt`, and `meta.lastUpdated` to current ISO timestamp (`new Date().toISOString()`).
- **Host-managed telemetry**: The `tokenUsage` state property is collected and managed exclusively by host telemetry. Agent Task Manager must preserve `tokenUsage` intact and must never fabricate, estimate, or overwrite it.

## Execution Steps

1. **Locate & Read**:
   - Locate `Task-Manager-Portable.html` from the canonical project root.
   - Extract the JSON content inside `<script type="application/json" id="tm-state">` and parse with `JSON.parse`.
2. **Validate & Repair**:
   - Validate state structure (`schemaVersion: "1.0"`, `meta`, `phases`, `todos`).
   - If invalid or missing keys, repair missing required arrays while preserving all existing valid data.
3. **Synchronize & Mutate**:
   - **Initialization**: Discover workspace context (Git status/branch/commits, repository structure, packages, specs/tasks) and establish initial phases and tasks.
   - **Refresh**: Update statuses based on latest milestone or work evidence. Preserve task IDs, user notes, and manual additions.
   - **Phases/Tasks**: Update `status` (`pending`, `in-progress`, `completed`, `blocked`), titles, subtasks, notes, or owners.
   - **Todos**: Add, toggle `done`, prioritize (`P0`, `P1`, `P2`), or remove entries in `todos[]`.
   - **Metadata**: Update `meta.lastUpdated` to current ISO string.
4. **Escape & Save**:
   - Serialize state: `const islandJson = JSON.stringify(state, null, 2).replace(/<\/script>/gi, '\\u003c/script\\u003e');`.
   - Replace only the inner content of `<script id="tm-state">` in the HTML file.
5. **Report**:
   - Return structured progress summary: updated file path, phase and task counts, overall percentage, and active blockers.

## Output Contract

Return:
- Target file path updated.
- Summary: phase/task counts, `overallPct`, active blockers, and updated quick todos.
- Verification: JSON island validity and offline compliance confirmation.
