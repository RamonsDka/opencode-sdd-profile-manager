# Delta for dialog-ux-sizing

## MODIFIED Requirements

### Requirement: Tiered Sizing and Per-Screen State Isolation

**User Story:** As user I want every dialog sized and back/cancel to reset.

The system MUST call `safeSetDialogSize(api,size)` on entry of all 23 dialogs per tier map and MUST reset on every `__back__`/`onCancel`. Map: `xlarge`=showProfileDetail, showModelPicker*2, showMemoryDetail; `large`=Primary/Reasoning/Fallback submenus, Bulk Actions, Provider pickers×2, Versions List/Preview, Project Memories, showReasoningEffortPicker; `medium`=showProfilesMenu, showProfileList, showCreateProfile, showRenameProfile, showDeleteProfile, showConfirmBulkProfileOverride, showConfirmRestoreProfileVersion, handleActivateProfile confirm, showDeleteMemory. Host clamps <80.
(Previously: only 2 entries had runtime spies; isolation only same-tier loop.)

#### Scenario: 23 entry points table-driven
- GIVEN spy `api.ui.dialog.setSize` per map
- WHEN each of 23 `show*` called
- THEN spy called with tier before `replace`

#### Scenario: Cross-tier xlarge↔large↔medium resets
- GIVEN hub `xlarge`→submenu `large`→confirm `medium`
- WHEN navigating via `__back__`/`onCancel`
- THEN each target re-calls its tier; 5× loop no leak

**Checklist**
| Cat | Criterion | Signal |
|---|---|---|
| Happy | 23/23 via `it.each` | Spy |
| Edge | 5× cross-tier no leak | Isolation |

## ADDED Requirements

### Requirement: Dialog Documentation and Manual Evidence

**User Story:** As maintainer I want tiers and compat matrix discoverable.

The system MUST provide `docs/dialogs.md` (tier table §6, wrap ≥80) and `docs/compatibility.md` (host matrix) linked from `README.md`. Manual <80-col evidence MUST be non-mutating note and MUST NOT mutate source.

#### Scenario: Docs exist and linked
- GIVEN repo after change
- WHEN inspecting `docs/dialogs.md`, `docs/compatibility.md`, `README.md`
- THEN tables present and links resolve

**Checklist**
| Cat | Criterion | Signal |
|---|---|---|
| Success | Tables+links; manual note <80, no mutate | File exists |
