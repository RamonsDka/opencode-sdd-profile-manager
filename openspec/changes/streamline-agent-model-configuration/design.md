# Design: Streamline Agent Model Configuration

## Technical Approach

Replace the catalog’s static union with a classified runtime inventory from `api.state.config.agent`. Keep profile JSON lossless, but restrict UI candidates to runtime entries. Model assignment becomes a two-stage primary flow: one transactional model/version write, then an optional snapshot-free effort write. Bulk remains one non-interactive transaction.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|---|---|---|
| Runtime inventory; known-role metadata only orders/classifies | Static `BASE_CANONICAL_ORDER` union | Runtime config is authoritative; absent known roles are omitted. |
| Strict suffix classification before prefixes/custom | Managed-prefix fallback detection | Every valid `*-fallback` is isolated even when its primary is custom or absent. |
| Separate editable-primary from managed/fallback eligibility | Loosen `isPrimarySddAgent` globally | Custom models/configs persist and apply without becoming SDD-managed or fallback-eligible. |
| Model transaction owns one pre-change snapshot | Snapshot model and effort separately | Preserves current rollback semantics and avoids duplicate history. |
| Clear explicit effort during interactive model write | Temporarily retain compatible effort | Cancel and effort-write failure safely leave provider-default effort. Bulk alone retains compatible effort. |

## Data Flow

```text
config.agent -> collect -> classify(reserved -> fallback suffix -> known/custom) -> order -> UI
model choice -> model transaction(snapshot + prune/clear + profile write)
  -> fallback/unsupported: return
  -> supported: post-model effort picker -> snapshot-free config write -> return
```

The model transaction creates the rollback snapshot first, atomically writes the profile, and deletes the new snapshot if the profile write fails. Snapshot failure prevents profile mutation. A successful snapshot restores the complete pre-flow model/config state. Effort-write failure does not roll back the model: explicit effort remains absent, an error toast is shown, and navigation returns normally.

## Interfaces / Contracts

```ts
type RuntimeAgentClass = "reserved" | "primary" | "fallback";
type AgentOrderMetadata = { family: AgentFamily; knownIndex: number | null };
type RuntimeAgentInventoryItem = {
  runtimeName: string; profileKey: string; field: AssignmentField;
  classification: RuntimeAgentClass; order: AgentOrderMetadata;
  managedSdd: boolean; fallbackEligible: boolean;
};
type ModelMutationContext = {
  providers: unknown[]; runtimePrimaryNames: readonly string[];
  effortPolicy: "interactive-clear" | "bulk-compatible-prune" | "none";
};
type ProfileWriteTransaction = {
  profile: ProfileData; version?: ProfileVersion; changed: boolean;
};
collectRuntimeAgentInventory(config: unknown): RuntimeAgentInventoryItem[];
classifyRuntimeAgent(name: string): RuntimeAgentInventoryItem | null;
isEditablePrimaryAgent(name: string): boolean;
updateProfilePhaseModel(..., context: ModelMutationContext): ProfileWriteTransaction;
updateProfileReasoningWithoutVersion(...): ProfileData;
```

Reserved denylist: `build`, `plan`, `general`, `explore`, `compaction`, `summary`, `title`, `gentle-reviewer`, `gentle-worker`, `sdd-orchestrator`. Reserved and fallback entries never own effort. `gentle-orchestrator` remains the canonical alias; existing profile alias normalization remains unchanged. `model-audit` and `gentle-ai-windows-validator` are Tools only when runtime-present; neither gets synthesized fallback. Valid non-reserved, non-fallback runtime names are editable primaries; only existing managed predicates control SDD application/fallback synthesis.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/types.ts` | Modify | Add inventory, ordering, mutation-context, and transaction types. |
| `src/catalog.ts` | Modify | Runtime collection, denylist, strict suffix classification, presentation metadata/order. |
| `src/utils.ts` | Modify | Add editable-primary predicate; preserve managed/fallback predicates. |
| `src/profile-reasoning.ts` | Modify | Preserve custom/inactive configs, expose compatibility pruning, apply only runtime editable primaries. |
| `src/profiles.ts` | Modify | Transactional snapshot/write cleanup, contextual pruning, snapshot-free effort update, runtime-only bulk targets. |
| `src/dialogs.tsx` | Modify | Implement `post-model` state machine, cancel/back/error behavior, and non-interactive bulk context. |
| `src/catalog.test.ts` | Modify | RED: dynamic catalog, denylist, known omission/order, unknown fallback isolation, runtime-only tools. |
| `src/profile-reasoning.test.ts` | Modify | RED: custom reasoning, reserved/fallback rejection, compatible/incompatible pruning, inactive preservation/application scope. |
| `src/profiles.test.ts` | Modify | RED: one snapshot, transaction failures/cleanup, bulk prune, custom persistence, lossless inactive keys. |
| `src/dialogs.test.ts` | Modify | RED: model→effort chain, cancel, unsupported/fallback, model/effort write errors, return targets, no bulk prompts. |

## Testing Strategy

Strict TDD extends the four existing Vitest owners above. Unit tests cover inventory/classification and compatibility. Integration-style dialog/profile tests prove sequencing, toasts, write ordering, one snapshot, rollback cleanup, bulk behavior, and lossless round-trip. No E2E layer exists.

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable classification, or external process-integration boundary; dialog routing is internal UI state only.

## Migration / Rollout

No schema migration. Hidden inactive model/config keys remain unchanged. Interactive model changes clear old explicit effort; bulk retains compatible values and prunes incompatible values. Rollback is a coordinated revert of catalog, predicates, persistence, and dialogs.

## Open Questions

None.
