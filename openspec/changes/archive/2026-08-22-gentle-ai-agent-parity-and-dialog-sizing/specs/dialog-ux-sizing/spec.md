# dialog-ux-sizing Specification

## Purpose
Eliminate clipped dialogs (truncated IDs, cramped 21-row lists) via tiered sizing per screen, guarded host degradation, isolated size state, and wider memory wrap leveraging `xlarge`.

## Requirements

### Requirement: Tiered Sizing and Per-Screen State Isolation

**User Story:** As a user I want roomy pickers/details and compact confirms so long IDs stay readable.

The system MUST invoke `safeSetDialogSize(api,size)` on entry of every managed dialog and MUST assign: `xlarge` → Profile Detail Hub (`showProfileDetail`), Model Pickers (`showModelPickerForAgent`, `showModelPickerForBulkProfilePhases`), Memory Detail (`showMemoryDetail`); `large` → Submenus (Primary/Reasoning/Fallback), Bulk Actions Menu, Provider pickers, Profile Versions List/Preview, Project Memories Menu; `medium` → Prompts/Confirms (`showCreateProfile`, `showRenameProfile`, `showDeleteProfile`, `showConfirmBulkProfileOverride`, `showConfirmRestoreProfileVersion`, activation/delete-memory confirms) and compact menus. Each screen MUST set its own size on `__back__`/`onCancel` to prevent leak.

#### Scenario: xlarge entry
- GIVEN user opens Profile Detail
- WHEN `showProfileDetail` renders
- THEN `safeSetDialogSize(api,"xlarge")` called before `DialogSelect`

#### Scenario: Isolation on back
- GIVEN Primary submenu (`large`) returns to hub
- WHEN hub renders
- THEN hub sets `xlarge` (not residual `large`)

#### Scenario: medium confirm
- GIVEN delete profile triggered
- WHEN confirm renders
- THEN `safeSetDialogSize(api,"medium")` called

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | Each tier calls expected size | Spy 1/call |
| Edge | 5× rapid back/forth keeps size | No leak |
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
| Happy | Absent API → no crash | Guarded |
| Edge | `api.ui.dialog` undefined | Handled |
| Error | Throw → still opens | No rejection |
| Migration | Old hosts without `setSize` work | Compat |
| Success | All dialogs via guard | Coverage |

### Requirement: Memory Detail Wider Wrap

**User Story:** As a user I want memory detail to use `xlarge` width without 52-char wrap.

The system MUST NOT hard-wrap at 52 cols in `showMemoryDetail`; at `xlarge` it MUST wrap at ≥80 (adaptive) and MUST preserve blank lines and sanitized markdown. Long lines MUST NOT be ellipsis-truncated. `wrapDisplayText` MUST accept dynamic `max` (≥80 for xlarge) or derive from size.

#### Scenario: Wider wrap
- GIVEN 120-char line
- WHEN `showMemoryDetail` at `xlarge`
- THEN wraps at ≥80, fewer lines than 52

#### Scenario: No truncation
- GIVEN 200-char line
- WHEN detail renders
- THEN full text wrapped, no `…`

#### Scenario: Sanitized wrap
- GIVEN content `` `code` **bold** → ``
- WHEN wrapped at xlarge
- THEN sanitized `code bold ->` wraps at ≥80

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | ≥80 wrap at xlarge | Line count ↓ |
| Edge | Empty lines as single space | No collapse |
| Error | Word > max as single line | No crash |
| Migration | Old 52 snapshots updated | Delta |
| Success | Long IDs visible | Visual |
