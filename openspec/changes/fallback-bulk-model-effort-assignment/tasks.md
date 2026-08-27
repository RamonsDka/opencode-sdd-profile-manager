# Tasks: Fallback Bulk Model and Effort Assignment

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 450–650 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (base tracker) → PR 2 (base PR 1) → PR 3 (base PR 2) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Persistence normalization & runtime sync | PR 1 (base tracker) | `npx vitest run src/profile-reasoning.test.ts src/profiles.test.ts` | Cloned config & temp directories in tests | `src/types.ts`, `src/profile-reasoning.ts`, `src/profiles.ts` |
| 2 | Pure engine & catalog 19 fallback projection | PR 2 (base PR 1) | `npx vitest run src/catalog.test.ts src/profiles.test.ts` | Cloned catalog & synthetic profiles | `src/catalog.ts`, target builder in `src/profiles.ts` |
| 3 | Dialogs individual & bulk staged flow | PR 3 (base PR 2) | `npx vitest run src/dialogs.test.ts` | Mocked ink/dialog terminal harness | `src/dialogs.tsx` |

## Phase 1: Persistence Normalization & Runtime Sync (PR 1)

- [x] 1.1 [RED] Add failing tests in `src/profile-reasoning.test.ts` and `src/profiles.test.ts` for relation-aware fallback config pruning/preservation and fallback model+effort runtime sync.
- [x] 1.2 [GREEN] Update `src/types.ts` and `src/profile-reasoning.ts` to validate/preserve `${primary}-fallback` configs and support `provider-default` effort clearing.
- [x] 1.3 [GREEN] Update `syncSddFallbackAgents` in `src/profiles.ts` to resolve fallback model and apply/clear suffixed reasoning effort.
- [x] 1.4 [REFACTOR] Clean up reasoning helper signatures and verify `npx vitest run src/profile-reasoning.test.ts src/profiles.test.ts`.

## Phase 2: Engine & Catalog Fallback Projection (PR 2)

- [x] 2.1 [RED] Add failing tests in `src/catalog.test.ts` and `src/profiles.test.ts` for 19 canonical fallback targets, unconfigured inclusions, target-aware bulk builder, and snapshot/compensation.
- [x] 2.2 [GREEN] Update `collectConfigurableProfileTargets` in `src/catalog.ts` to support `target="fallback"` with 19 canonical items and owner validation.
- [x] 2.3 [GREEN] Update `updateProfileWithBulkOverwrite` and version snapshot in `src/profiles.ts` with `target="fallback"` support and atomic compensation.
- [x] 2.4 [REFACTOR] Consolidate projection logic and verify `npx vitest run src/catalog.test.ts src/profiles.test.ts`.

## Phase 3: Dialogs Individual & Bulk Flow (PR 3)

- [x] 3.1 [RED] Add failing tests in `src/dialogs.test.ts` for fallback bulk action, individual fallback model->effort flow, zero I/O on cancel, and toast format.
- [x] 3.2 [GREEN] Update `src/dialogs.tsx` to add the second bulk action ("Asignar modelo y esfuerzo a fallbacks..."), shared staged picker pipeline, and combined toast.
- [x] 3.3 [GREEN] Update `src/dialogs.tsx` individual fallback selection to prompt for reasoning effort and commit atomically.
- [x] 3.4 [REFACTOR] Unify dialog state transitions and verify `npx vitest run src/dialogs.test.ts`.

> Recovery verification: Unit 3 checkboxes were previously premature. A valid RED in `src/profiles.test.ts` was fixed and final focused evidence is green before retaining these completions.

## Phase 4: Full Integration & Verification

- [x] 4.1 Run full unit test suite: `npm test`.
- [x] 4.2 Run static typecheck: `npm run typecheck`.
- [x] 4.3 Run build compilation: `npm run build`.
- [x] 4.4 Run test coverage check: `npm run test:coverage`.
