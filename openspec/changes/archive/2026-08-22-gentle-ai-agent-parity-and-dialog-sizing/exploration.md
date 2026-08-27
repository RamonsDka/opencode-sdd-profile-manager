# Exploration: Gentle AI Agent Parity and Dialog Sizing

## Executive Summary
This exploration investigates how to update `opencode-sdd-engram-manage` to achieve 100% parity with the full Gentle AI 2.4.0 agent catalog (40 agents: 21 primary and 19 fallbacks) and enlarge the dialog windows (specifically profile detail, model pickers, and memory views) using OpenCode/OpenTUI native dialog APIs.

---

## Current State

### 1. Agent Discovery and Classification
- **Prefixes and Exceptions (`src/utils.ts`)**:
  - `MANAGED_AGENT_PREFIXES = ["sdd-", "review-", "jd-"]`
  - `MANAGED_SDD_AGENT_EXCEPTIONS = new Set(["gentle-orchestrator"])`
  - `FALLBACK_INELIGIBLE_AGENTS = new Set(["sdd-orchestrator", "gentle-orchestrator"])`
- **Supported vs Missing Agents**:
  - Most SDD (`sdd-*`), Review (`review-*`), and Judgment Day (`jd-*`) agents match prefix rules and are already recognized.
  - `model-audit` does **not** match prefix rules and is currently missing from `MANAGED_SDD_AGENT_EXCEPTIONS`, causing it to be filtered out of `isManagedSddAgent`, `extractSddAgentModels`, and `buildProfileDetailAgentSections`.
  - All other 39 requested agents match prefix rules or existing orchestrator exceptions:
    - 21 Primary: `gentle-orchestrator`, `sdd-init`, `sdd-explore`, `sdd-propose`, `sdd-spec`, `sdd-design`, `sdd-tasks`, `sdd-apply`, `sdd-verify`, `sdd-archive`, `sdd-onboard`, `jd-judge-a`, `jd-judge-b`, `jd-fix-agent`, `review-risk`, `review-readability`, `review-reliability`, `review-resilience`, `review-refuter`, `review-validator`, `model-audit`.
    - 19 Fallbacks: `jd-fix-agent-fallback`, `jd-judge-a-fallback`, `jd-judge-b-fallback`, `review-readability-fallback`, `review-refuter-fallback`, `review-reliability-fallback`, `review-resilience-fallback`, `review-risk-fallback`, `review-validator-fallback`, `sdd-apply-fallback`, `sdd-archive-fallback`, `sdd-design-fallback`, `sdd-explore-fallback`, `sdd-init-fallback`, `sdd-onboard-fallback`, `sdd-propose-fallback`, `sdd-spec-fallback`, `sdd-tasks-fallback`, `sdd-verify-fallback`.

### 2. Dialog Sizing and UI
- **Host Dialog API (`@opencode-ai/plugin/tui`)**:
  - `api.ui.dialog.setSize(size: "medium" | "large" | "xlarge")` is supported by OpenCode TUI to resize modal dialog containers.
  - The plugin currently **never** calls `api.ui.dialog.setSize`, defaulting entirely to `"medium"`.
  - In `"medium"`, long model identifiers (e.g., `cliproxyapi/google-7/gemini-3.7-flash-high (1M ctx)`), 21+ agent rows, and Engram memory content get horizontally truncated or cramped.
  - In `showMemoryDetail`, text wrapping is hardcoded to 52 characters (`wrapDisplayText(line, 52)`).

---

## Affected Areas

| File | Purpose / Impact |
|---|---|
| `src/utils.ts` | Add `model-audit` to `MANAGED_SDD_AGENT_EXCEPTIONS` and `FALLBACK_INELIGIBLE_AGENTS`. |
| `src/types.ts` | Ensure typing covers extended catalog and optional dialog sizing configurations if needed. |
| `src/profiles.ts` | Profile extraction, normalization, fallback syncing (`syncSddFallbackAgents`), and validation for the complete catalog. |
| `src/dialogs.tsx` | Invoke `api.ui.dialog.setSize` (`"large"` / `"xlarge"`) for heavy screens (Profile Detail, Submenus, Model Pickers, Versions, Memories) and retain `"medium"` for small prompts/confirms. Widen `wrapDisplayText` in memory detail. |
| `src/host-compat.ts` | Add `safeSetDialogSize` helper to guard against host environments lacking `setSize`. |
| `src/utils.test.ts` | Test `model-audit` classification across `isManagedSddAgent`, `isPrimarySddAgent`, and `isFallbackEligibleSddAgent`. |
| `src/profiles.test.ts` | Test extraction, bulk assignment, and fallback syncing for all 40 agents. |
| `src/dialogs.test.ts` | Test dialog sizing calls, submenu generation, and detail row building with 40 agents. |

---

## Approaches

### Agent Catalog Strategy

