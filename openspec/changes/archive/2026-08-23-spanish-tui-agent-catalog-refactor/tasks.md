# Tasks: Spanish TUI Agent Catalog Refactor

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 550-750 lines across 16 files |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Catalog/Aliases) → PR 2 (Effort/Persistence) → PR 3 (Spanish UI/Sizing) → PR 4 (Sync/Regression) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Runtime catalog discovery, denylist, fallback isolation, canonical ordering | PR 1 (base: main) | `npx vitest run src/catalog.test.ts` | N/A: pure catalog data layer | `src/types.ts`, `src/catalog.ts`, `src/utils.ts`, `src/catalog.test.ts` |
| 2 | Editable custom primaries, effort pruning, single-version transaction, bulk prune | PR 2 (base: PR 1) | `npx vitest run src/profile-reasoning.test.ts src/profiles.test.ts` | N/A: persistence transaction unit | `src/profile-reasoning.ts`, `src/profiles.ts`, `src/profile-reasoning.test.ts`, `src/profiles.test.ts` |
| 3 | Sequential model→effort UI flow, cancellation, fallback bypass, return targets | PR 3 (base: PR 2) | `npx vitest run src/dialogs.test.ts` | `opencode start` interactive TUI verification | `src/dialogs.tsx`, `src/dialogs.test.ts` |

## Phase 1: Catalog SSOT, Eligibility & Aliases (Work Unit 1)

- [x] 1.1 RED: Write tests in `src/catalog.test.ts` for dynamic inventory discovery, canonical presentation order, reserved denylist exclusion, strict `*-fallback` suffix isolation, and hidden inactive profile entries (Req 1, 2, 3, 4, 5 / Scenarios 1.1-1.3, 2.1-2.3, 3.1-3.3, 4.1-4.2, 5.1).
- [x] 1.2 GREEN: Implement `src/types.ts`, `src/catalog.ts`, and `src/utils.ts` for `collectRuntimeAgentInventory`, denylist filtering, strict suffix classification, and `isEditablePrimaryAgent`.
- [x] 1.3 REFACTOR: Optimize catalog classification and clean order index mapping.

## Phase 2: Transactional Effort Flow & Persistence (Work Unit 2)

- [x] 2.1 RED: Write tests in `src/profile-reasoning.test.ts` and `src/profiles.test.ts` for custom primary reasoning, compatibility pruning, single-version snapshots, transaction rollback on write failure, and non-interactive bulk pruning (Req 4, 7, 8, 9, 10 / Scenarios 4.1-4.2, 7.1-7.2, 8.1-8.2, 9.1-9.3, 10.1-10.2).
- [x] 2.2 GREEN: Implement `src/profile-reasoning.ts` and `src/profiles.ts` for `updateProfilePhaseModel` pruning, `updateProfileReasoningWithoutVersion`, snapshot cleanup on failure, and runtime bulk targets.
- [x] 2.3 REFACTOR: Consolidate model mutation context and error recovery helpers.

## Phase 3: Spanish UI, Separators & Viewport Sizing (Work Unit 3)

- [x] 3.1 RED: Write tests in `src/dialogs.test.ts` for sequential model→effort chaining, unsupported model return, effort cancel/back, fallback reasoning bypass, error toasts, and return targets (Req 6, 8, 9, 10 / Scenarios 6.1-6.3, 8.1-8.2, 9.1-9.3, 10.1-10.2).
- [x] 3.2 GREEN: Implement `src/dialogs.tsx` sequential navigation state machine, cancellation handling, toast notifications, and return routing.
- [x] 3.3 REFACTOR: Streamline dialog transition handlers and verify full suite with `npx vitest run`.

## Phase 4: Runtime Synchronization, Normalization & Full Verification (Work Unit 4)

- [x] 4.1 RED: Added owned regressions for complete fallback-intent persistence, runtime eligibility filtering, idempotent legacy/custom normalization, alias preservation, and protected fallback-policy literals.
- [x] 4.2 GREEN: Extended the existing fallback synchronization boundary to accept explicit runtime-sync-eligible catalog assignments while preserving stored-only intent and existing ineligible runtime entries; retained non-destructive profile normalization behavior.
- [x] 4.3 REFACTOR: Centralized fallback override/base classification helpers and ran focused, full, typecheck, runtime example, and diff-check evidence.

