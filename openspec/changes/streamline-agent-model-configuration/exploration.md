## Exploration: Streamline Agent Model and Reasoning Effort Configuration

### Executive Summary
This exploration investigates the architecture and UX streamlining of the agent catalog and model assignment flow in `plugin-asig-subagentes`. Specifically:
1. Guaranteeing strict separation between Primary models and Fallback models, preventing any fallback agent (including unknown/custom ones ending with `-fallback`) from appearing on the Profile Detail hub or Primary Models menu.
2. Automating runtime agent catalog discovery directly from `api.state.config.agent` (the merged effective configuration), using known role order strictly for presentation rather than forcing a 40-entry static inventory.
3. Filtering out non-editable OpenCode/worker internal roles (`build`, `plan`, `general`, `explore`, `compaction`, `summary`, `title`, `gentle-reviewer`, `gentle-worker`, `sdd-orchestrator`).
4. Creating a seamless sequential flow: Agent -> Provider -> Model -> Reasoning Effort Picker (if supported by model metadata), with cancellation semantics where canceling effort retains the model without explicit reasoning effort (provider default).
5. Automatic cleanup of incompatible previously saved reasoning efforts upon switching models.
6. Enabling reasoning effort eligibility for discovered custom primary agents while maintaining lossless preservation of profiles with non-runtime agents.

---

### Current State

1. **Agent Catalog & Presentation Order (`src/catalog.ts`)**:
   - Currently, `BASE_CANONICAL_ORDER` forces 40 static entries (21 primaries + 19 fallbacks) into the catalog even if `config.agent` is empty or missing those agents.
   - Fallback detection in `deriveFallbackProfileKey` only checks if the prefix belongs to `isFallbackEligibleSddAgent` (which only checks prefixes `sdd-`, `review-`, `jd-`). An unknown runtime agent named `custom-fallback` or `tester-fallback` returns `null`, causing `isFallback` to be `false`, which leads `classifyFamily` to place it into the `Custom` family in the Primary Models view.

2. **Profile Detail Hub & Navigation (`src/dialogs.tsx`)**:
   - `showProfileDetail` renders the Profile Hub options: Name, Bulk Actions, the primary agents list, Reasoning effort submenu, Fallback models submenu, Profile versions, and actions.
   - In `showModelPickerForAgent`, picking a model persists it and immediately returns to the caller target (`hub` or `primary`), requiring the user to navigate to a separate "Reasoning effort..." submenu to configure reasoning effort.

3. **Reasoning State & Compatibility (`src/profile-reasoning.ts`)**:
   - `buildReasoningEditState` inspects provider metadata for `capabilities.reasoning === true` and variant efforts.
   - `normalizeProfileConfigs` only permits managed SDD primary agents (`isPrimarySddAgent`), ignoring custom primary agents.
   - Incompatible saved reasoning efforts are pruned only during profile activation (`applyProfileReasoningEffort`), not during model selection in `updateProfilePhaseModel`.

4. **Profile Versioning & Persistence (`src/profiles.ts`)**:
   - `updateProfilePhaseModel` generates a dated `ProfileVersion` before writing the updated model.
   - `writeProfileData` writes `models`, `fallback`, and `configs`.

---

### Affected Areas

- `src/catalog.ts` — Replace static inventory forcing with dynamic inventory from `config.agent`. Implement strict fallback detection (`*-fallback` suffix) and denylist filtering.
- `src/utils.ts` — Generalize fallback and primary agent checks to recognize custom agents and enforce the denylist.
- `src/profile-reasoning.ts` — Support custom primary agents for reasoning effort; provide helper to validate/prune incompatible efforts when changing models.
- `src/dialogs.tsx` — Implement sequential Model -> Reasoning flow in `updateAgentModel` / `showModelPickerForAgent`; implement cancellation semantics; ensure Primary view never renders fallbacks.
- `src/profiles.ts` — Ensure `updateProfilePhaseModel` prunes incompatible reasoning effort and handles single version snapshot cleanly.
- `src/catalog.test.ts`, `src/dialogs.test.ts`, `src/profile-reasoning.test.ts`, `src/profiles.test.ts` — Update and add RED seams for dynamic discovery, strict fallback guard, sequential picker, and cancellation semantics.

---

### Key Architectural & UX Decisions

#### 1. Dynamic Catalog Inventory with Presentation Order
- **Inventory Source**: `api.state.config.agent` represents the effective runtime configuration.
- **Known Presentation Order**: The 20 Gentle AI 2.4.0 managed static roles + `model-audit` define standard display order and family groupings (`Orchestrator > SDD > JD > Review > Tools`).
  - Orchestrator: `gentle-orchestrator`
  - SDD: `sdd-init`, `sdd-explore`, `sdd-propose`, `sdd-spec`, `sdd-design`, `sdd-tasks`, `sdd-apply`, `sdd-verify`, `sdd-archive`, `sdd-onboard` (10)
  - JD: `jd-judge-a`, `jd-judge-b`, `jd-fix-agent` (3)
  - Review: `review-risk`, `review-readability`, `review-reliability`, `review-resilience`, `review-refuter`, `review-validator` (6)
  - Tools: `model-audit` (if present in config)
