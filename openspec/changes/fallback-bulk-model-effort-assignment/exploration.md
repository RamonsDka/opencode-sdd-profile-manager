# Exploration: Fallback Bulk Model and Effort Assignment

## Current State

The OpenCode TUI plugin currently provides a single profile-wide bulk configuration action in `src/dialogs.tsx`: `"Asignar un modelo y esfuerzo a todos los agentes"` (`bulk:assign-model-and-effort`). This action:
1. Prompts the operator for a provider, model, and reasoning effort.
2. Collects configurable primary targets using `collectConfigurableProfileTargets(config)` from `src/catalog.ts`.
3. Calls `updateProfileWithBulkOverwrite` from `src/profiles.ts`, which runs `buildBulkProfileOverwrite` to atomically overwrite `profile.models` and `profile.configs` for all primary agents, capturing an atomic profile snapshot version (`ProfileVersion` with `target: "primary"`, `mode: "overwrite"`).
4. Displays a combined toast confirming the number of primary agents updated with the selected model and reasoning effort.

In contrast, fallback agents:
- Are managed via the fallback submenu (`"Modelos fallback..."`), allowing only single-agent manual configuration where selecting a model immediately commits to `profile.fallback[baseAgentName]` without a reasoning effort prompt.
- Have no dedicated or visible bulk assignment action in `src/dialogs.tsx` (`buildBulkProfileActionOptions()` returns an array with only 1 action).
- Store models in `profile.fallback: Record<string, string>` keyed by the base primary agent name (e.g., `"sdd-apply": "openai/gpt-4.1"`).
- Currently do not persist reasoning effort in `profile.configs` (where `normalizeProfileConfigs` drops keys ending in `-fallback`, and `applyProfileReasoningEffort` strips `reasoningEffort` from `-fallback` runtime agents).
- The underlying `src/profiles.ts` already defines `BULK_ASSIGNMENT_TARGET.FALLBACK = "fallback"` in `types.ts` and legacy `applyBulkProfilePhaseAssignment`, but the modern snapshot-backed pure overwrite engine (`buildBulkProfileOverwrite` / `updateProfileWithBulkOverwrite`) hardcodes primary model targeting (`target.field !== "model"` filter and mutating `profile.models`).

## Affected Areas

- `src/types.ts`:
  - Extend `ConfigurableProfileTarget` / `BulkAssignmentOperation` types if needed to distinguish primary vs fallback bulk targets cleanly.
  - Retain `BULK_ASSIGNMENT_TARGET.FALLBACK` and `BULK_ASSIGNMENT_MODE.OVERWRITE`.
- `src/catalog.ts`:
  - Enhance `collectConfigurableProfileTargets(config, target?: "primary" | "fallback")` or introduce `collectConfigurableFallbackTargets(config)` to project the 19 canonical fallbacks + runtime fallback entries into configurable targets.
- `src/profiles.ts`:
  - Generalize `buildBulkProfileOverwrite` to support updating `profile.fallback` when target is `fallback`, recording `modelsAssigned`/`fallbackAssigned` cleanly.
  - Generalize `updateProfileWithBulkOverwrite` to accept the target operation (`BULK_ASSIGNMENT_TARGET.FALLBACK`), recording `ProfileVersion` with `target: "fallback"`.
- `src/dialogs.tsx`:
  - Update `buildBulkProfileActionOptions()` to expose the second visible option: `"Asignar un modelo y esfuerzo a todos los agentes fallback"` (`bulk:assign-fallback-model-and-effort`).
  - Update `showBulkProfileActions`, `showProviderPickerForBulkProfilePhases`, `createBulkModelPickerDialogProps`, `createBulkModelSelectionHandler`, and `createBulkReasoningEffortPickerDialogProps` to route fallback bulk selections through provider -> model -> effort flow.
  - Provide combined toast messaging tailored to fallback agents (e.g., `"${totalAssigned} agentes fallback configurados con ${modelId} y esfuerzo ${effort}. Versión guardada."`).
- `src/catalog.test.ts`:
  - Add tests for fallback target projection and eligibility filtering.
- `src/profiles.test.ts`:
  - Add unit tests for `buildBulkProfileOverwrite` with fallback targets and `updateProfileWithBulkOverwrite` creating fallback version snapshots.
- `src/dialogs.test.ts`:
  - Add tests verifying the 2 visible bulk actions in `buildBulkProfileActionOptions()`, fallback bulk sequencing, atomic cancellation, and toast feedback.
- `src/profile-reasoning.test.ts`:
  - Verify that fallback bulk assignment maintains reasoning compatibility and does not corrupt primary reasoning configurations.

## Approaches

### 1. Unified Parameterized Bulk Overwrite Engine (Recommended)
Generalize the pure overwrite pipeline (`collectConfigurableProfileTargets`, `buildBulkProfileOverwrite`, `updateProfileWithBulkOverwrite`) by parameterizing the operation target (`"primary" | "fallback"`).
- **Pros**:
  - Zero logic duplication: reuses the exact same snapshot versioning, provider validation, reasoning effort resolution, and atomic write transactions.
  - Symmetrical architecture: primary and fallback bulk flows share identical structural contracts and test patterns.
  - Strictly preserves existing primary bulk behavior and tests without regression.
