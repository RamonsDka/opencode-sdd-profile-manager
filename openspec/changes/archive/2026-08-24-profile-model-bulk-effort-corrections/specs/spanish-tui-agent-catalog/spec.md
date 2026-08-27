# Delta for spanish-tui-agent-catalog

## MODIFIED Requirements

### Requirement: Unconditional Reasoning Effort Flow

Selecting any model, including re-selecting the same model, MUST immediately trigger the effort selector. The individual selection MUST persist the new canonical model, prune obsolete aliases that could restore previous values, and commit model and effort atomically. Cancelling effort MUST discard model changes. The visible confirmation toast MUST display both the assigned model and effort. Unsupported models MUST show only `Predeterminado` (persisted as `provider-default`) and continue cleanly.
(Previously: only triggered effort selector without specifying canonical alias cleanup, atomic cancellation, or combined model/effort toast confirmation.)

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

## ADDED Requirements

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
