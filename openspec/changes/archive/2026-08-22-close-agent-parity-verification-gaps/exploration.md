## Exploration: close-agent-parity-verification-gaps

### Current State
The previous change `gentle-ai-agent-parity-and-dialog-sizing` implemented Gentle AI 2.4.0 agent parity (40 base agents), tiered dialog sizing (`xlarge`, `large`, `medium`), host degradation guards, and adaptive wrap (>=80) for memory detail. All 282 unit tests, typechecking, and examples pass. However, an independent SDD verification audit resulted in a `FAIL` verdict due to 1 blocker and 2 critical findings:
1. **Critical C1/C2**: Runtime tests for tiered sizing only covered `showProfilesMenu` and `showProfileList` (`medium`), leaving `showProfileDetail` (`xlarge`), submenus (`large`), and confirm dialogs (`medium`) untested at runtime despite static implementation.
2. **Warning W1**: Canonical fallback sequence in `src/catalog.test.ts` only asserted count (19) and first/last elements, not the full 19-element sequence.
3. **Warning W2**: Dialog size isolation on back navigation (`T26`) only tested repeated loops of the same menu, omitting cross-tier transitions (`xlarge` <-> `large` <-> `medium`).
4. **Warning W4**: In `src/profiles.ts`, `syncSddFallbackAgents` automatically synthesizes fallback agent configs (e.g. `sdd-future-fallback`) for any dynamic primary agent upon profile activation, violating the end-to-end ADR-11 explicit-only fallback gate.
5. **Warning W5**: Task 3.3 in the previous change referenced `docs/dialogs.md` and `docs/compatibility.md` which were omitted in favor of brief `README.md` and `CHANGELOG.md` notes, leaving the Design §13 sizing tier table and compatibility matrix undelivered.

### Affected Areas
- `src/profiles.ts` — `syncSddFallbackAgents`: needs explicit-only check so dynamic/future agents without explicit fallback entries do not synthesize shadow fallback configs upon activation.
- `src/dialogs.test.ts` — `T25` and `T26`: add parameterized runtime sizing checks across all tiers (`xlarge`, `large`, `medium`) and cross-tier back navigation isolation.
- `src/catalog.test.ts` — `T13`: assert the exact 19-element canonical fallback sequence.
- `src/profiles.test.ts` — `T34` / activation suite: add end-to-end tests verifying no synthesis of fallbacks when activating profiles containing dynamic primaries without explicit fallback definitions.
- `docs/dialogs.md` — New doc delivering the Design §13 dialog sizing tier reference table, adaptive wrap, and sizing lifecycle.
- `docs/compatibility.md` — New doc delivering the host compatibility matrix (`api.ui.dialog.setSize` support, clamp behavior, degradation).

### Approaches

1. **Approach 1: Targeted Surgical Amend (Single-slice <= 400 lines)**
   - Implement the explicit-only gate in `syncSddFallbackAgents` (`src/profiles.ts`).
   - Expand unit test assertions in `src/dialogs.test.ts`, `src/catalog.test.ts`, and `src/profiles.test.ts`.
   - Create `docs/dialogs.md` and `docs/compatibility.md` with tier table and host compatibility matrix.
   - Pros: Minimal diff (~250 lines total), tightly bounded, completely resolves all 1 blocker, 2 criticals, and 5 warnings in a single reviewable unit.
   - Cons: None.
   - Effort: Low.

2. **Approach 2: Two-stage Chained PRs**
   - PR 1: Functional fix for `syncSddFallbackAgents` + complete test suites (`src/profiles.ts`, `src/dialogs.test.ts`, `src/catalog.test.ts`, `src/profiles.test.ts`). (~150 lines)
   - PR 2: Documentation files (`docs/dialogs.md`, `docs/compatibility.md`) and evidence notes. (~100 lines)
   - Pros: Strict separation between code/tests and documentation.
   - Cons: Unnecessary orchestration overhead given total lines is well within the 400-line budget.
   - Effort: Medium.

### Recommendation
Adopt **Approach 1 (Targeted Surgical Amend)**. The total change volume across tests, one helper gate, and documentation is approximately 220-275 lines, well below the 400-line review budget. It directly addresses the verification gaps without introducing architectural complexity or side effects.

### Root Cause Analysis