- **Cons**:
  - Requires updating signatures of internal bulk helpers in `src/profiles.ts` and `src/catalog.ts` (with backward-compatible defaults).
- **Effort**: Low (estimated ~120-160 production LoC, ~150 test LoC).

### 2. Parallel Dedicated Fallback Bulk Overwrite Engine
Create parallel standalone functions: `collectConfigurableFallbackTargets`, `buildBulkFallbackProfileOverwrite`, and `updateProfileWithBulkFallbackOverwrite`.
- **Pros**:
  - Completely isolates fallback code from primary functions.
- **Cons**:
  - High duplication of version creation, snapshot reading, JSON atomic persistence, and reasoning resolution logic (~100+ duplicated lines).
  - Increased maintenance burden and dual bug surface.
- **Effort**: Medium.

### 3. Re-use Legacy Phase Assignment Engine
Route the fallback bulk action through legacy `updateProfileWithBulkPhaseAssignment(profilePath, primarySddAgentNames, modelId, { target: "fallback", mode: "overwrite" })`.
- **Pros**:
  - Legacy function already mutates `profile.fallback`.
- **Cons**:
  - Bypasses modern reasoning effort resolution (`resolveBulkReasoningEffort`).
  - Lacks runtime inventory discovery for dynamic custom fallback agents.
  - Mismatches modern `updateProfileWithBulkOverwrite` snapshot contract.
- **Effort**: Low to Medium (technical debt accumulation).

## Key Inquiries & Evidence Analysis

### 1. Concept of "Fallback Agent" in Current Architecture
- **Naming & Runtime Convention**: Agents ending with the suffix `-fallback` (e.g. `sdd-apply-fallback`, `jd-judge-a-fallback`, `review-risk-fallback`).
- **Profile Storage**: Stored under `profile.fallback: Record<string, string>` mapping the *base primary agent name* to the assigned model ID (e.g. `{ "sdd-apply": "openai/gpt-4.1" }`).
- **Catalog Classification**: Categorized under `family: "Fallbacks"` in `src/catalog.ts`.
- **19 Canonical Base Fallbacks** (`CANONICAL_FALLBACK_ORDER` in `catalog.ts`):
  `jd-fix-agent-fallback`, `jd-judge-a-fallback`, `jd-judge-b-fallback`, `review-readability-fallback`, `review-refuter-fallback`, `review-reliability-fallback`, `review-resilience-fallback`, `review-risk-fallback`, `review-validator-fallback`, `sdd-apply-fallback`, `sdd-archive-fallback`, `sdd-design-fallback`, `sdd-explore-fallback`, `sdd-init-fallback`, `sdd-onboard-fallback`, `sdd-propose-fallback`, `sdd-spec-fallback`, `sdd-tasks-fallback`, `sdd-verify-fallback`.
- **Dynamic Fallbacks**: Custom runtime agents ending with `-fallback` are recognized if their base name is valid; however, by the `agent-catalog-parity` specification, fallback synthesis is gated to explicit declarations in `profile.fallback`.

### 2. Configurable / Visible vs Excluded Agents
- **Eligible & Configurable**:
  - All 19 canonical fallbacks (`isFallbackEligibleSddAgent(baseName) === true`).
  - Valid custom runtime fallbacks whose base primary agent is editable.
- **Strictly Excluded**:
  - Orchestrators: `gentle-orchestrator`, `sdd-orchestrator`, `sdd-ORCHETATOR` (in `FALLBACK_INELIGIBLE_AGENTS`).
  - Tools / Non-managed primaries: `model-audit` (in `FALLBACK_INELIGIBLE_AGENTS` & `MANAGED_SDD_AGENT_EXCEPTIONS`).
  - Internal auxiliary engine entries: `compaction`, `summary`, `title` (in `FALLBACK_EXCLUDED_CATALOG_KEYS` & `RESERVED_RUNTIME_AGENT_NAMES`).
  - Any orphan fallback without a valid base primary key (`deriveFallbackProfileKey` returns `null`).

### 3. Reasoning Effort Storage for Fallbacks
- **Exact Current Form**:
  - Persisted `ProfileData` contains:
    - `models`: `Record<string, string>` (primary models).
    - `fallback`: `Record<string, string>` (fallback models keyed by base name).
    - `configs`: `Record<string, { reasoningEffort?: string }>` (keyed strictly by primary agent names).
  - In `src/profile-reasoning.ts`, `normalizeProfileConfigs` drops keys ending in `-fallback`, and `applyProfileReasoningEffort` actively clears `reasoningEffort` on `-fallback` runtime agents.
  - In individual fallback selection (`src/dialogs.tsx`), selecting a fallback model commits immediately without prompting for reasoning effort.
