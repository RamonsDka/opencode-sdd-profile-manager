# Proposal: Fallback Bulk Model and Effort Assignment

## Intent

Let operators prepare complete fallback resilience in one operation. Today fallback agents require individual configuration and their reasoning effort is not persistently applied. The TUI needs a fallback-specific bulk action symmetrical to the existing primary/configurable-agent action.

## Scope

### In Scope
- Add `Asignar un modelo y esfuerzo a todos los agentes fallback` as a second action in the existing bulk menu.
- Assign one model and effort to all 19 canonical eligible fallbacks, including unconfigured entries.
- Persist and apply fallback model and effort through one atomic model → effort mutation.
- Preserve snapshot versioning, rollback, legacy-profile compatibility, and strict TDD.

### Out of Scope
- Changing the existing primary/configurable-agent action.
- Changing providers, the base catalog, fallback eligibility, or other menus.
- Removing fallbacks or deploying this change.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `profile-model-bulk-configuration`: Support separate primary and fallback bulk targets, persistent fallback effort, cancellation safety, and `provider-default` compatibility.
- `agent-catalog-parity`: Replace the one-action constraint with two profile-wide actions while preserving the canonical 19 fallback set.
- `spanish-tui-agent-catalog`: Extend Spanish fallback configuration to persist and runtime-apply model plus effort atomically.

## Approach

Generalize the existing snapshot-backed overwrite engine with a `primary | fallback` target. Reuse provider/model/effort selection and versioned atomic persistence. Fallback writes must support legacy profiles lacking `fallback` or fallback-effort data. Cancelling any picker performs no mutation; successful selection writes once without an extra confirmation.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/dialogs.tsx` | Modified | Add and route the fallback bulk action. |
| `src/catalog.ts` | Modified | Collect the canonical fallback targets. |
| `src/profiles.ts`, `src/profile-reasoning.ts`, `src/types.ts` | Modified | Generalize atomic persistence, effort application, and snapshots. |
| `src/*.test.ts` | Modified | Add strict-TDD coverage and regressions. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Primary behavior regression | Medium | Backward-compatible defaults and regression tests. |
| Legacy or runtime config corruption | Medium | Normalize missing fields and test activation/rollback. |

## Rollback Plan

Remove the second menu action and fallback target branch, restore prior normalization/application behavior, and restore affected profiles from retained snapshots.

## Dependencies

- Existing provider model metadata, profile snapshots, and atomic persistence pipeline.

## Success Criteria

- [ ] One operation configures model and effort for all 19 canonical fallbacks.
- [ ] Cancellation leaves profiles and snapshots unchanged.
- [ ] Fallback activation applies persisted values; unsupported effort resolves to `provider-default`.
- [ ] Existing primary behavior and legacy profiles remain compatible.
