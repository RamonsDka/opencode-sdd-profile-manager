# Design: Close Agent Parity Verification Gaps

## Technical Approach

Single slice ~240 lines: explicit-only gate in `syncSddFallbackAgents`, table-driven `it.each` for 23 dialogs, exact 19 fallback `toEqual`, cross-tier isolation, `docs/dialogs.md` + `docs/compatibility.md` + README links. Fixes verify FAIL C1/C2/W1-W5; preserves 19 base sync; future `sdd-future-fallback` only when `profile.fallback[base]` explicit.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|---|---|---|---|
| Fallback gate | Unconditional / gated | Unconditional shadows future | **Explicit-only: 19 canonical always sync; dynamic `sdd-future` only if `fallbackModels[base]` non-empty; else preserve existing** |
| 23-dialog harness | Per-file / table-driven | Per-file bloat | **One `it.each` table over real exported fns + spy `api.ui.dialog.setSize` before `replace`** |
| 19 sequence | count+endpoints / `toEqual(literal)` | Endpoints miss reorder; derived expected tautological | **`toEqual(literal CANONICAL_FALLBACK_ORDER)` — literal independent fixture in test vs derived result from `BASE_CANONICAL_ORDER`+`deriveFallbackProfileKey`; never `expect(x).toEqual(BASE.filter(...))` with same source** |
| Docs | README bullets / separate | Bullets violate §13 | **`docs/dialogs.md` + `docs/compatibility.md` + README links** |
| <80-col evidence | Mutate / note / verify-report | Mutation violates spec; verify-report not persistent | **Non-mutating snapshot in `docs/compatibility.md` appendix (Manual Narrow-Terminal Evidence, width 70 clamp + `wrapDisplayText` + `npm run examples`); `verify-report` only references it** |

## Data Flow

```
profile {models,fallback} ─┐
config.agent ──────────────┼→ applyProfileDataToConfig → syncSddFallbackAgents (gate) → config.update
                           │        ├─ 19 canonical → { ...base, model: fallbackModels[base] ?? base.model }
                           │        └─ sdd-future → skip if !canonical && !explicit (preserve)
                           └→ buildCatalogSections → Fallbacks = 19 base + explicit extras

safeSetDialogSize(api, tier) ← each entry + __back__/onCancel (guarded, never throws) → host clamps <80
wrapDisplayText(line, 80) at xlarge else 52
```

Cross-tier: `xlarge(hub)` → `large(submenu)` → `medium(confirm)` → `__back__` re-calls tier.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/profiles.ts` | Modify | Gate: `isCanonical=SET19.has(base)`; skip if `!canonical && !fallbackModels[base]?.trim()`; preserve existing verbatim; else `model=fallbackModels[base]??base.model` |
| `src/dialogs.test.ts` | Modify | `it.each(TIER_MAP[23])` asserts `setSize` tier; `it('xlarge→large→xlarge→medium 5×')` |
| `src/catalog.test.ts` | Modify | `expect(fallbacks).toEqual(CANONICAL)` + `FALLBACK_MANAGED_COUNT=19` |
| `src/profiles.test.ts` | Modify | No-synthesis, preserved, and 19-sync cases via `syncSddFallbackAgents`/`applyProfileDataToConfig` |
| `docs/dialogs.md` | Create | §6 tier table (23 rows: Dialog,Tier,Trigger,Reset) + wrap ≥80 |
| `docs/compatibility.md` | Create | Host matrix (setSize, clamp, degradation) |
| `README.md` | Modify | Links to both docs |

## Interfaces / Contracts

```ts
// src/catalog.ts — 19 exact order, sensitive (source of truth)
export const CANONICAL_FALLBACK_ORDER: readonly string[] = [
  "jd-fix-agent-fallback","jd-judge-a-fallback","jd-judge-b-fallback",
  "review-readability-fallback","review-refuter-fallback","review-reliability-fallback",
  "review-resilience-fallback","review-risk-fallback","review-validator-fallback",
  "sdd-apply-fallback","sdd-archive-fallback","sdd-design-fallback","sdd-explore-fallback",
  "sdd-init-fallback","sdd-onboard-fallback","sdd-propose-fallback","sdd-spec-fallback",
  "sdd-tasks-fallback","sdd-verify-fallback",
];
export const FALLBACK_MANAGED_COUNT = 19;

