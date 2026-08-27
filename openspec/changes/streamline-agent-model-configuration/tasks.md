# Tasks: Streamline Agent Model Configuration

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 350-500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Catalog/Predicates) → PR 2 (Reasoning/Persistence) → PR 3 (Dialogs/Verification) |
| Delivery strategy | auto-chain |
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

## Phase 1: Runtime Catalog and Predicates (Work Unit 1)

- [x] 1.1 RED: Write tests in `src/catalog.test.ts` for dynamic inventory discovery, canonical presentation order, reserved denylist exclusion, strict `*-fallback` suffix isolation, and hidden inactive profile entries (Req 1, 2, 3, 4, 5 / Scenarios 1.1-1.3, 2.1-2.3, 3.1-3.3, 4.1-4.2, 5.1).
- [x] 1.2 GREEN: Implement `src/types.ts`, `src/catalog.ts`, and `src/utils.ts` for `collectRuntimeAgentInventory`, denylist filtering, strict suffix classification, and `isEditablePrimaryAgent`.
- [x] 1.3 REFACTOR: Optimize catalog classification and clean order index mapping.

## Phase 2: Reasoning and Persistence (Work Unit 2)

- [x] 2.1 RED: Write tests in `src/profile-reasoning.test.ts` and `src/profiles.test.ts` for custom primary reasoning, compatibility pruning, single-version snapshots, transaction rollback on write failure, and non-interactive bulk pruning (Req 4, 7, 8, 9, 10 / Scenarios 4.1-4.2, 7.1-7.2, 8.1-8.2, 9.1-9.3, 10.1-10.2).
- [x] 2.2 GREEN: Implement `src/profile-reasoning.ts` and `src/profiles.ts` for `updateProfilePhaseModel` pruning, `updateProfileReasoningWithoutVersion`, snapshot cleanup on failure, and runtime bulk targets.
- [x] 2.3 REFACTOR: Consolidate model mutation context and error recovery helpers.

## Phase 3: Dialog Sequential Flow (Work Unit 3)

- [x] 3.1 RED: Write tests in `src/dialogs.test.ts` for sequential model→effort chaining, unsupported model return, effort cancel/back, fallback reasoning bypass, error toasts, and return targets (Req 6, 8, 9, 10 / Scenarios 6.1-6.3, 8.1-8.2, 9.1-9.3, 10.1-10.2).
- [x] 3.2 GREEN: Implement `src/dialogs.tsx` sequential navigation state machine, cancellation handling, toast notifications, and return routing.
- [x] 3.3 REFACTOR: Streamline dialog transition handlers and verify full suite with `npx vitest run`.
