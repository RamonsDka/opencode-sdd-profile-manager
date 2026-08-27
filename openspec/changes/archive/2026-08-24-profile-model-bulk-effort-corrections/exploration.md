## Exploration: profile-model-bulk-effort-corrections

### Current State
1. **Orchestrator Model Selection & Persistence Bug**:
   - In `src/dialogs.tsx`, the profile dialog uses catalog key `sdd-ORCHETATOR`.
   - When a new model is selected, `stageProfileModelSelection` stages `{ agentName: "sdd-ORCHETATOR", modelId }`.
   - In `commitPendingModelSelection`, `nextProfile.models["sdd-ORCHETATOR"]` is set while existing alias keys (e.g. `sdd-orchestrator` or `gentle-orchestrator`) retain their prior values.
   - When `writeProfileData` invokes `canonicalizeProfileModels`, alias resolution checks `policy.aliasNames = ["sdd-orchestrator", "gentle-orchestrator", "sdd-ORCHETATOR"]`. Because `sdd-orchestrator` appears first and has the old model value, the new model assigned to `sdd-ORCHETATOR` is ignored and deleted.
   - In `createReasoningEffortPickerDialogProps`, the toast only reports `${agentName}: esfuerzo de razonamiento actualizado`, failing to indicate model update status and concealing the persistence failure.
2. **Bulk Actions (Acciones Masivas)**:
   - Bulk actions currently assign models without reasoning effort support.
   - `buildBulkProfileActionOptions` has overly verbose titles (e.g., `Asignar todas las fases primarias`) and unnecessary confirmation dialogs (`requiresConfirmation: true`) for override actions.
   - Bulk operations in `src/profiles.ts` (`applyBulkProfilePhaseAssignment` / `updateProfileWithBulkPhaseAssignment`) do not accept or persist a global reasoning effort level across affected primary phases.
3. **Profile Hub Section Grouping**:
   - In `buildProfileDetailHubOptions`, the option `"Versiones del perfil..."` has `category: "Agentes"`.
   - OpenTUI's `DialogSelect` groups items by category, rendering a lone `"Agentes"` header right above `"Versiones del perfil..."` in the hub.
   - Profile versioning provides critical undo/restore safety during bulk updates and manual edits; deleting the feature would harm usability. The category header should be corrected to `"Versiones anteriores del perfil"`.
4. **Active Changes Context**:
   - Active changes `streamline-agent-model-configuration` and `tui-profile-usability-and-activation-fix` are preserved without mutation. `profile-model-bulk-effort-corrections` is a separate delta focusing on orchestrator mutation, bulk effort flow, simplified labels, and hub category presentation.

### Affected Areas
- `src/orchestrator.ts` — Canonical orchestrator alias resolution and mutation helper to ensure orchestrator updates replace existing alias models properly.
- `src/profiles.ts` — Orchestrator key resolution in `stageProfileModelSelection` and `commitPendingModelSelection`; bulk assignment support for applying reasoning effort levels to assigned/overwritten primary phases.
- `src/dialogs.tsx` — Orchestrator alias handling in model selection and staging; sequential reasoning effort chaining for all bulk actions; removal of confirmation gates for override bulk actions; label simplification (`Asignar un modelo a todas las fases`); update toast messages to clearly reflect model and effort updates; update category for `"Versiones del perfil..."` to `"Versiones anteriores del perfil"`.
- `src/types.ts` — Types for bulk assignment operations, reasoning flows in bulk dialogs, and version metadata where applicable.
- `src/dialogs.test.ts` — Regression tests for orchestrator model and effort selection flow, bulk action labels, bulk effort chaining, and profile hub category headers.
- `src/profiles.test.ts` — Unit tests for orchestrator model persistence in `commitPendingModelSelection`, bulk phase assignment with reasoning effort, and version capture.
- `src/orchestrator.test.ts` — Unit tests for orchestrator mutation and alias replacement behavior.

### Approaches

1. **Integrated Canonical Resolution & Sequential Bulk Reasoning Flow (Recommended)**
   - Map `sdd-ORCHETATOR` and any orchestrator alias directly to `policy.canonicalName` upon staging/committing, clearing conflicting alias keys so `canonicalizeProfileModels` reliably persists the newly chosen model.
   - Update `createReasoningEffortPickerDialogProps` to display a comprehensive success toast indicating both model and reasoning effort updates when triggered from model selection.
   - Extend `showBulkProfileActions` to transition from model picker to a global reasoning effort picker for all bulk operations affecting primary agents, before executing `updateProfileWithBulkPhaseAssignment`.
   - Update bulk action definitions to remove `requiresConfirmation` and simplify labels (`Asignar un modelo a todas las fases`, `Sobrescribir todas las fases primarias`, etc.).
   - Change `buildProfileDetailHubOptions` category for `"Versiones del perfil..."` to `"Versiones anteriores del perfil"`.
   - *Pros*: Completely fixes the root cause, ensures end-to-end consistency between UI and disk storage, provides seamless UX for bulk actions with full reasoning support, preserves version restore safety net.
   - *Cons*: Requires updating both pure profile mutation logic and dialog flow state machines.
   - *Effort*: Medium

2. **UI-Only Workaround with Standalone Bulk Reasoning Step**
   - Translate `sdd-ORCHETATOR` to canonical runtime name only in `dialogs.tsx` without hardening `profiles.ts` or `orchestrator.ts`.
   - Add a separate submenu item for bulk reasoning effort rather than chaining it directly into the bulk action dialog flow.
   - Delete the profile versions section entirely to remove the `"Agentes"` header.
   - *Pros*: Smaller diff in dialog handlers.
   - *Cons*: Fragile; leaves backend `commitPendingModelSelection` vulnerable to alias shadowing bugs; forces users to navigate two separate dialog menus for a single bulk change; loses profile version rollback capability.
   - *Effort*: Low

### Recommendation
Adopt **Approach 1**. Hardening orchestrator alias resolution in both `profiles.ts` and `orchestrator.ts` ensures that model changes for `sdd-ORCHETATOR` persist under all runtime configurations. Chaining reasoning effort selection sequentially in bulk actions delivers the requested single-pass bulk configuration experience, while fixing the `"Versiones anteriores del perfil"` header preserves essential rollback functionality with clean UI hierarchy.

### Risks
- **Orchestrator Policy Precedence**: When updating an orchestrator model, old alias entries must be pruned cleanly so legacy migration rules do not resurrect obsolete model IDs. (Mitigation: cover with explicit orchestrator policy unit tests in `src/orchestrator.test.ts`).
- **Bulk Reasoning Model Compatibility**: Applying reasoning effort across all primary phases in bulk must handle models that lack reasoning variants gracefully (e.g. defaulting to `provider-default` or pruning incompatible effort values via existing `pruneProfileReasoningEffort`). (Mitigation: test bulk assignments against reasoning-enabled and non-reasoning providers in `src/profiles.test.ts`).
- **Dialog Navigation State**: Chaining model selection into reasoning effort picker for bulk actions must handle cancel/back navigation cleanly without leaving partial mutations. (Mitigation: verify back button flow in `src/dialogs.test.ts`).

### Ready for Proposal
Yes — the root cause of the orchestrator bug is fully proven, bulk action requirements and label updates are clearly specified, the profile versions header fix is verified, and the change is ready for the proposal phase.