// src/profiles.ts — explicit-only invariant
export function syncSddFallbackAgents(currentConfig: any, fallbackModels: ProfileFallbackModels): any;
// canonical always sync; dynamic iff fallbackModels[base] trimmed non-empty; else preserve/absent

// harness — literal independent fixture (test-owned) vs derived production value
// src/catalog.test.ts must NOT do: const expected = BASE_CANONICAL_ORDER.filter(d=>derive(d)!==null)
// must do:
const EXPECTED_FALLBACK_ORDER: readonly string[] = [
  "jd-fix-agent-fallback","jd-judge-a-fallback","jd-judge-b-fallback",
  "review-readability-fallback","review-refuter-fallback","review-reliability-fallback",
  "review-resilience-fallback","review-risk-fallback","review-validator-fallback",
  "sdd-apply-fallback","sdd-archive-fallback","sdd-design-fallback","sdd-explore-fallback",
  "sdd-init-fallback","sdd-onboard-fallback","sdd-propose-fallback","sdd-spec-fallback",
  "sdd-tasks-fallback","sdd-verify-fallback",
]; // literal, independent of BASE_CANONICAL_ORDER derivation
// then: expect(derivedFromBase).toEqual(EXPECTED_FALLBACK_ORDER) — catches reorder drift; tautological derivation forbidden

const TIER_MAP: Array<[string, () => any, DialogSize]> = [
  ["showProfileDetail","xlarge"], //...23 total
];
it.each(TIER_MAP)("%s → %s", (_, fn, tier) => { fn(mockApi()); expect(spy).toHaveBeenCalledWith(tier); });
```
`safeSetDialogSize` stays optional-chain+try/catch. `docs/compatibility.md` appendix `## Manual Narrow-Terminal Evidence (<80 cols)` is authoritative non-mutating record; `verify-report` only references `docs/compatibility.md#manual-narrow-terminal-evidence`.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | 23 tiers + 19 `toEqual(literal)` + no-synthesis/preserved/19-sync | Vitest real fns, spy `setSize` before `replace`; `catalog.test.ts` compares literal `EXPECTED_FALLBACK_ORDER` fixture (independent) vs derived production value from `BASE_CANONICAL_ORDER`; deriving expected from same source forbidden |
| Integration | Cross-tier 5×; activation no synthesis | Chain `hub→submenu→back→confirm→cancel` + `applyProfileDataToConfig` |
| Manual | <80-col non-mutating | Record in `docs/compatibility.md` appendix `Manual Narrow-Terminal Evidence` (width 70 clamp + `wrapDisplayText` snapshot + `npm run examples`); verify references appendix, no `verify-report`-only evidence |

**TDD order**: RED catalog 19 → RED 23-tier → RED cross-tier → RED no-synthesis → GREEN gate (~10 lines) → GREEN docs → `npm test` + `typecheck` green. `strict_tdd:true`.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR or executable boundary. In-process config + guarded UI only.

## Migration / Rollout

No migration. Slice ≤400; `git revert` restores synthesis. Old hosts via `safeSetDialogSize` guard + clamp. Docs revert no wire effect.

## Open Questions

None — both prior questions closed per user-approved corrections:
- Resolved: `CANONICAL_FALLBACK_ORDER` tested via literal independent fixture (`EXPECTED_FALLBACK_ORDER`) compared against derived production value; tautological derivation from same `BASE_CANONICAL_ORDER` forbidden to ensure reorder drift detection.
- Resolved: Manual <80-col evidence recorded in `docs/compatibility.md` appendix `Manual Narrow-Terminal Evidence (<80 cols)`; `verify-report` only references it.

## ADR Summary

- ADR-1 Explicit-only fallback gate preserves 19 canonical sync and blocks future synthesis unless `profile.fallback[base]` explicit.
- ADR-2 Literal independent `EXPECTED_FALLBACK_ORDER` fixture for `toEqual` prevents tautological pass.
- ADR-3 Manual evidence authoritative location is `docs/compatibility.md` appendix.
