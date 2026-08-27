# Proposal: Gentle AI Agent Parity and Dialog Sizing

## Intent
100% Gentle AI 2.4.0 parity (40 agents) + fix clipped dialogs. `model-audit` filtered today; dialogs fixed `medium` truncates long IDs and 21+ rows.

## Scope

### In Scope
- Hybrid catalog: 40 static base + `sdd-*`/`review-*`/`jd-*` + `gentle-orchestrator`/`model-audit`; unknowns -> `Custom`.
- Families visual only (Orchestrator, SDD, JD, Review, Tools, Fallbacks/Custom) TUI order.
- Unconfigured badge, still assignable.
- `safeSetDialogSize`: `xlarge` detail/pickers/memory, `large` submenus/versions, `medium` prompts + wider wrap.
- Docs + profile compat.

### Out of Scope
- Per-family bulk, global install, `model-audit-fallback`, alpha reorder.

## Capabilities

### New Capabilities
- `agent-catalog-parity`: hybrid 40 parity, Custom, fallback safety.
- `dialog-ux-sizing`: tiered sizing, guard, wrap.

### Modified Capabilities
- None — specs empty.

## Approach
Hybrid + tiered per exploration. Add `model-audit` to `MANAGED_SDD_AGENT_EXCEPTIONS` and `FALLBACK_INELIGIBLE_AGENTS` (`sdd-orchestrator`, `gentle-orchestrator`, `model-audit`). Union base + `config.agent` + profile keys; family-map. Add `safeSetDialogSize` in `host-compat.ts`. Strict TDD, 400-line `auto-chain`.

## Product Behavior
- Detail groups 21 primaries + fallbacks; unconfigured badged but selectable.
- `model-audit` primary, no fallback; missing `setSize` no-ops.

## Compatibility & Migration
- Old profiles load unchanged; `model-audit` added only on assign. Custom round-trips. No schema break. Old hosts degrade.

## Affected Areas

| Area | Impact | Change |
|------|--------|--------|
| `src/utils.ts` | Modified | guard |
| `src/types.ts` | Modified | types |
| `src/profiles.ts` | Modified | sync 40 |
| `src/dialogs.tsx` | Modified | sizing/badge |
| `src/host-compat.ts` | Modified | helper |
| `docs/` | Modified | docs |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `xlarge` clip narrow | Med | clamp; `medium` prompts |
| No `setSize` | Med | guard |
| 21-item scroll | Low | filter+submenus |

## Dependencies
- `api.ui.dialog.setSize` (guarded), Gentle AI 2.4.0 catalog.

## Rollback Plan
Revert slice. Profiles valid. Drop `safeSetDialogSize` -> `medium`.

## Success Criteria
- [ ] 40 visible; unknowns in Custom
- [ ] `model-audit` primary, no fallback
- [ ] Tiered sizes; degraded works
- [ ] Profiles lossless
- [ ] Docs/specs + TDD pass

## Clarifications
1 Show 40 always. 2 Custom unknowns. 3 TUI order. 4 Badge+assignable. 5 No bulk. 6 Tiered+guard. 7 `model-audit` no fallback. 8 Docs+compat, no global mutation.

## Base Catalog (40)
`gentle-orchestrator`, `sdd-init`, `sdd-explore`, `sdd-propose`, `sdd-spec`, `sdd-design`, `sdd-tasks`, `sdd-apply`, `sdd-verify`, `sdd-archive`, `sdd-onboard`, `jd-judge-a`, `jd-judge-b`, `jd-fix-agent`, `review-risk`, `review-readability`, `review-reliability`, `review-resilience`, `review-refuter`, `review-validator`, `model-audit`, `jd-fix-agent-fallback`, `jd-judge-a-fallback`, `jd-judge-b-fallback`, `review-readability-fallback`, `review-refuter-fallback`, `review-reliability-fallback`, `review-resilience-fallback`, `review-risk-fallback`, `review-validator-fallback`, `sdd-apply-fallback`, `sdd-archive-fallback`, `sdd-design-fallback`, `sdd-explore-fallback`, `sdd-init-fallback`, `sdd-onboard-fallback`, `sdd-propose-fallback`, `sdd-spec-fallback`, `sdd-tasks-fallback`, `sdd-verify-fallback`.
