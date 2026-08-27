# Exploration: TUI Profile Usability and Activation Fix

## Overview
This exploration investigates seven usability, visual hierarchy, copy, and activation issues across the OpenCode SDD Engram plugin (`opencode-sdd-engram-manage`).

## Audit & Code Evidence Findings

### 1. Dialog Sizing & Host Supported Dimensions
- **Host Capabilities**: The OpenCode TUI host exposes `api.ui.dialog.setSize(size: DialogSize)` with predefined tier strings: `"medium"`, `"large"`, and `"xlarge"`.
- **Current Mapping**: In `src/dialogs.tsx`, `showProfileDetail` uses `"xlarge"`, but the high-density submenus (`showProfileDetailSubmenuPrimary`, `showProfileDetailSubmenuReasoning`, `showProfileDetailSubmenuFallback`) and `showReasoningEffortPicker` are mapped to `"large"`.
- **Host Dimension Ceiling**: `"xlarge"` instructs the host TUI container to expand to maximum terminal viewport dimensions (clamped only when terminal width < 80 cols). Arbitrary custom pixel/character dimension objects are not supported by the OpenCode host dialog API. Upgrading submenus and picker dialogs to `"xlarge"` achieves the maximum possible viewport utilization without modifying OpenCode core.

### 2. Exact Conceptual Agent Ordering & Inventory Discovery
- **Conceptual Group Ordering**:
  1. **Orchestrator**: `sdd-ORCHETATOR` (dynamically canonicalized to `gentle-orchestrator` or `sdd-orchestrator` via `OrchestratorPolicy`).
  2. **Core SDD**: `sdd-init`, `sdd-explore`, `sdd-propose`, `sdd-spec`, `sdd-design`, `sdd-tasks`, `sdd-apply`, `sdd-verify`, `sdd-archive`, `sdd-onboard`.
  3. **Judgment Day**: `jd-judge-a`, `jd-judge-b`, `jd-fix-agent`.
  4. **Review Agents**: `review-readability`, `review-reliability`, `review-resilience`, `review-validator`, `review-refuter`, `review-risk`.
  5. **Auxiliaries / Tools**: `gentle-ai-windows-validator`, `compaction`, `summary`, `title` (and `model-audit` as a specialized audit tool).
- **Eligibility Classification**:
  - **Visible in Dialogs**: All catalog agents above.
  - **Persistible in Profile JSON**: All primary agents and configured fallbacks.
  - **Runtime-Sync Eligible**: Primary SDD, JD, Review, and Validator agents. Excluded from runtime-sync: `sdd-ORCHETATOR` (synced via canonical orchestrator name), and `compaction`, `summary`, `title` (internal system tasks protected from custom agent injection).

### 3. Visual Category Separators in OpenTUI DialogSelect
- **Root Cause**: `buildCatalogRows` in `src/dialogs.tsx` was synthesizing explicit option items with `value: CATALOG_SEPARATOR_TOKEN` and `description: "No seleccionable"`. In OpenTUI's `DialogSelect`, all array elements in `options` are rendered as interactive list items that intercept arrow navigation and receive cursor focus.
- **Remediation**: Eliminate synthetic separator rows from the `options` array. Rely entirely on OpenTUI's native `category` property on each agent option (`category: localizedFamilyLabel(entry.family)`). This provides category grouping without inserting focusable divider rows.

### 4. Copy Renaming & Avoided Repetition
- **Copy Updates**:
  - Replace `UI_TEXT.reasoningEffort = "Esfuerzo de razonamiento"` with `"Nivel de esfuerzo"`.
  - Submenu title: `Nivel de esfuerzo › ${profileOpt.title}`.
  - Row titles in reasoning submenu: avoid redundant repeated phrases (e.g. change `sdd-apply esfuerzo de razonamiento` to simply `sdd-apply` or `sdd-apply: <valor>`, displaying state in description/badge).
- **Protected Literals (MUST NOT CHANGE)**:
  - Configuration property: `reasoningEffort` (schema key in JSON).
  - Action tokens: `reasoning:${agentName}`, `submenu-reasoning`.
  - TypeScript types: `ProfileAgentConfig`, `ModelMutationEffortPolicy`.