1. **Gap 1 (Runtime tests of tiers)**:
   - *Root Cause*: `src/dialogs.test.ts` parameterized `it.each` in `T25` only listed two functions (`showProfilesMenu`, `showProfileList`).
   - *Fix*: Expand `T25` test suite to assert `api.ui.dialog.setSize` across `showProfileDetail` (`xlarge`), the three submenus (`large`), and confirm dialogs (`medium`).

2. **Gap 2 (Isolation & back navigation reset)**:
   - *Root Cause*: `T26` only looped `showProfilesMenu` without exercising transitions between different tiers.
   - *Fix*: Add tests simulating navigation flow from Hub (`xlarge`) -> Submenu (`large`) -> Back (`xlarge`) -> Confirm (`medium`) -> Cancel/Back (`xlarge`), verifying `setSize` is called with the expected tier on each transition.

3. **Gap 3 (Full 19 fallback canonical sequence)**:
   - *Root Cause*: `catalog.test.ts` only asserted count, first, and last elements.
   - *Fix*: Add an exact array equality check for all 19 elements against the canonical TUI sequence in `BASE_CANONICAL_ORDER`.

4. **Gap 4 (Explicit-only fallback activation gate)**:
   - *Root Cause*: `syncSddFallbackAgents` in `src/profiles.ts` iterated over all fallback-eligible primaries in `nextConfig.agent` (including dynamic ones like `sdd-future`) and defaulted the fallback model to `baseConfig.model`.
   - *Fix*: In `syncSddFallbackAgents`, only synthesize/default fallback configuration if the base agent is one of the 19 canonical base fallbacks (in `BASE_CANONICAL_ORDER`), or if `fallbackModels[baseAgentName]` was explicitly provided, or if the fallback config already existed in `currentConfig.agent`.

5. **Gap 5 (Documentation & task reconciliation)**:
   - *Root Cause*: Task 3.3 named nonexistent doc files, causing an undocumented substitution during apply.
   - *Fix*: Deliver `docs/dialogs.md` (tier table, wrap rules) and `docs/compatibility.md` (host matrix, degradation) to satisfy Design §13 cleanly.

### Minimal RED Tests

1. `src/dialogs.test.ts`:
   - `it.each([['showProfileDetail', ..., 'xlarge'], ['showProfileDetailSubmenuPrimary', ..., 'large'], ...])` asserting `api.ui.dialog.setSize`.
   - `it('resets dialog size when navigating between xlarge hub, large submenus, and medium confirms')`.
2. `src/catalog.test.ts`:
   - `it('matches the exact 19-element canonical fallback sequence in order')`.
3. `src/profiles.test.ts`:
   - `it('does not synthesize fallback for dynamic primary agent when activating profile with only primary model')`.

### Functional vs Test/Docs Classification
- **Functional code change**: YES, exactly 1 function (`syncSddFallbackAgents` in `src/profiles.ts`, ~10 lines).
- **Test-only changes**: YES, across `src/dialogs.test.ts`, `src/catalog.test.ts`, and `src/profiles.test.ts`.
- **Docs changes**: YES, `docs/dialogs.md` and `docs/compatibility.md`.

### Slices Breakdown (<= 400 lines)
- **Slice 1 (All-in-One)**:
  - `src/profiles.ts` (~10 lines)
  - `src/dialogs.test.ts` (~60 lines)
  - `src/catalog.test.ts` (~30 lines)
  - `src/profiles.test.ts` (~30 lines)
  - `docs/dialogs.md` (~60 lines)
  - `docs/compatibility.md` (~50 lines)
  - Total: ~240 lines (Budget: 400 lines).

### Risks
- **Risk 1 (Regression on standard 19 base fallbacks)**: If the gate condition in `syncSddFallbackAgents` is too restrictive, standard SDD fallback synchronization could be disabled.
  - *Mitigation*: Unit test explicitly verifies that all 19 standard base agents still receive fallback defaults when activating a profile without explicit fallback overrides.
- **Risk 2 (Documentation drift)**: Creating new docs could drift if not linked or referenced.
  - *Mitigation*: Keep docs concise, focused on reference tables (Design §13), and cross-link from `README.md`.

### Ready for Proposal
Yes. The 5 verification gaps are clearly identified, root causes pinpointed, minimal RED tests formulated, and the solution fits within a single <=400-line reviewable unit.