## Unit 4 Apply Progress

- Status: complete for assigned tasks 4.1-4.3 only; no verify/archive executed.
- Delivery: stacked-to-main, PR/slice 4 of 4; exact boundary is runtime fallback synchronization, normalization regression coverage, and full regression evidence.
- Authored line accounting: Unit 4 changes are measured independently from inherited dirty changes; repository-wide diff statistics include accumulated Unit 1-3 and unrelated hunks and are not a Unit 4 measure. No reset was requested or executed.
- Rollback boundary: revert only Unit 4-authored hunks in `src/profiles.ts`, `src/profiles.test.ts`, and `scripts/ensure-orchestrator-fallback-policy.test.ts`; preserve inherited Unit 1-3 changes, unrelated dirty hunks, and profile data.

## Unit 4 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1 | `src/profiles.test.ts`, `scripts/ensure-orchestrator-fallback-policy.test.ts` | Unit + integration-style fixture tests | ✅ focused baseline 140/140 | ✅ Added fallback persistence/sync, normalization, alias, and protected-literal assertions; initial run failed 3/3 new cases | ✅ Focused run exit 0; 147/147 passed | ✅ 24 fallback intents, explicit runtime-eligible sync, stored-only exclusions, existing ineligible preservation, legacy/custom normalization, alias and policy cases | ✅ Owner-local assertions kept separate from runtime sync |
| 4.2 | `src/profiles.ts` with `src/profiles.test.ts` | Integration-style pure-config boundary | ✅ RED suite | ✅ Runtime-eligible catalog fallback and stored-only preservation cases failed before boundary update | ✅ Focused run exit 0; 147/147 passed | ✅ Canonical managed, explicit runtime-eligible, reserved/stored-only, and existing ineligible fallback paths | ✅ Extracted `hasExplicitFallbackOverride` and `isFallbackSyncBaseAgent` |
| 4.3 | Same owners plus full suite | Unit + integration-style regression | ✅ 147/147 focused | ✅ Approval assertions protected previous behavior | ✅ Full run exit 0; 12 files and 358 tests passed | ✅ Focused, catalog/orchestrator/util regression, full suite, typecheck, examples, and diff-check | ✅ No unrelated behavior or tracker edits |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `npx vitest run src/profiles.test.ts scripts/ensure-orchestrator-fallback-policy.test.ts` — exit 0; Test Files 2 passed; Tests 147 passed. |
| Broader focused regression | `npx vitest run src/profiles.test.ts src/utils.test.ts src/catalog.test.ts src/orchestrator.test.ts scripts/ensure-orchestrator-fallback-policy.test.ts` — exit 0; Test Files 5 passed; Tests 201 passed. |
| Full test command and exact result | `npm test` — exit 0; Test Files 12 passed; Tests 358 passed. |
| Runtime harness command/scenario and exact result | `npm run examples` — exit 0; inline prompt injection, external file prompt injection, and profile fixtures readability passed (3/3). |
| Typecheck | `npm run typecheck` — exit 0; no TypeScript errors. |
| Diff/whitespace check | `git diff --check` — exit 0; no whitespace errors (line-ending warnings only). |
| Rollback boundary | Unit 4-authored hunks only in `src/profiles.ts`, `src/profiles.test.ts`, and `scripts/ensure-orchestrator-fallback-policy.test.ts`; preserve inherited dirty changes, tracker, commits, push, PR, and archive state. |

## Protected-Literal Audit

- `sdd-ORCHETATOR`: retained as persisted catalog intent and excluded from runtime fallback synchronization.
- `fallback`: retained in profile keys, fallback values, and policy assertions without translation or renaming.
- `high`: retained in reasoning/profile-policy fixtures and existing behavior.
- Agent names: exact agent identifiers remain unchanged; only synchronization eligibility behavior was adjusted.

## Deviations from Design

None material — implementation uses the existing profile normalization and synchronization boundary, adds explicit runtime-eligible catalog handling, preserves stored-only assignments, and introduces no new framework or unsupported runtime API.

## Issues Found

None blocking.

## Remaining Tasks

- Parent-controlled `sdd-verify`; this apply agent did not launch verification.
