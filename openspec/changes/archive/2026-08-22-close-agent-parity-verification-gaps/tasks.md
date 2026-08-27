# Tasks: Close Agent Parity Verification Gaps

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~240 lines (profiles: ~10, catalog.test: ~30, profiles.test: ~35, dialogs.test: ~65, docs: ~95, README: ~5) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR (auto-chain stacked-to-main) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Close verification gaps across fallback gate, 23-tier sizing, and docs | PR 1 | `npm test` | `npm run examples && git diff --check` | `src/profiles.ts`, `src/*.test.ts`, `docs/*.md`, `README.md` |

## Phase 1: RED Tests (Failing Test Suite)

- [x] 1.1 Add literal independent `EXPECTED_FALLBACK_ORDER` fixture in `src/catalog.test.ts` and assert exact 19-element canonical fallback sequence equality (RED).
- [x] 1.2 Add RED test cases in `src/profiles.test.ts` for `syncSddFallbackAgents`: verify dynamic primary alone creates no fallback, existing fallback is preserved, and 19 canonical base fallbacks still sync.
- [x] 1.3 Add RED parameterized `it.each` table in `src/dialogs.test.ts` asserting `api.ui.dialog.setSize` tier across all 23 dialog entry points before `replace`.
- [x] 1.4 Add RED cross-tier navigation test in `src/dialogs.test.ts` asserting size reset across `xlarge` hub → `large` submenu → `medium` confirm → back/cancel loop without size leaks.

## Phase 2: GREEN Implementation & Documentation

- [x] 2.1 Implement explicit-only gate in `syncSddFallbackAgents` (`src/profiles.ts`) to skip dynamic primaries without explicit profile fallback while keeping 19 base fallbacks in sync (GREEN).
- [x] 2.2 Create `docs/dialogs.md` detailing the 23-dialog sizing tier map (`xlarge`, `large`, `medium`), trigger points, reset lifecycle, and adaptive wrap (≥80) rules.
- [x] 2.3 Create `docs/compatibility.md` documenting host API support, graceful degradation, and appendix containing manual narrow-terminal evidence (<80 cols).
- [x] 2.4 Update `README.md` with reference links to `docs/dialogs.md` and `docs/compatibility.md`.

## Phase 3: REFACTOR & Verification Harness

- [x] 3.1 Refactor test assertions in `src/catalog.test.ts` and `src/dialogs.test.ts` to ensure clean fixture isolation without tautological production dependencies.
- [x] 3.2 Execute complete test and verification suite: verify `npm test`, `npm run typecheck`, `npm run examples`, and `git diff --check` are all green.
