# Apply Progress: TUI Profile Usability and Activation Fix

**Mode**: Strict TDD
**Delivery**: stacked-to-main — PR 3 work-unit slice, under the 400 authored source/test line budget.
**Current work unit**: Unit 3 — Activation & Persistence.

## Completed Tasks

- [x] 1.1–1.3 Catalog and eligibility.
- [x] 2.1–2.3 Dialog sizing and copy.
- [x] Unit 2 corrective smoke completion.
- [x] 3.1 RED: Added definition-discovery, partial-activation warning, auxiliary reasoning, and active-profile marker tests.
- [x] 3.2 GREEN: Added complete-definition discovery, best-effort activation, exact missing-definition warnings, and persisted active-marker selection.
- [x] 3.3 REFACTOR: Extracted pure activation and profile-list helpers; preserved declarative disk links and existing fallback gates.
- [x] 4.1–4.3 External resolver.
- [x] Unit 4 corrective smoke completion.
- [x] Baseline reconciliation: reconciled approved model-audit fallback behavior before Unit 3.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 3.1 | `src/profiles.test.ts`, `src/profile-reasoning.test.ts`, `src/dialogs.test.ts` | Unit/integration mocks | 223/223 passed | 3 new failures; 224/227 passed | 227/227 passed | 228/228: exact/stale/traversal marker cases and DialogSelect `current` | Extracted pure discovery and row helpers; 228/228 passed |
| 3.2 | Same | Integration mocks | 223/223 passed | Discovery and active-marker contracts failed before implementation | 227/227 passed | Auxiliary model+level, missing definition, exact filename, stale/traversal cases | Preserved disk declarative links and existing fallback reconciliation |
| 3.3 | Same | Unit/integration mocks | 223/223 passed | Approval coverage captured existing fallback behavior | 228/228 passed | Existing T34 covers explicit model-audit fallback and auxiliary no-fallback behavior | Helpers are small and pure where possible |

## Work Unit Evidence — Unit 3

| Evidence | Result |
|---|---|
| Focused test command and exact result | `npm test -- src/profiles.test.ts src/profile-reasoning.test.ts src/dialogs.test.ts` — baseline exit 0, 223/223 passed; RED exit 1, 224/227 passed; GREEN exit 0, 228/228 passed. |
| Runtime harness command/scenario and exact result | Vitest mocked activation path: disk config plus runtime-only complete auxiliary definition, missing profile agent, `global.config.update`, warning toast, and DialogSelect `current`; exit 0, 228/228 passed. |
| Typecheck | `npm run typecheck` — exit 0. |
| Build artifact | `npm run build` — exit 0; rebuilt `dist/tui.js` (142.63 KB). |
| Rollback boundary | Revert Unit 3 hunks in `src/profiles.ts`, `src/dialogs.tsx`, and their three focused test files; restore the prior `dist/tui.js` if needed. |

## Behavior Delivered

- Activation clones only existing non-array definitions from disk config or host runtime config; it never creates an agent from a profile model string.
- Valid profile agents activate while unresolved names produce the exact warning `Missing agent definitions: <names>` in profile order.
- `compaction`, `summary`, and `title` preserve models and reasoning levels when host definitions exist; existing fallback gating does not create or synchronize their fallback agents.
- Explicit `model-audit` fallback reconciliation remains allowed by the existing contract.
- The profile list first maps hydrated `activeProfile()?.profileName` to an exact existing `.json` file, accepting names with or without `.json`; stale or traversal-like names fall back to configuration detection. Active rows show `✓`, `✓ Activo`, and DialogSelect `current`.

## Remaining Tasks

- [ ] 5.1 Run full suite validation: `npm run typecheck && npm test && npm run build`.
- [ ] 5.2 Restart OpenCode and execute the manual profile activation smoke test.

## Status

12/15 planned tasks complete. Ready for independent SDD verification after Unit 5 validation and manual smoke evidence.
