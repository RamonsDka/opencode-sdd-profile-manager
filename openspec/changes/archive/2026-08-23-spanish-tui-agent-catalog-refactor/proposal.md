# Proposal: Spanish TUI Agent Catalog Refactor

## Intent

The profile TUI exposes incomplete, asymmetric catalogs, English copy, constrained dialogs, and conditional effort selection. Make configuration predictable in Spanish while preserving stored intent and OpenCode runtime compatibility.

## Objectives

- Render exactly 24 approved agents in five identical primary/fallback groups.
- Keep separators visible, non-selectable, and actionless.
- Open effort selection after every model choice, including same-model reselection.
- Use the greatest safe dialog width and height.

## Scope

### In Scope
- Exact catalog and Spanish presentation from the authoritative SDD artifacts.
- Symmetric presentation/persistence with runtime-safe fallback synchronization.
- Idempotent, non-destructive profile normalization and protected literal preservation.

### Out of Scope
- OpenCode runtime changes or unsupported fallback runtime agents.
- Tracker changes and unrelated profile redesign.

## User Experience and Compatibility

Catalog metadata drives both menus and no-op separators. Every model choice immediately opens effort selection. Persistence may retain fallback assignments OpenCode cannot execute; runtime synchronization filters unsupported agents while presentation and stored intent remain complete.

## Data Impact and Migration

Normalize existing profiles on read/write without deleting valid or unknown assignments. Preserve runtime-ineligible fallback data but do not synchronize it. Migration is idempotent and requires no profile reset.

## Capabilities

### New Capabilities
- `spanish-tui-agent-catalog`: Grouped catalog, localization, effort flow, normalization, and runtime-safe fallback synchronization.

## Affected Areas

`src/catalog.ts`, `src/utils.ts`, `src/orchestrator.ts`, `src/profile-reasoning.ts`, `src/profiles.ts`, `src/dialogs.tsx`, `src/types.ts`, host compatibility, and owned tests.

## Risks

| Risk | Mitigation |
|---|---|
| Runtime pollution | Strict synchronization eligibility filter. |
| Separator activation | Typed no-op values and interaction tests. |
| Profile loss | Non-destructive normalization fixtures. |
| Localization regressions | Visible-string assertions preserving approved English literals. |

## Rollback Plan

Revert units independently, preserve profile data, and restore prior catalog/rendering/synchronization without schema downgrade.

## Success Criteria

- [ ] Both menus render the same 24 agents, order, and groups.
- [ ] Separators never change selection.
- [ ] Every choice opens effort; unsupported models show only `Predeterminado`.
- [ ] UI language, sizing, profile preservation, and runtime filtering meet approved rules.
- [ ] Each unit remains below 400 changed lines and passes strict-TDD regression coverage.
