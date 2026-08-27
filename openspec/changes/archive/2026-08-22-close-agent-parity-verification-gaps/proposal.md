# Proposal: Close Agent Parity Verification Gaps

## Intent

Verify `gentle-ai-agent-parity-and-dialog-sizing` = `FAIL` (1 blocker, 2 criticals, 14/19 scenarios; 282/282 green). 23 `safeSetDialogSize` sites static but gaps: runtime 2/23, isolation only `medium` loop, fallback checked count+endpoints not full 19, `syncSddFallbackAgents` synthesizes future `-fallback` alone (W4, ADR-11), docs missing (W5, §13).

## Scope

### In Scope
- Explicit-only gate in `syncSddFallbackAgents`: no synthesis unless `profile.fallback[base]` or fallback in config or base∈19 `BASE_CANONICAL_ORDER`
- Table-driven `setSize` for 23 dialogs (xlarge: detail/pickers/memory; large: submenus/bulk/provider/versions/memories; medium: prompts) + cross-tier `xlarge↔large↔medium` with `__back__`/cancel
- Exact 19 fallback sequence equality
- `docs/dialogs.md` (tier table, wrap ≥80) + `docs/compatibility.md` (host matrix, clamp) + README links
- Manual <80-col evidence (non-mutating)

### Out of Scope
- New schema, per-family bulk, `model-audit-fallback`, custom overflow, e2e

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `agent-catalog-parity`: full 19 canonical order + explicit-only activation
- `dialog-ux-sizing`: runtime tier for 23 dialogs + cross-tier isolation

## Approach

Single slice ~240 lines (budget 400): ~10-line gate + `it.each` in dialogs/catalog/profiles tests + 2 docs. Strict TDD RED→GREEN. Future fallback NOT updated if `profile.fallback` omits base; 23 table-driven; manual check as note.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/profiles.ts` | Modified | Gate in `syncSddFallbackAgents` |
| `src/dialogs.test.ts` | Modified | 23 tiers + cross-tier |
| `src/catalog.test.ts` | Modified | 19-sequence |
| `src/profiles.test.ts` | Modified | No-synthesis |
| `docs/dialogs.md` | New | Tier table |
| `docs/compatibility.md` | New | Host matrix |
| `README.md` | Modified | Links |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Gate blocks 19 base | Med | OR: `BASE` ∨ `fallbackModels[base]` ∨ existing; regression pins 19 |
| Table drift | Low | Single §6 map |
| Doc drift | Low | Tables only |

## Rollback Plan

`git revert <slice>` — restores synthesis (shadow fallback only next activation). Docs deletion no wire effect; profiles valid JSON.

## Compatibility

No break. Persisted `fallback["sdd-future"]` via `isValidAgentKey`; only synthesis stopped. Old hosts via `safeSetDialogSize` guard. <80 cols = host clamp. Future pair only when both explicit.

## TDD Constraint

`strict_tdd: true`. RED: 23-tier spies, cross-tier, 19-array, no-synthesis. `npm test`+`typecheck` green.

## Dependencies

- `api.ui.dialog.setSize` guarded; `BASE_CANONICAL_ORDER` (40/19) in `src/catalog.ts`

## Success Criteria

- [ ] `sdd-future` alone → no fallback when `profile.fallback["sdd-future"]` absent
- [ ] 19 base fallbacks still sync
- [ ] 23 dialogs assert tier table-driven
- [ ] Cross-tier `xlarge→large→xlarge→medium→caller`
- [ ] 19 sequence equals canonical
- [ ] Docs with tables, linked from README
- [ ] <80-col evidence non-mutating
- [ ] Verify PASS; tests+typecheck clean
