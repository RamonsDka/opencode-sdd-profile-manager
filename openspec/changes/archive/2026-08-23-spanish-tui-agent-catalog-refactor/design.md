# Design: Spanish TUI Agent Catalog Refactor

## Technical Approach

Replace runtime-derived menu composition with a structured catalog SSOT, then derive three explicit views: visible rows, persistible agent keys, and runtime-sync-eligible agents. Keep profile mutation atomic by staging model and effort choices in memory and committing once. Extend current helpers and Vitest owners; do not introduce a localization framework or unsupported OpenTUI APIs.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|---|---|---|
| Catalog SSOT | Parallel primary/fallback arrays | Define five typed groups containing exactly 24 agent keys. Both menus flatten the same groups; separators are presentation rows only. |
| Eligibility boundaries | One broad editable predicate | Export separate catalog-visible, persistible, and runtime-sync predicates/sets. Storage accepts all approved keys plus existing valid unknown keys; sync excludes unsupported runtime agents. |
| Orchestrator compatibility | Rename current canonical runtime agent | Add literal `sdd-ORCHETATOR` as a profile/catalog alias while retaining runtime policy resolution. |
| Normalization | Destructive schema rewrite | Pure normalization preserves extras and unknown valid assignments, canonicalizes known aliases/configs, and is idempotent. |

## Data Flow

    CATALOG_GROUPS → visible rows → DialogSelect → typed resolver
            ├→ persistible keys → profile normalization/write
            └→ sync-eligible keys → runtime *-fallback reconciliation

    model click → pending selection → effort/Predeterminado → single commit
                                      └→ cancel/error → previous profile

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

Protected runtime literals and agent names remain exact. Stored-only catalog entries remain persistible but are never synthesized into runtime configuration. Explicit runtime-sync-eligible entries may reconcile a fallback pair at the existing synchronization boundary.

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

Unit tests cover catalog/eligibility and normalization. Integration-style profile tests prove persistence symmetry, runtime filtering, idempotence, and protected literals. No E2E layer exists.

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable classification, or external process-integration boundary; dialog routing is internal UI state only.

## Migration / Rollout

No schema migration. Unknown valid assignments and runtime-ineligible fallback intent remain unchanged. Rollback is a coordinated revert of synchronization and normalization changes.

## Open Questions

None.
