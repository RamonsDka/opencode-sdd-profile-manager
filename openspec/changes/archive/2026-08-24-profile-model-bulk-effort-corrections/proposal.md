# Proposal: Profile Model and Bulk Effort Corrections

## Intent

Make profile model configuration trustworthy and fast. Individual orchestrator changes currently lose the selected model through alias precedence, while bulk model updates leave reasoning effort inconsistent. The result must be one predictable, verifiable flow that persists model and effort together.

## Scope

### In Scope
- Canonicalize `sdd-ORCHETATOR` mutations, remove conflicting aliases, and confirm model plus effort in the individual success toast.
- Replace all current bulk options with one Spanish action meaning “assign one model and effort to all agents,” covering every configurable profile role.
- Run model selection, effort selection, and one atomic overwrite; cancellation before effort completion writes nothing. Persist `provider-default` when effort is unsupported.
- Preserve internal snapshots, restoration data, and history while removing the profile-detail versions entry and orphaned `Agentes` heading.
- Add strict-TDD regression criteria for canonical persistence, complete agent coverage, atomic cancellation, compatibility defaults, overwrite behavior, and menu cleanup.

### Out of Scope
- Provider/catalog changes, non-configurable fallback behavior, full hub redesign, historical-data deletion, deployment, or production rollout.
- Changes to other active OpenSpec deltas.

## Capabilities

### New Capabilities
- `profile-model-bulk-configuration`: Atomic profile-wide model and reasoning-effort assignment, including complete configurable-agent coverage, cancellation safety, compatibility defaults, and retained data-level rollback.

### Modified Capabilities
- `spanish-tui-agent-catalog`: Require canonical orchestrator persistence, joint model/effort feedback, and the simplified Spanish bulk flow.
- `agent-catalog-parity`: Replace the existing no-bulk catalog rule with one explicit profile-wide action while preserving catalog ordering, eligibility, and unrelated global configuration.

## Approach

Normalize orchestrator aliases at staging and commit boundaries. Build the bulk target set from all configurable catalog roles, collect model then effort without mutation, normalize unsupported effort to `provider-default`, and commit one snapshot-backed transaction. Remove only the profile-detail navigation entry; retain underlying version data and restoration behavior. Delivery uses `auto-chain` if implementation exceeds the 400-line review budget.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/orchestrator.ts`, `src/profiles.ts` | Modified | Canonical mutation and atomic bulk persistence |
| `src/dialogs.tsx`, `src/types.ts` | Modified | Unified flow, feedback, and menu cleanup |
| `src/*.test.ts` | Modified | Strict-TDD regression coverage |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Specialized roles become intentionally homogeneous | High | Explicit user-selected global overwrite semantics |
| Alias or dialog-state regressions cause partial writes | Medium | Canonical pruning and transaction-level tests |

## Rollback Plan

Revert the UI and mutation changes, then restore affected profiles from retained snapshots; do not delete historical data.

## Dependencies

- Existing catalog eligibility, effort compatibility, profile snapshot, and restoration mechanisms.

## Success Criteria

- [ ] Individual orchestrator changes persist canonically and report model plus effort.
- [ ] One bulk action atomically overwrites model and effort for every configurable agent; cancellation writes nothing.
- [ ] Unsupported effort persists as `provider-default`; versions navigation and orphan heading are absent while history remains restorable.
