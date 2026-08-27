# Tasks: TUI Profile Usability and Activation Fix

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 450-580 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 -> PR 2 -> PR 3 -> PR 4 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Native catalog categories, 25-agent order, and auxiliary predicates | PR 1 (base: main) | `npm test -- src/catalog.test.ts` | N/A (unit tests only) | `src/catalog.ts`, `src/types.ts`, `src/utils.ts`, `src/catalog.test.ts` |
| 2 | Dense `xlarge` dialogs, `Nivel de esfuerzo`, and `agent: value` rows | PR 2 (base: main) | `npm test -- src/dialogs.test.ts` | N/A (unit tests only) | `src/dialogs.tsx`, `src/dialogs.test.ts` |
| 3 | Partial activation, complete definitions, missing warnings, auxiliary persistence | PR 3 (base: main) | `npm test -- src/profiles.test.ts src/profile-reasoning.test.ts` | N/A (unit tests only) | `src/profiles.ts`, `src/profiles.test.ts`, `src/profile-reasoning.test.ts` |
| 4 | External resolver path joining, spaces, and traversal safety | PR 4 (base: main) | `node --test C:/Users/DELL/.config/opencode/bin/resolve-home-path.test.cjs` | Sibling `node:test` execution | `C:/Users/DELL/.config/opencode/bin/resolve-home-path.*` |
| 5 | Full suite validation, typecheck, build, and runtime smoke | N/A (Local / Final) | `npm run typecheck && npm test && npm run build` | Full OpenCode restart & manual TUI smoke | Rebuild `dist/tui.js` / restore previous build |

## Phase 1: Catalog & Eligibility (Work Unit 1)

- [x] 1.1 RED: Add tests in `src/catalog.test.ts` for 25-agent exact order across 5 categories and auxiliary eligibility predicates.
- [x] 1.2 GREEN: Update `src/catalog.ts`, `src/types.ts`, and `src/utils.ts` to export native `CATALOG_GROUPS`, preserve a type-safe temporary dialog separator bridge only where required, and add visibility/fallback predicates.
- [x] 1.3 REFACTOR: Clean up catalog exports and verify `src/catalog.test.ts` passes.

## Phase 2: Dialog Sizing & Copy (Work Unit 2)

- [x] 2.1 RED: Add tests in `src/dialogs.test.ts` for `xlarge` dense dialogs, `Nivel de esfuerzo` title, and `<agent>: <value>` row copy.
- [x] 2.2 GREEN: Update `src/dialogs.tsx` with native `DialogSelect` category headers, `safeSetDialogSize("xlarge")`, and simplified effort formatting.
- [x] 2.3 REFACTOR: Remove obsolete divider rendering logic and verify `src/dialogs.test.ts` passes.

### Unit 2 Corrective Smoke Completion

- [x] Corrected the profile-hub `Navegación de modelos` smoke defect: direct model rows now reuse the exact grouped 25-agent primary catalog and preserve the existing model-selection action behavior.

## Phase 3: Activation & Persistence (Work Unit 3)

- [x] 3.1 RED: Add tests in `src/profiles.test.ts` and `src/profile-reasoning.test.ts` for partial activation, complete-definition discovery, missing-agent warnings, and auxiliary persistence without fallback.
- [x] 3.2 GREEN: Update `src/profiles.ts` to discover installed definitions, apply valid agents, emit exact missing warnings, and guard runtime fallback sync.
- [x] 3.3 REFACTOR: Streamline profile activation pipelines and verify profile tests pass.

## Phase 4: External Resolver (Work Unit 4)

- [x] 4.1 RED: Create `C:/Users/DELL/.config/opencode/bin/resolve-home-path.test.cjs` covering path joining, spaces, fallback roots, and threat matrix cases (traversal `..`, absolute segments, malformed inputs).
- [x] 4.2 GREEN: Update `C:/Users/DELL/.config/opencode/bin/resolve-home-path.cjs` to join `OPENCODE_WORKSPACE_ROOT` with all segments and preserve spaces safely.
- [x] 4.3 REFACTOR: Ensure clean error reporting with untruncated paths and verify resolver tests pass.

### Unit 4 Corrective Smoke Completion

- [x] Corrected the configured-root agent-suite target smoke defect with explicit configured-root and HOME fallback tails; the resolver remains generic and no duplicate-prefix heuristic was added.

## Phase 5: Verification & Integration (Work Unit 5)

- [ ] 5.1 Run full suite validation: `npm run typecheck && npm test && npm run build`.
- [ ] 5.2 Execute runtime harness: restart OpenCode and perform manual profile activation smoke test.
