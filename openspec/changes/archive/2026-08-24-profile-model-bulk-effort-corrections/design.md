# Design: Profile Model and Bulk Effort Corrections

## Technical Approach

Keep dialogs as collectors and move mutation semantics into `profiles.ts`. Both individual and bulk flows collect model plus effort in memory, then invoke one transaction that reads the original bytes, builds a complete normalized `ProfileData`, writes a rollback snapshot, and performs one atomic profile replacement. Initial forecast: 5 production files and 3 tests; **400-line budget risk: High** because dialog-flow replacement and strict regression coverage span three established suites. Tasks/PR slicing remains a later decision.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|---|---|---|
| Add a mutation-boundary helper in `profiles.ts` that maps an orchestrator selection to `policy.canonicalName`, deletes every `policy.aliasNames` entry from models/configs, then applies the selected model/effort | Change alias precedence globally; canonicalize only on read; stage aliases | The selected value must win before generic canonicalization can resolve an older alias. Read-time precedence remains compatible, while every write produces one canonical owner. |
| Preserve `PendingModelSelection`; commit only from the effort picker | Persist model first; roll back on cancel | Existing staging is already mutation-free. One commit gives cancellation safety and one toast containing agent, model, and localized effort. |
| Derive bulk targets from `collectRuntimeAgentInventory(config)` and catalog assignment metadata, filtering editable/catalog-visible entries and excluding `reserved`/internal entries; deduplicate by `(field, profileKey)` and canonicalize the orchestrator | `BASE_CANONICAL_ORDER`; runtime managed-prefix filtering; hardcoded arrays | Runtime inventory already merges known deterministic order with custom configured agents and classifies reserved/primary/fallback entries. Presentation constants must not become persistence authority. |
| Introduce a pure `buildBulkProfileOverwrite(profile, targets, model, effort, context, policy)` | Repeated per-agent writes; extend fill/overwrite branches | A pure builder can overwrite all model fields, set effort for reasoning-owning primary targets, use `provider-default` when unsupported, prune obsolete configs/aliases, and return the complete next profile plus counts before I/O. |
| Remove only the hub option | Delete version functions/data | `buildProfileDetailHubOptions` owns the visible `Versiones` entry and orphan `Agentes` category; snapshot/list/restore APIs remain untouched. |

## Data Flow

    select model → pending selection → select/cancel effort
                                           │ cancel: return, no I/O
                                           ▼
    derive targets → pure next-profile builder → snapshot(beforeRaw)
                                             → atomic profile write → joint toast

Snapshot creation failure prevents the profile write. Profile-write failure removes the newly created snapshot through the existing `persistVersionedProfileMutation` compensation, preventing a partial committed profile.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/profiles.ts` | Modify | Canonical write boundary, pure bulk builder, snapshot-backed single commit. |
| `src/dialogs.tsx` | Modify | One bulk model→effort flow, cancellation, combined toasts, hub cleanup. |
| `src/catalog.ts` | Modify | Expose/reuse a configurable target projection over runtime inventory if no suitable export exists. |
| `src/types.ts` | Modify | Bulk target/request/result contracts. |
| `src/profile-reasoning.ts` | Modify | Reuse compatibility resolution and canonical config pruning. |
| `src/profiles.test.ts` | Modify | Transaction and persistence regressions. |
| `src/dialogs.test.ts` | Modify | Flow, toast, cancellation, and menu regressions. |
| `src/orchestrator.test.ts` | Modify | Legacy conflicting-alias regression. |

## Interfaces / Contracts

`BulkProfileOverwriteRequest` contains catalog-derived targets, model ID, selected effort, providers, and orchestrator policy. The pure builder returns `{ profile, modelsAssigned, effortsAssigned }`; persistence returns the existing version/transaction metadata. No public version or restoration contract changes.

## Testing Strategy

| Phase | Tests |
|---|---|
| RED | In existing suites, first prove failures for discordant legacy alias precedence, individual effort cancellation, combined toast, exactly one bulk option, all catalog-derived configurable targets with internal exclusion, unsupported-model `provider-default`, pre-write snapshot, injected snapshot/write failure with unchanged profile/no surviving partial snapshot, and absent `Versiones`/`Agentes`. |
| GREEN | Implement the canonical helper, pure builder, single persistence transaction, sequential dialogs, and hub option removal only until those tests pass. |
| REFACTOR | Share target derivation and effort normalization; retain behavior assertions and run `npm test` plus `npm run typecheck`. No E2E layer exists. |

## Threat Matrix

N/A — this change modifies in-process profile transformation and TUI composition only; it adds no routing, shell, subprocess, VCS/PR automation, executable classification, or process-integration boundary.

## Migration / Rollout

No migration required. Legacy aliases are repaired opportunistically on affected writes; retained snapshots support rollback. Active changes `streamline-agent-model-configuration` and `tui-profile-usability-and-activation-fix` overlap the forecast files, so implementation must rebase and preserve their catalog/profile contracts without editing their artifacts.

## Open Questions

None.
