# Tasks: Profile Model and Bulk Effort Corrections

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 500-750 lines |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (base: tracker) → PR 2 (base: PR 1) → PR 3 (base: PR 2) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Canonical orchestrator mutation, alias pruning, and snapshot compensation | PR 1 (base: tracker) | `npx vitest run src/orchestrator.test.ts src/profiles.test.ts` | N/A: pure persistence suite | Revert `src/profiles.ts` alias boundary |
| 2 | Pure bulk overwrite engine, catalog inventory targets, and effort defaulting | PR 2 (base: PR 1) | `npx vitest run src/profiles.test.ts` | N/A: pure builder suite | Revert `buildBulkProfileOverwrite` in `src/profiles.ts` |
| 3 | Single bulk action dialog, cancellation safety, joint toast, and hub cleanup | PR 3 (base: PR 2) | `npx vitest run src/dialogs.test.ts && npm run typecheck` | `node ./scripts/run-examples.ts` | Revert `src/dialogs.tsx` flow and menu entries |

## Phase 1: Canonical Orchestrator Mutation & Persistence Foundation

- [x] 1.1 RED: Add tests in `src/orchestrator.test.ts` and `src/profiles.test.ts` proving failure for discordant legacy aliases (`sdd-ORCHETATOR`), individual effort cancellation, snapshot failure abort, and rollback compensation.
- [x] 1.2 GREEN: Implement canonical orchestrator alias cleanup, pending model commit, and snapshot-backed atomic writes in `src/profiles.ts` and `src/types.ts`.
- [x] 1.3 REFACTOR: Clean up mutation boundaries and verify with `npx vitest run src/orchestrator.test.ts src/profiles.test.ts`.

## Phase 2: Configurable Catalog Projection & Pure Bulk Overwrite Engine

- [x] 2.1 RED: Add tests in `src/profiles.test.ts` proving failure for catalog-derived target projection, internal agent exclusion, full profile overwrite, and unsupported-effort `provider-default` persistence.
- [x] 2.2 GREEN: Implement `buildBulkProfileOverwrite` in `src/profiles.ts` and expose configurable target inventory projection in `src/catalog.ts`.
- [x] 2.3 REFACTOR: Consolidate target deduplication and verify with `npx vitest run src/profiles.test.ts`.

## Phase 3: Dialog Flows, Feedback & Menu Cleanup

- [x] 3.1 RED: Add tests in `src/dialogs.test.ts` proving failure for single Spanish bulk action, sequential model→effort selection, cancellation without I/O, combined model+effort toast, and absent `Versiones`/`Agentes`.
- [x] 3.2 GREEN: Update `src/dialogs.tsx` to mount the single bulk action, handle staged cancellation, show combined toast, and remove `Versiones` and `Agentes` from profile detail.
- [x] 3.3 REFACTOR: Refactor dialog handlers and verify with `npx vitest run src/dialogs.test.ts`.

Recovery verification (2026-08-24): Unit 3 was revalidated in a fresh primary retry; final focused, dependency, typecheck, and runtime-harness evidence is recorded in `apply-progress`.

## Phase 4: Full Suite & Build Verification

- [x] 4.1 Run full test suite via `npm test`.
- [x] 4.2 Run TypeScript checks via `npm run typecheck`.
- [x] 4.3 Run build packaging via `npm run build`.
