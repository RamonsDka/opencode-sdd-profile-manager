# Usage & Workflow Guide

This guide provides an end-to-step operational walkthrough for the **OpenCode SDD Profile Manager** principal plugin pack and its integrated companion plugins.

---

## 1. Opening the Interface

Launch the SDD Profile Manager using any of the following methods:
- **Keyboard Shortcut**: Press **`Alt+K`** or **`Super+K`**
- **Chat Command**: Type **`/sdd-model`** or **`:sdd-model`** in the OpenCode prompt

The initial screen presents options to manage SDD profiles, create new profiles, browse Engram project memories, access companion plugins, and adjust status badge preferences.

---

## 2. Profile Management Lifecycle

### Creating a Profile
1. Select **Create new SDD profile**.
2. Enter a safe profile name (e.g. `team-review-stack` or `production-v2`). Profile names containing path traversal characters (`..`, `/`, `\`) are automatically rejected.
3. The new profile is initialized and added to `~/.config/opencode/profiles/`.

### Managing Existing Profiles
From the **Manage SDD profiles** menu:
- Select a profile to view its model mappings, reasoning effort levels, and fallback rules.
- Rename, clone, or delete profiles cleanly.
- Select **Activate profile** to apply the configuration to the active OpenCode runtime.

After activation, the profile list displays a persistent indicator:
```text
✓ team-production
  ✓ Active
```

---

## 3. Configuring Models & Reasoning Effort

The profile detail screen groups the 25 supported agents into five intuitive categories:

1. **Orchestrator**: `sdd-ORCHETATOR`
2. **SDD Core**: `sdd-propose`, `sdd-design`, `sdd-apply`, `sdd-verify`, `sdd-spec`, `sdd-onboard`, `sdd-explore`, `sdd-init`, `sdd-tasks`, `sdd-archive`
3. **Judgment Day**: `jd-judge-a`, `jd-judge-b`, `jd-fix-agent`
4. **Reviewers**: `review-readability`, `review-reliability`, `review-resilience`, `review-validator`, `review-refuter`, `review-risk`, `model-audit`
5. **Auxiliaries**: `gentle-ai-windows-validator`, `compaction`, `summary`, `title`

### Model Assignment
Select any agent row to open the grouped provider and model picker. Unassigned agents remain visible so profiles can be drafted incrementally.

### Reasoning Effort Tuning
Select **Reasoning effort** and choose a target agent:
- Supported values: `low`, `medium`, `high`, `xhigh`, `max`.
- If the assigned model does not support reasoning effort, the interface explains the restriction based on provider metadata.
- Preserves the canonical `reasoningEffort` property in profile configuration.

### Fallback Policy Configuration
Select **Configure fallbacks** to assign backup models for primary agents:
- Primary agents with configured fallbacks automatically route tasks to `*-fallback` sub-agents if the primary model fails or times out.
- Auxiliary agents (`compaction`, `summary`, `title`) are intentionally excluded from fallback generation.

---

## 4. Bulk Operations & Safe Overwrites

To configure multiple agents quickly without repetitive manual selection, open **Bulk actions**:

- **Complete missing**: Assigns a selected model/effort only to unassigned agents, preserving existing choices.
- **Overwrite**: Replaces assignments across an entire phase group (e.g. all SDD Core agents or all Reviewers). Requires explicit confirmation.

Automatic snapshots are created before every bulk operation so any change can be rolled back immediately.

---

## 5. Profile Snapshots & Version Restoration

Select **Profile versions...** from the profile screen to review saved configuration snapshots:
- Snapshots are created automatically prior to bulk edits and individual phase modifications.
- Up to 60 version snapshots per profile are retained under `~/.config/opencode/profile-versions/`.
- Select any snapshot to inspect a detailed diff preview.
- Choose **Restore this version** to revert the profile file back to that exact state.

---

## 6. Accessing Integrated Companion Plugins

From the main menu, select **Plugins...** to access companion tools:

### Suite de Agentes (Agent Suite)
- Browse the full catalog of registered built-in and custom agents.
- Inspect agent system prompts, tools, and assigned skills.
- Audit active per-turn consent grants (`usa también agente: <agent-id>`).
- Can also be opened independently with **`Alt+S`** or **`/agent-suite`**.

### Task Manager Portable
- Launch and synchronize the offline single-file HTML project cockpit.
- Inspect Kanban columns, sprint progress, CodeGraph module maps, and Git commit timelines.
- Update task state automatically via the integrated `task-tracker-manager` skill.

---

## 7. Project Memory Browsing (Engram)

Select **Project memories** to browse recent observations captured by the local Engram memory server (`http://127.0.0.1:7437`):
- Observations are resolved automatically by Git repository identity.
- Read-only browsing provides context on past architectural decisions, conventions, and bug fixes.
- Safe graceful degradation: if Engram is offline, an informative error toast appears without affecting profile operations.

---

## 8. Status Bar Badge Modes

The manager can display active profile information directly in the OpenCode status bar:
- **Model Mode**: Displays the primary model ID of the active profile.
- **Profile Mode**: Displays the active profile name.
- **Off**: Hides the status badge.

Preferences are stored in OpenCode KV state and persist across sessions.
