# Delta for spanish-tui-agent-catalog

## MODIFIED Requirements

### Requirement: Unconditional Reasoning Effort Flow

Selecting any model, including re-selecting the same model, MUST immediately trigger the effort selector for both individual and fallback bulk flows. The selection MUST persist the new canonical model, prune obsolete aliases that could restore previous values, and commit model and effort atomically in one mutation without extra confirmation. Cancelling effort MUST discard model changes with zero writes. The confirmation toast MUST display both assigned model and effort. Unsupported models MUST show only `Predeterminado` persisted as `provider-default` and continue cleanly.
(Previously: flow described only for individual selection)

#### Scenario: Configurable Model

- GIVEN a model with reasoning tiers
- WHEN selected via individual or fallback bulk
- THEN effort dialog opens showing tiers including `high`

#### Scenario: Non-Configurable Model

- GIVEN a model lacking custom reasoning
- WHEN selected via either flow
- THEN effort dialog shows only `Predeterminado` and commits `provider-default` without error

#### Scenario: Canonical Persistence and Combined Feedback

- GIVEN an orchestrator with legacy alias `sdd-ORCHETATOR`
- WHEN operator assigns model "google/gemini-2.5-flash" and effort "high" via individual or fallback bulk
- THEN canonical entry is saved, legacy aliases pruned, and toast confirms both model and effort

#### Scenario: Individual Effort Cancellation

- GIVEN operator selecting a new model for individual or fallback bulk
- WHEN operator cancels the effort dialog
- THEN neither model nor effort is modified

#### Scenario: Fallback Bulk Atomic Without Confirmation

- GIVEN fallback bulk model and effort selected
- WHEN effort is confirmed
- THEN system commits fallback models and per-target efforts atomically with no extra confirmation and shows combined toast

### Requirement: Persistence Symmetry & Runtime Sync Safety

Persisted profiles MUST retain all 24 fallback mappings and per-target fallback efforts. Runtime sync MUST filter out unsupported agents (`compaction`,`summary`,`title`, orchestrators) while allowing explicit eligible catalog assignments, and MUST apply persisted fallback model and effort when the fallback activates. `provider-default` MUST be applied as clearing/no-custom effort.
(Previously: storage retained 24 fallback mappings; runtime filtered unsupported without per-target fallback effort apply)

#### Scenario: Fallback Storage vs Sync

- GIVEN 24 configured fallbacks with per-target efforts
- WHEN saved and synchronized
- THEN storage retains all 24 mappings with efforts; runtime receives only eligible assignments and applies fallback model and effort on activation

#### Scenario: Provider-Default Runtime Handling

- GIVEN a fallback assigned model without reasoning and effort `provider-default`
- WHEN fallback activates
- THEN runtime clears custom effort and applies provider default without error

### Requirement: Idempotent Migration & State Safety

Profile loading MUST idempotently normalize legacy fields without dropping valid unknown keys and MUST load legacy profiles lacking `fallback` or fallback-effort without destructive migration. Navigation, cancellation, or errors MUST NOT leave partial state; cancelling model or effort in fallback bulk MUST leave zero snapshot, writes, or changes. Historical snapshots MUST remain preserved.
(Previously: idempotent normalization and cancellation safety without explicit legacy fallback/effort handling)

#### Scenario: Idempotent Normalization

- GIVEN a profile with legacy format or custom keys
- WHEN loaded or modified
- THEN schema is normalized and custom/unknown values are preserved

#### Scenario: Legacy Fallback Idempotency

- GIVEN a legacy profile without `fallback`
- WHEN loaded twice
- THEN both loads are identical and lossless

#### Scenario: Cancellation Preserves State

- GIVEN an in-progress fallback bulk edit
- WHEN cancelled or on error
- THEN no partial changes are written and previous state and snapshots remain intact
