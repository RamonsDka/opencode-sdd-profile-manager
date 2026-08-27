# spanish-tui-agent-catalog Specification

## Purpose

Define observable requirements and acceptance criteria for the Spanish TUI catalog, grouping, reasoning effort flow, profile migration, and runtime-safe fallback synchronization.

## User Stories

- **As an operator**, I want a Spanish TUI with 24 grouped agents to configure primary and fallback assignments symmetrically.
- **As an operator**, I want reasoning effort prompts after every model selection to explicitly confirm effort.
- **As an admin**, I want full fallback intent persisted without invalid runtime registrations.

## Requirements & Scenarios

### Requirement: Grouped 24-Agent Symmetrical Catalog

The TUI MUST display exactly 24 agents in five sequential groups separated by visible, unselectable, actionless divider rows. Primary and fallback menus MUST share identical ordering and grouping.

#### Scenario: Symmetrical Catalog Browsing

- GIVEN primary or fallback menu
- WHEN opened
- THEN 24 agents appear in 5 groups with unselectable dividers

#### Scenario: Interacting with Separators

- GIVEN visible separators
- WHEN clicked or pressed Enter on
- THEN no selection occurs, no dialog opens, and focus is preserved

### Requirement: Spanish UI Localization

Visible UI copy, titles, buttons, and notices MUST be in Spanish, while preserving exact casing for agent names, `fallback`, and `high`.

#### Scenario: Localized Navigation

- GIVEN the profile TUI
- WHEN browsing menus and prompts
- THEN text is Spanish except agent names, `fallback`, and `high`

### Requirement: Maximum Safe Dialog Sizing & Degradation

Dialogs MUST render at maximum safe terminal width/height, degrading gracefully on small viewports without clipping.

#### Scenario: Viewport Adaptation

- GIVEN any terminal size
- WHEN a dialog opens
- THEN dimensions maximize safe area without control truncation

### Requirement: Unconditional Reasoning Effort Flow

Selecting any model, including re-selecting the same model, MUST immediately trigger the effort selector. The individual selection MUST persist the new canonical model, prune obsolete aliases that could restore previous values, and commit model and effort atomically. Cancelling effort MUST discard model changes. The visible confirmation toast MUST display both the assigned model and effort. Unsupported models MUST show only `Predeterminado` (persisted as `provider-default`) and continue cleanly.

#### Scenario: Configurable Model

- GIVEN a model with reasoning tiers
- WHEN selected
- THEN effort dialog opens showing tiers, including `high`

#### Scenario: Non-Configurable Model

- GIVEN a model lacking custom reasoning
- WHEN selected
- THEN effort dialog shows only `Predeterminado` and completes without error

#### Scenario: Canonical Persistence and Combined Feedback

- GIVEN an orchestrator with legacy alias `sdd-ORCHETATOR`
- WHEN the operator assigns model "google/gemini-2.5-flash" and effort "high"
- THEN the canonical orchestrator is saved, legacy aliases are pruned, and the toast confirms both model and effort

#### Scenario: Individual Effort Cancellation

- GIVEN an operator selecting a new model for an individual agent
- WHEN the operator cancels the subsequent effort dialog
- THEN neither model nor effort is modified in the profile

### Requirement: Profile Detail Navigation Cleanup

The profile detail menu MUST omit the visual `Versiones` navigation entry and orphaned `Agentes` heading, while preserving all underlying historical snapshots, version schemas, and data-level restoration mechanisms.

#### Scenario: Clean Profile Detail View

- GIVEN the profile detail menu
- WHEN displayed to the operator
- THEN `Versiones` and orphan `Agentes` header are absent from visible menu items

#### Scenario: Historical Snapshot Retention

- GIVEN existing version history for a profile
- WHEN the profile detail is opened or modified
- THEN internal version snapshots remain preserved and accessible for system recovery

### Requirement: Persistence Symmetry & Runtime Sync Safety

Persisted profiles MUST retain all 24 fallback mappings. Runtime sync MUST filter out unsupported agents (`compaction`, `summary`, `title`, orchestrators) while allowing explicit runtime-sync-eligible catalog assignments.

#### Scenario: Fallback Storage vs Sync

- GIVEN 24 configured fallbacks
- WHEN saved and synchronized
- THEN storage retains all 24 mappings; runtime receives only eligible extensible assignments

### Requirement: Idempotent Migration & State Safety

Profile loading MUST idempotently normalize legacy fields without dropping valid unknown keys. Navigation, cancellation, or errors MUST NOT leave partial state.

#### Scenario: Idempotent Normalization

- GIVEN a profile with legacy format or custom keys
- WHEN loaded or modified
- THEN schema is normalized and custom/unknown values are preserved

#### Scenario: Cancellation Preserves State

- GIVEN an in-progress edit
- WHEN cancelled or on error
- THEN no partial changes are written and previous state remains intact

## Acceptance & Edge Case Checklist

- [x] **Happy Path**: Symmetrical 24-agent primary/fallback catalog with sequential effort flow.
- [x] **Edge Case**: Divider clicks/keys are strict no-ops. Responsive dialog adaptation on small viewports.
- [x] **Error State**: Non-configurable models show only `Predeterminado` without failure.
- [x] **Migration**: Legacy profiles normalize idempotently without data loss.
- [x] **Strict TDD**: Deterministic test coverage for catalog ordering, localization, effort flow, normalization, and runtime filtering.
