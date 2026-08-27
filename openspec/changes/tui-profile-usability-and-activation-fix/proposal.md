# Proposal: TUI Profile Usability and Activation Fix

## Intent

Make profile configuration easier to navigate and activate reliably. The current TUI exposes focusable separator rows, undersized dense dialogs, inconsistent effort copy/order, and activation fails because an external global resolver drops path segments when `OPENCODE_WORKSPACE_ROOT` is set.

## Scope

### In Scope
- Use native visual categories with no focus, selection, or action; render dense dialogs at host-supported `xlarge` while keeping small confirmations/forms proportional.
- Enforce this order: `sdd-ORCHETATOR`; `sdd-propose`, `sdd-design`, `sdd-apply`, `sdd-verify`, `sdd-spec`, `sdd-onboard`, `sdd-explore`, `sdd-init`, `sdd-tasks`, `sdd-archive`; JD; reviewers including `model-audit`; auxiliaries `gentle-ai-windows-validator`, `compaction`, `summary`, `title`.
- Rename user-facing effort copy to `Nivel de esfuerzo` and rows to `agent: value`, preserving protected identifiers/tokens and original effort values.
- Resolve unavailable agents only from complete installed/configured definitions; activate available agents and warn explicitly about unresolved entries.
- Allow auxiliary model/effort editing without fallback visibility or fallback-agent generation.
- Fix `C:/Users/DELL/.config/opencode/bin/resolve-home-path.cjs` so the configured root is joined with remaining segments, including paths with spaces.

### Out of Scope
- Modifying OpenCode core or introducing numeric dialog dimensions.
- Creating incomplete agent definitions or enabling fallback for internal agents.
- Changing profile serialization as the activation root cause.

## Capabilities

### New Capabilities
- `secure-workspace-path-resolution`: Safely resolve external plugin paths from `OPENCODE_WORKSPACE_ROOT` plus trailing segments and preserve paths containing spaces.

### Modified Capabilities
- `spanish-tui-agent-catalog`: Change grouping, exact ordering, dialog sizing, effort presentation, auxiliary behavior, missing-agent handling, and activation integration expectations.

## Approach

Use host-native categories and `xlarge` tiers, update the catalog/presentation rules, and apply Strict TDD. Treat the external resolver as a separate reversible work unit with focused path tests; keep repository activation/config serialization unchanged except for defensive integration behavior.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/dialogs.tsx`, `src/catalog.ts` | Modified | TUI grouping, sizing, copy, order, auxiliary rules |
| `src/*.test.ts` | Modified | Strict-TDD regressions and activation integration coverage |
| `C:/Users/DELL/.config/opencode/bin/resolve-home-path.cjs` | Modified | External root-plus-segments resolution |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cross-repository/global-config regression | Med-High | Separate reversible unit, path-with-spaces tests, explicit boundary review |
| Catalog/runtime eligibility mismatch | Medium | Preserve IDs/tokens and test inventory, ordering, warnings, and filtering |

## Rollback Plan

Revert repository TUI/catalog changes independently, then restore the external resolver file from its pre-change version. Reactivate the previous profile and rerun focused tests.

## Dependencies

- OpenTUI native categories and host `xlarge` support.
- Access to the authorized external resolver boundary.

## Success Criteria

- [ ] Visual headers never receive focus or actions; dense dialogs use `xlarge` without core changes.
- [ ] Exact order, effort copy, auxiliary restrictions, and unresolved-agent warnings are covered by tests.
- [ ] Activation succeeds with `OPENCODE_WORKSPACE_ROOT` and paths containing spaces.
- [ ] Repository and external resolver changes remain independently reversible under the 400-line review guard.