- **Denylist**: `build`, `plan`, `general`, `explore`, `compaction`, `summary`, `title`, `gentle-reviewer`, `gentle-worker`, `sdd-orchestrator`. Any role matching this set is excluded from the catalog and UI dialogs.
- **Discovered Agents**: Discovered agents not in the denylist and not ending in `-fallback` are classified as `Custom` (in Primary Models). Discovered agents ending in `-fallback` are classified as `Fallbacks` (in Fallback Models).

#### 2. Strict Fallback Guard
- Any key matching `*-fallback` is strictly classified under `isFallback: true` and mapped to family `Fallbacks`.
- Under no circumstances can a `*-fallback` agent be classified as `Custom` or rendered under Primary Models or the Profile Detail Hub primary list.

#### 3. Sequential Model -> Reasoning Flow
- When a user selects a model for a primary agent (from Hub or Primary Models submenu):
  1. Update/stage the model assignment.
  2. Evaluate reasoning capability of the selected model using `buildReasoningEditState`.
  3. Clean up previously saved reasoning effort if incompatible with the new model or if the new model lacks reasoning support.
  4. If the new model does NOT support reasoning:
     - Persist profile and version.
     - Toast: `"<agent> set to <modelId>. Version saved."`
     - Return to `returnTarget` (`hub` or `primary`).
  5. If the new model SUPPORTS reasoning:
     - Persist model assignment.
     - Immediately launch `showReasoningEffortPicker` with a sequential flow flag and `returnTarget`.
     - User selects effort: Save effort to `profile.configs[agent]`, toast confirmation, return to `returnTarget`.
     - User selects Back / Cancel: The model remains saved with no explicit effort (provider default), toast confirmation, return to `returnTarget`.
- The standalone "Reasoning effort..." submenu remains on the Hub for direct adjustments without model re-selection.

#### 4. Bulk Action Behavior
- Bulk actions (`Set all primary phases`, etc.) set models without triggering interactive reasoning prompts for each agent.
- Incompatible reasoning efforts across affected agents are pruned cleanly.

#### 5. Profile Lossless Round-Trip
- If an existing profile contains models/fallbacks for agents not present in the active `config.agent`, `readProfileData` and `writeProfileData` preserve those keys losslessly.
- They are omitted from the active UI view because they do not exist in the current runtime environment.

---

### Approaches Comparison

| Approach | Description | Pros | Cons | Complexity |
|---|---|---|---|---|
| **Option A: Pure UI-level Chaining & Strict Regex Guards (Recommended)** | Keep `updateProfilePhaseModel` atomic for model updates; chain dialog navigation in `dialogs.tsx` upon model selection; prune incompatible effort in `updateProfilePhaseModel`; generalize `isFallback` to check `-fallback` suffix across all agents. | Minimal surface area, preserves existing versioning schema, clean cancellation semantics, fully backward compatible. | None identified. | Low-Medium |
| **Option B: Combined Multi-Field Transaction Function** | Introduce a combined `updateProfilePhaseModelAndReasoning` function that accepts both model and optional reasoning effort in a single version creation. | Creates a single version entry even when effort is chosen. | Requires breaking or duplicating `updateProfilePhaseModel` signature; complicates cancellation and interactive UI states. | Medium |

---

### Recommendation

Adopt **Option A**:
1. Update `src/catalog.ts` and `src/utils.ts` to derive active catalog entries from `config.agent` filtered by the denylist, with strict fallback identification.
2. In `src/profiles.ts`, enhance `updateProfilePhaseModel` to prune incompatible reasoning efforts when the model changes.
3. In `src/dialogs.tsx`, chain `showModelPickerForAgent` -> `showReasoningEffortPicker` when the model supports reasoning, with cancel semantics returning to the target screen while keeping the model saved.
4. Expand `src/profile-reasoning.ts` to support discovered custom primary agents.

---

### Risks & Mitigations

1. **Risk**: Existing unit tests assert that `BASE_CANONICAL_ORDER` has 40 entries and that empty `config.agent` generates 40 catalog entries.
   - **Mitigation**: Update tests to reflect the new dynamic inventory contract: inventory is sourced from `config.agent` and ordered via the presentation order map.
2. **Risk**: Rapid navigation or cancellation leaving half-written state.
   - **Mitigation**: Model is persisted first (with clean incompatible effort removal). Canceling the reasoning picker simply leaves the model saved with provider-default reasoning effort.

---

### Test Seams (Strict TDD)

1. **`src/catalog.test.ts`**:
   - Verify dynamic discovery: empty `config.agent` produces 0 entries; populated `config.agent` produces exact active entries.
   - Verify fallback guard: `unknown-fallback` is placed in `Fallbacks`, never `Custom` or Primary.
   - Verify denylist: `build`, `plan`, `compaction`, `gentle-reviewer`, etc., are excluded.
2. **`src/profile-reasoning.test.ts`**:
   - Verify custom primary agents are accepted in `normalizeProfileConfigs` and `updateProfileReasoningEffort`.
   - Verify pruning of incompatible reasoning effort when model changes.
3. **`src/dialogs.test.ts`**:
   - Verify sequential transition to `showReasoningEffortPicker` when reasoning-supported model is picked.
   - Verify direct return when unsupported model is picked.
   - Verify cancellation in reasoning picker preserves model assignment.
4. **`src/profiles.test.ts`**:
   - Verify lossless round-trip for profiles containing non-runtime agents.

---

### Ready for Proposal
**Yes**. The architectural boundaries, UX flows, cancellation semantics, and TDD seams are fully specified and ready for the `sdd-propose` phase.