- **Bulk Flow Behavior**:
  - The bulk fallback action prompts for model and reasoning effort for UX symmetry and explicit operator intent.
  - Models without reasoning support default to `provider-default` / `Predeterminado`.
  - Persisting fallback bulk updates `profile.fallback` atomically without corrupting `profile.configs` or triggering runtime configuration validation errors.

### 4. Engine Generalization vs Parallel Transaction
- `collectConfigurableProfileTargets(config, target)`:
  - When `target === "primary"` (default): filters `classification === "primary" && field === "model"`.
  - When `target === "fallback"`: filters eligible fallback items (`field === "fallback"` or canonical 19 + dynamic fallbacks).
- `buildBulkProfileOverwrite(profile, targets, modelId, effortSelection, context, policy, targetType)`:
  - Mutates `nextFallback` when targeting fallback, updating `profile.fallback`, and computing `changed` based on `nextFallback` differences.
- `updateProfileWithBulkOverwrite(profilePath, targets, modelId, effortSelection, context, policy, targetType)`:
  - Invokes `createProfileVersion` with `operation: { target: BULK_ASSIGNMENT_TARGET.FALLBACK, mode: BULK_ASSIGNMENT_MODE.OVERWRITE }` and summary `"Override N configurable fallback agents"`.
  - Persists atomic change via `persistVersionedProfileMutation`.

### 5. Provider-Default, Pruning, and Reasoning Compatibility
- If the chosen fallback model lacks custom reasoning effort tiers (e.g. `anthropic/claude-3-5-sonnet`), `resolveBulkReasoningEffort` resolves `"provider-default"`.
- Because fallback entries do not store reasoning effort in `profile.configs`, primary `profile.configs` are left intact.
- If the model supports reasoning (e.g. `openai/o3-mini`), the effort prompt allows selecting `high`, `medium`, `low`, etc., ensuring consistent operator experience.

### 6. Existing Individual Fallback Flow & Protection
- Individual fallback selection lives in `src/dialogs.tsx`:
  - `showProfileDetailSubmenuFallback` -> `showProviderPickerForAgent(..., "fallback", "fallback")` -> `createModelPickerDialogProps` -> `commitPendingModelSelection`.
- Tests protecting this flow in `src/dialogs.test.ts`, `src/profiles.test.ts`, and `src/catalog.test.ts` must remain green (baseline: 376 tests).

### 7. UX & Transactional Guarantees
- **Single Snapshot**: Creates exactly one `ProfileVersion` before write.
- **Combined Toast**: Single toast with title `Actualizado` (or `Sin cambios`), message containing count, modelId, and effort label, and variant `success` (or `warning`).
- **Atomic Cancellation**: Cancelling at Provider, Model, or Effort picker produces zero mutations and returns safely to the parent view.
- **No Extra Confirmations**: Proceeds directly from Effort selection to atomic write and toast feedback.

### 8. Regression Test Mapping & Blast Radius
- `src/catalog.test.ts`: Target extraction for primary vs fallback.
- `src/profiles.test.ts`: Pure overwrite build, snapshot creation, and write transactions for fallback bulk operations.
- `src/dialogs.test.ts`: Menu options (2 visible bulk actions), flow routing, toast formatting, and cancel-safety.
- `src/profile-reasoning.test.ts`: Non-interference with primary configs.
- **Line Count & Budget**: Estimated ~140 lines of production code and ~180 lines of test code (well below the 400-line budget, no chaining required).

## Recommendation

Implement **Approach 1: Unified Parameterized Bulk Overwrite Engine**.
1. Add the second action to `buildBulkProfileActionOptions()` in `src/dialogs.tsx`:
   `{ title: "Asignar un modelo y esfuerzo a todos los agentes fallback", value: "bulk:assign-fallback-model-and-effort" }`.
2. Generalize `collectConfigurableProfileTargets` in `src/catalog.ts` to support fallback target collection.
3. Generalize `buildBulkProfileOverwrite` and `updateProfileWithBulkOverwrite` in `src/profiles.ts` to support `BULK_ASSIGNMENT_TARGET.FALLBACK`.
4. Wire the unified provider -> model -> effort dialog sequence in `src/dialogs.tsx` with dedicated fallback feedback.

## Risks

- **Risk 1: Runtime Config Interference**: Ensure fallback bulk updates do not write invalid keys into `profile.configs` that could fail runtime sync.
  - *Mitigation*: Fallback bulk assignments write strictly to `profile.fallback`, leaving `profile.configs` clean.
- **Risk 2: Primary Bulk Regression**: Ensure primary bulk action and individual fallback selection flows remain completely unchanged.
  - *Mitigation*: Strict TDD with regression assertion against all 376 baseline tests.

## Ready for Proposal

**Yes**. The investigation is complete with exact code paths, architectural models, UX flows, and testing strategies identified. The orchestrator can now advance to the proposal phase (`sdd-propose`).
