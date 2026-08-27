# Tasks: Gentle AI Agent Parity and Dialog Sizing

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1198 lines upper bound (348 PR1 + <=350 PR2A + <=350 PR2B + 150 PR3) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Catalog) → PR 2A (Persisted Maps & Custom) → PR 2B (Managed Sync & Host Guard) → PR 3 (Dialogs & Docs) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Catalog SSOT, validation, 40 base & explicit future | PR 1 (base: `main`) | `npx vitest run src/catalog.test.ts src/utils.test.ts` | N/A (domain logic only) | `src/catalog.ts`, `src/types.ts`, `src/utils.ts` |
| 2A | Persisted profile maps + legacy/config custom preservation + tests (target <400) | PR 2A (base: branch/PR1) | `npx vitest run src/profiles.test.ts` | N/A (file I/O & data mapping) | `src/profiles.ts`, `src/profiles.test.ts` |
| 2B | Managed fallback/update/bulk/activation + safeSetDialogSize + tests (target <400) | PR 2B (base: branch/PR2A) | `npx vitest run src/profiles.test.ts src/host-compat.test.ts` | N/A (file I/O & mock guard) | `src/profiles.ts`, `src/host-compat.ts`, `src/host-compat.test.ts` |
| 3 | Dialog sizing, wrap ≥80, submenus & docs | PR 3 (base: branch/PR2B) | `npx vitest run src/dialogs.test.ts` | `npm run examples` | `src/dialogs.tsx`, `docs/*`, `CHANGELOG.md` |

**Chain Boundaries & Order:** PR 1 targets `main`; PR 2A targets `branch/PR1`; PR 2B targets `branch/PR2A`; PR 3 targets `branch/PR2B`. Integrated sequentially in order PR 1 → PR 2A → PR 2B → PR 3.

## Phase 1: Catalog SSOT & Validation (Work Unit 1)

- [x] 1.1 RED: Write tests in `src/catalog.test.ts` & `src/utils.test.ts` asserting failure for T01-T03, T12-T16, T23, T24, T32, T33, T35, T36
- [x] 1.2 GREEN: Add `DialogSize`, `AgentFamily`, `CatalogEntry` in `src/types.ts`
- [x] 1.3 GREEN: Update `MANAGED_SDD_AGENT_EXCEPTIONS` and `FALLBACK_INELIGIBLE_AGENTS` with `model-audit` in `src/utils.ts`
- [x] 1.4 GREEN: Implement `BASE_CANONICAL_ORDER` (40), `isValidAgentKey`, `deriveFallbackProfileKey` (no BASE gate), `classifyFamily`, and `buildCatalogSections` in `src/catalog.ts`
- [x] 1.5 REFACTOR: Verify tests pass with `npx vitest run src/catalog.test.ts src/utils.test.ts` and `npm run typecheck`

## Phase 2A: Persisted Profile Maps & Custom Preservation (Work Unit 2A)

- [x] 2A.1 RED: Write tests in `src/profiles.test.ts` asserting failure for T04-T09, T21, T22 (flat legacy, config, modern custom preservation and top-level extras)
- [x] 2A.2 GREEN: Implement two-layer persisted profile map extraction (`extractPersistedAgentModels`, `isValidAgentKey` on read/write, top-level `extractPersistedProfileExtras`, custom preservation)
- [x] 2A.3 REFACTOR: Verify tests pass with `npx vitest run src/profiles.test.ts` and `npm run typecheck`

## Phase 2B: Managed Fallback Sync, Bulk/Activation & Host Guard (Work Unit 2B)

- [x] 2B.1 RED: Write tests in `src/profiles.test.ts` and `src/host-compat.test.ts` asserting failure for T17, T27, T28, T34
- [x] 2B.2 GREEN: Implement `safeSetDialogSize` in `src/host-compat.ts` with error swallowing and `log.warn`
- [x] 2B.3 GREEN: Implement `deriveFallbackProfileKey` fallback sync, `updateProfilePhaseModel`, bulk update filtering, and activation preservation in `src/profiles.ts`
- [x] 2B.4 REFACTOR: Verify tests pass with `npx vitest run src/profiles.test.ts src/host-compat.test.ts` and `npm run typecheck`

## Phase 3: Dialog UX Sizing, Submenus & Docs (Work Unit 3)

- [x] 3.1 RED: Write tests in `src/dialogs.test.ts` asserting failure for T10, T11, T18-T20, T25, T26, T29-T31
- [x] 3.2 GREEN: Update `src/dialogs.tsx` with tiered `safeSetDialogSize` (`xlarge`/`large`/`medium`), `__back__` reset, `wrapDisplayText` (≥80 at xlarge), `hasOwn` badge, and `CatalogEntry` submenus
- [x] 3.3 GREEN: Update `docs/dialogs.md`, `docs/compatibility.md`, and `CHANGELOG.md` with catalog parity, tiered sizing, and compat rules
- [x] 3.4 REFACTOR: Full verification with `npm test` and `npm run typecheck`

## Traceability Matrix

| Requirement / Seam | Tasks |
|---|---|
| 40 Base Catalog & Order (T01, T12, T13, T16) | 1.1, 1.4, 1.5 |
| Key Validation & Union (T02, T03, T23, T24) | 1.1, 1.4, 1.5 |
| model-audit Primacy & Fallback Ineligibility (T14, T15, T36) | 1.1, 1.3, 1.4 |
| Explicit Future Fallbacks & No Synthesis (T32, T33, T34, T35) | 1.1, 1.4, 2B.1, 2B.3 |
| Persisted Custom & Extras (T04, T05, T06, T07, T08, T09, T21, T22) | 2A.1, 2A.2, 2A.3 |
| Host Guard & Degradation (T27, T28) | 2B.1, 2B.2, 2B.4 |
| Fallback Triple & Storage (T17, T18) | 2B.1, 2B.3, 3.1, 3.2 |
| Unconfigured Badge & Assignment (T10, T11, T19, T20) | 3.1, 3.2, 3.4 |
| Tiered Sizing & Isolation (T25, T26) | 3.1, 3.2, 3.4 |
| Memory Wrap ≥80 & Sanitization (T29, T30, T31) | 3.1, 3.2, 3.4 |
| Documentation & Changelog | 3.3, 3.4 |