### 5. Screenshots' Separator Block Analysis
- **Why it appears**: Prior implementation added synthetic objects `{ title: "── Núcleo SDD ──", value: CATALOG_SEPARATOR_TOKEN, description: "No seleccionable" }` inside `buildCatalogRows`.
- **Existing behavior & tests**: `src/dialogs.test.ts` line 688 contains an explicit test (`'keeps separator rows visible and makes click or Enter selection a no-op'`). This codified the bad UX of focusable divider rows.

### 6. Profile Activation Error (`agent-suite-plugin.mjs`)
- **Error**: `Failed to load plugin ... agent-suite-plugin.mjs: Cannot find module 'C:\Users\DELL\projects\0.-MEJORA-OPENCODE-TRABAJANDO'`.
- **Trace**:
  1. `activateProfileFile` updates config via `api.client.global.config.update({ config: nextConfig })`.
  2. OpenCode reloads all plugins listed in `opencode.json`'s `plugin` array, including `./bin/agent-suite-plugin.mjs`.
  3. `C:\Users\DELL\.config\opencode\bin\agent-suite-plugin.mjs` calls `envOrHomePath("OPENCODE_WORKSPACE_ROOT", "projects", "0.-MEJORA-OPENCODE-TRABAJANDO", "suite-de-agentes", "dist", "server.js")`.
  4. In `C:\Users\DELL\.config\opencode\bin\resolve-home-path.cjs`, `envOrHomePath` has a defect: `if (configured) return path.resolve(configured);` (returns only the workspace root directory and drops the trailing segments).
  5. ESM `import("file:///C:/Users/DELL/projects/0.-MEJORA-OPENCODE-TRABAJANDO/sdd-engram")` tries to import a directory, which fails.
- **Root Cause & Boundary**:
  - `sdd-engram` repo: Correctly merges and preserves config without path corruption.
  - External config boundary: The defect resides in `resolve-home-path.cjs` in `.config/opencode`. `sdd-engram` must not mutate external configuration files, but must handle config update responses defensively.

### 7. Test Gaps
1. **Dialog Sizing**: Assert that submenus and pickers request `"xlarge"`.
2. **Category Grouping**: Assert that options have valid `category` metadata and zero synthetic separator options with `CATALOG_SEPARATOR_TOKEN`.
3. **Copy & Labels**: Assert reasoning submenu rows do not repeat `"esfuerzo de razonamiento"` or `"nivel de esfuerzo"` in item titles.
4. **Path Handling**: Assert activation handles paths with spaces in profile and config paths without string splitting.

## Affected Areas
- `src/dialogs.tsx` — Submenu sizes (`safeSetDialogSize(api, "xlarge")`), remove synthetic separators, update reasoning row titles.
- `src/catalog.ts` — Agent ordering: orchestrator alone, core SDD lifecycle order, JD, reviewers, auxiliaries.
- `src/dialogs.test.ts` — Update tests for sizing, non-focusable grouping, and copy.
- `src/catalog.test.ts` — Verify canonical group ordering and category derivation.

## Approaches & Tradeoffs

| Approach | Pros | Cons | Complexity |
|----------|------|------|------------|
| **A. Native OpenTUI Categories + "xlarge" Dialogs (Recommended)** | Eliminates focusable separator rows, leverages OpenTUI native grouping, maximizes visible viewport cleanly. | Requires updating existing separator unit tests in `dialogs.test.ts`. | Low |
| **B. Custom In-Dialog ASCII Dividers as Non-Selectable Headers** | Keeps visual lines inside dialog text. | Not supported natively by OpenTUI DialogSelect; requires synthetic options which inevitably receive focus. | High / Defective UX |

## Recommendation
Adopt Approach A: Set all rich agent submenus to `"xlarge"`, use native `category` attributes on options, remove synthetic separator items, and rename user-facing labels to `"Nivel de esfuerzo"`.

## Risks
- Regression on old unit tests that asserted `CATALOG_SEPARATOR_TOKEN` was present in `options`. (Remediated by updating tests in strict TDD fashion).
- External plugin reload during `global.config.update` triggering external logger warnings (isolated to external files).

## Questions for User Before Proposal
1. Should the reasoning submenu row title display only the agent name (e.g. `sdd-apply`) or include the current value inline (e.g. `sdd-apply: alto`)?
2. Should `model-audit` be included under the "Revisores" section or the "Auxiliares" section?
3. Are there any other specific dialog screens that should be upgraded to `"xlarge"` besides the primary, reasoning, fallback, and picker submenus?
