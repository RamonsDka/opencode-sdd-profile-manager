# dialog-ux-sizing Specification

## Purpose
Eliminate clipped dialogs (truncated IDs, cramped 21-row lists) via tiered sizing per screen, guarded host degradation, isolated size state, and wider memory wrap leveraging `xlarge`.

## Requirements

### Requirement: Tiered Sizing and Per-Screen State Isolation

**User Story:** As user I want every dialog sized and back/cancel to reset.

The system MUST call `safeSetDialogSize(api,size)` on entry of all 23 dialogs per tier map and MUST reset on every `__back__`/`onCancel`. Map: `xlarge`=showProfileDetail, showModelPicker*2, showMemoryDetail; `large`=Primary/Reasoning/Fallback submenus, Bulk Actions, Provider pickers x2, Versions List/Preview, Project Memories, showReasoningEffortPicker; `medium`=showProfilesMenu, showProfileList, showCreateProfile, showRenameProfile, showDeleteProfile, showConfirmBulkProfileOverride, showConfirmRestoreProfileVersion, handleActivateProfile confirm, showDeleteMemory. Host clamps <80.
(Previously: only 2 entries had runtime spies; isolation only same-tier loop.)

#### Scenario: 23 entry points table-driven
- GIVEN spy `api.ui.dialog.setSize` per map
- WHEN each of 23 `show*` called
- THEN spy called with tier before `replace`

#### Scenario: Cross-tier xlarge->large->medium resets
- GIVEN hub `xlarge`->submenu `large`->confirm `medium`
- WHEN navigating via `__back__`/`onCancel`
- THEN each target re-calls its tier; 5x loop no leak

**Checklist**
| Cat | Criterion | Signal |
|---|---|---|
| Happy | 23/23 via `it.each` | Spy |
| Edge | 5x cross-tier no leak | Isolation |
| Happy | Each tier calls expected size | Spy 1/call |
| Edge | 5 rapid back/forth keeps size | No leak |
| Error | Size failure does not block dialog | Still renders |
| Migration | Pre-tier code degrades | No break |
| Success | Picker ID untruncated | Visual |

### Requirement: Safe Degradation and Narrow-Terminal Clamp

**User Story:** As a user on old host or narrow terminal I want dialogs to render without crash.

The system MUST guard via `safeSetDialogSize(api,size)` and MUST NOT throw if `api.ui.dialog.setSize` is missing/undefined or throws; it MUST degrade to host default. It MUST rely on host clamp for <80 cols and MUST NOT add custom overflow.

`safeSetDialogSize` MUST catch sync errors, handle missing `dialog`, and return without side effects.

#### Scenario: Missing API
- GIVEN `api.ui.dialog.setSize` undefined
- WHEN any tiered dialog opens
- THEN no exception; dialog at default

#### Scenario: Narrow terminal
- GIVEN 70-col terminal, `xlarge` requested
- WHEN dialog renders
- THEN host clamps; no crash

#### Scenario: Throwing host
- GIVEN `setSize` throws
- WHEN guarded call runs
- THEN swallowed/logged, dialog continues

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | Absent API -> no crash | Guarded |
| Edge | `api.ui.dialog` undefined | Handled |
| Error | Throw -> still opens | No rejection |
| Migration | Old hosts without `setSize` work | Compat |
| Success | All dialogs via guard | Coverage |

### Requirement: Memory Detail Wider Wrap

**User Story:** As a user I want memory detail to use `xlarge` width without 52-char wrap.

The system MUST NOT hard-wrap at 52 cols in `showMemoryDetail`; at `xlarge` it MUST wrap at >=80 (adaptive) and MUST preserve blank lines and sanitized markdown. Long lines MUST NOT be ellipsis-truncated. `wrapDisplayText` MUST accept dynamic `max` (=80 for xlarge) or derive from size.

#### Scenario: Wider wrap
- GIVEN 120-char line
- WHEN `showMemoryDetail` at `xlarge`
- THEN wraps at >=80, fewer lines than 52

#### Scenario: No truncation
- GIVEN 200-char line
- WHEN detail renders
- THEN full text wrapped, no `.`

#### Scenario: Sanitized wrap
- GIVEN content `` `code` **bold** -> ``
- WHEN wrapped at xlarge
- THEN sanitized `code bold ->` wraps at >=80

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | >=80 wrap at xlarge | Line count |
| Edge | Empty lines as single space | No collapse |
| Error | Word > max as single line | No crash |
| Migration | Old 52 snapshots updated | Delta |
| Success | Long IDs visible | Visual |

### Requirement: Dialog Documentation and Manual Evidence

**User Story:** As maintainer I want tiers and compat matrix discoverable.

The system MUST provide `docs/dialogs.md` (tier table section 6, wrap >=80) and `docs/compatibility.md` (host matrix) linked from `README.md`. Manual <80-col evidence MUST be non-mutating note and MUST NOT mutate source.

#### Scenario: Docs exist and linked
- GIVEN repo after change
- WHEN inspecting `docs/dialogs.md`, `docs/compatibility.md`, `README.md`
- THEN tables present and links resolve

**Checklist**
| Cat | Criterion | Signal |
|---|---|---|
| Success | Tables+links; manual note <80, no mutate | File exists |
