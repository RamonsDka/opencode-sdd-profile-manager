# Delta for profile-model-bulk-configuration

## MODIFIED Requirements

### Requirement: Unified Profile-Wide Model and Effort Assignment

The TUI MUST expose exactly TWO bulk actions in Acciones masivas: primary `Asignar un modelo y esfuerzo a todos los agentes` and fallback `Asignar un modelo y esfuerzo a todos los agentes fallback`. Primary MUST target every configurable primary; fallback MUST target the 19 canonical eligible fallbacks including unconfigured, MUST exclude internal/auxiliary and fallbacks without valid owner per catalog/policy, and MUST overwrite prior fallback models. Both flows MUST sequence model then effort before one atomic mutation without extra confirmation.
(Previously: exactly ONE bulk action)

#### Scenario: Primary Full Overwrite

- GIVEN heterogeneous primary models
- WHEN operator picks primary bulk, model "openai/o3-mini" and effort "high"
- THEN all configurable primaries update to that model/effort atomically

#### Scenario: Fallback Full Overwrite Without Confirmation

- GIVEN fallbacks with prior models
- WHEN operator picks fallback bulk, model "openai/o3-mini" and effort "high"
- THEN all 19 eligible fallbacks overwrite to that model/effort in one mutation with no extra confirmation

#### Scenario: Internal Exclusion

- GIVEN profile with internal entries and auxiliaries
- WHEN either bulk executes
- THEN internal/non-configurable entries remain untouched

### Requirement: Atomic Cancellation and Snapshot Integrity

Both bulks MUST be atomic. Cancelling model or effort MUST abort with zero snapshots, writes, or changes. Before persist, the system MUST capture a pre-mutation snapshot. On write failure it MUST restore the snapshot and MUST leave no partial mutation. Historical versions and rollback MUST stay intact.
(Previously: atomic for primary only, no explicit compensation)

#### Scenario: Cancel At Either Picker

- GIVEN operator selected model in either bulk flow
- WHEN operator cancels model or effort picker
- THEN no snapshot or write occurs and profile stays unchanged

#### Scenario: Snapshot Before Write and Compensation

- GIVEN valid profile
- WHEN fallback bulk succeeds
- THEN pre-mutation snapshot exists for rollback
- WHEN atomic write fails after snapshot
- THEN profile is restored to snapshot with no partial changes

### Requirement: Reasoning Compatibility Defaulting

When chosen model lacks reasoning support, the system MUST persist `provider-default` for all targets. For fallback, persisted effort MUST be per-target and runtime MUST apply it on activation.
(Previously: provider-default only for primary)

#### Scenario: Unsupported Model Defaults

- GIVEN model without reasoning tiers (e.g. "anthropic/claude-3-5-sonnet")
- WHEN either bulk commits
- THEN all targets get that model and effort `provider-default`

#### Scenario: Fallback Effort Applied

- GIVEN fallback bulk persisted "openai/o3-mini" with "high"
- WHEN fallback activates
- THEN runtime applies that model and effort

## ADDED Requirements

### Requirement: Fallback Effort Persistence and Pruning Guard

The system MUST atomically persist fallback model and effort per target and MUST apply it at runtime. Normalization MUST NOT prune valid fallbacks; it MUST prune only invalid/orphan entries where base is ineligible, is reserved auxiliary (`compaction`,`summary`,`title`), or owner is null.

#### Scenario: Preserve Valid Fallback Configs

- GIVEN valid canonical fallback mappings
- WHEN fallback bulk persists
- THEN all 19 remain and valid configs are not pruned

#### Scenario: Prune Only Invalid Orphan

- GIVEN profile with orphan `unknown-fallback`
- WHEN normalization runs
- THEN orphan is removed, 19 canonical remain

### Requirement: Legacy Compatibility and Version Preservation

The system MUST load legacy profiles without `fallback` or fallback-effort without destructive migration, MUST create those keys only after fallback bulk use, and MUST preserve historical snapshots. Primary and individual fallback MUST remain unchanged unless proposal explicitly modifies effort.

#### Scenario: Legacy Load Without Migration

- GIVEN legacy profile without `fallback`
- WHEN loaded
- THEN it loads lossless without auto-creating fallback keys

#### Scenario: Fallback Keys Created on Bulk Use

- GIVEN legacy profile without fallback keys
- WHEN fallback bulk completes
- THEN profile contains `fallback` and per-target efforts for all 19

#### Scenario: Versions Intact

- GIVEN existing version history
- WHEN either bulk modifies profile
- THEN prior versions remain restorable