| Approach | Description | Pros | Cons | Complexity |
|---|---|---|---|---|
| **1. Pure Dynamic (Config Discovery)** | Sourced strictly from `Object.keys(api.state.config.agent)` filtered by prefix + exceptions. | Adapts automatically to custom agents in `opencode.json`. Zero hardcoded list. | If an agent is missing from local config, it won't appear in the UI. | Low |
| **2. Pure Static List** | Hardcode exact 40 agent names in a fixed array. | Predictable, always shows all 40 agents. | Inflexible, cannot discover user-defined or future `sdd-*` agents. | Low |
| **3. Hybrid (Dynamic Config + Seed/Profile Union)** *(Recommended)* | Dynamic prefix matching (`sdd-*`, `review-*`, `jd-*`) + exceptions (`gentle-orchestrator`, `model-audit`), unioned with active profile entries. | Full parity with Gentle AI 2.4.0, extensible for future agents, preserves profile portability, safe fallback exclusion. | Requires clear union and deduplication logic. | Medium |

### Dialog Sizing Strategy

| Approach | Description | Pros | Cons | Complexity |
|---|---|---|---|---|
| **1. Global Resize** | Set `api.ui.dialog.setSize("large")` everywhere. | Simple one-line change. | Small confirmation boxes and single-input prompts look unnecessarily wide and sparse. | Low |
| **2. Screen-Aware Tiered Sizing** *(Recommended)* | Use `"xlarge"` for Profile Detail, Model Pickers, and Memory Detail; `"large"` for Submenus, Bulk Actions, and Versions; `"medium"` for Prompts/Confirms. | Optimal visual hierarchy, maximizes space where lists and long strings exist while keeping modals focused. | Requires calling `safeSetDialogSize` per dialog view. | Low |

---

## Recommendation

1. **Adopt Hybrid Catalog (Approach 3)**:
   - Include `model-audit` in `MANAGED_SDD_AGENT_EXCEPTIONS` and `FALLBACK_INELIGIBLE_AGENTS`.
   - Maintain dynamic prefix discovery (`sdd-`, `review-`, `jd-`) so future agents are automatically managed.
   - Union runtime config keys with profile data keys in `buildProfileDetailAgentSections`.
2. **Adopt Screen-Aware Sizing (Approach 2)**:
   - Add a defensive `safeSetDialogSize(api, size)` utility in `src/host-compat.ts`.
   - Apply `"xlarge"` (or `"large"`) to:
     - Profile Detail Hub (`showProfileDetail`)
     - Model Pickers (`showModelPickerForAgent`, `showModelPickerForBulkProfilePhases`)
     - Memory Detail (`showMemoryDetail`, adjusting line wrap from 52 to 80+ chars)
   - Apply `"large"` to:
     - Primary, Fallback, and Reasoning Submenus
     - Bulk Actions Menu (`showBulkProfileActions`)
     - Profile Version List & Preview (`showProfileVersions`, `showProfileVersionPreview`)
     - Project Memories Menu (`showProjectMemoriesMenu`)
   - Keep `"medium"` for Prompts and Confirmations (`showCreateProfile`, `showRenameProfile`, `showDeleteProfile`, etc.).

---

## Strict TDD Test Plan

1. **Seam 1: Catalog Classification & Fallback Safety (`src/utils.test.ts`, `src/profiles.test.ts`)**
   - RED: `isManagedSddAgent("model-audit")` -> `true`.
   - RED: `isPrimarySddAgent("model-audit")` -> `true`.
   - RED: `isFallbackEligibleSddAgent("model-audit")` -> `false`.
   - RED: Validate all 21 primary agents are recognized as primary.
   - RED: Validate all 19 fallback agents are recognized as fallbacks and not primaries.
   - RED: `syncSddFallbackAgents` reconciles all 19 fallbacks and never creates `model-audit-fallback`.
2. **Seam 2: Dialog Sizing & Text Wrap (`src/dialogs.test.ts`, `src/host-compat.test.ts`)**
   - RED: Verify `setSize("xlarge")` / `setSize("large")` is called for data-heavy screens.
   - RED: Verify `setSize("medium")` is retained/reset for confirmation dialogs.
   - RED: Verify safe degradation when `api.ui.dialog.setSize` is unavailable.
   - RED: Verify `wrapDisplayText` in memory detail accommodates wider screens.
3. **Seam 3: Profile Portability & Backward Compatibility (`src/profiles.test.ts`)**
   - RED: Read/write profiles with `model-audit` without corruption or data loss.
   - RED: Legacy profiles without `model-audit` load and migrate cleanly.

---

## Risks

1. **Terminal Viewport Constraints**: On very narrow terminal windows (<80 columns), `"xlarge"` may reach host clipping limits. OpenCode's native dialog stack handles minimum clamping, but tests should verify safe rendering.
2. **Host API Absence**: Older OpenCode host versions may lack `api.ui.dialog.setSize`. A defensive `safeSetDialogSize` wrapper avoids crashes.
3. **List Length in Profile Detail**: 21 primary agent items increase scroll length. Native `DialogSelect` filtering and submenus mitigate this.

---

## Ready for Proposal
**Yes.** The architecture, exact catalog delta, dialog sizing APIs, and TDD seams are fully verified against the codebase and live OpenCode runtime.
