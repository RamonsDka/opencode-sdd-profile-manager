# Delta for agent-catalog-parity

## MODIFIED Requirements

### Requirement: Visual Families and Deterministic Order

The system MUST classify agents into `Orchestrator>SDD>JD>Review>Tools>Fallbacks>Custom` and MUST provide exactly TWO profile-wide bulk actions rather than per-family controls: primary and fallback. Base members MUST follow `BASE_CANONICAL_ORDER` (40); extras after base alphabetically. `Fallbacks` SHALL be exactly 19 canonical plus explicit extras alphabetically after.
(Previously: exactly one profile-wide bulk action)

#### Scenario: Ordered groups canonical TUI

- GIVEN 40 plus `sdd-extra-a`, `my-agent`
- WHEN rendered
- THEN families tier order; base subsequence equals `BASE`, extras alpha after base

#### Scenario: Fallback exact order

- GIVEN 40 base entries
- WHEN Fallbacks rendered
- THEN equals exact 19 array

#### Scenario: Profile-Wide Bulk Availability

- GIVEN the grouped catalog view
- WHEN inspected
- THEN exactly two profile-wide bulk actions are present, with no per-family bulk controls

## ADDED Requirements

### Requirement: Fallback Bulk Target Inclusiveness and Exclusion

The fallback bulk operation MUST target all 19 canonical eligible fallbacks regardless of configuration state, MUST include unconfigured entries as assignable targets, and MUST exclude auxiliary internal entries (`compaction`,`summary`,`title`), orchestrators in `FALLBACK_INELIGIBLE_AGENTS`, `model-audit`, and any fallback whose derived base owner is null or ineligible per catalog/policy.

#### Scenario: Includes Unconfigured Fallbacks

- GIVEN 19 canonical fallbacks where 5 have no model in config
- WHEN fallback bulk targets are collected
- THEN all 19 appear as targets including the 5 unconfigured

#### Scenario: Excludes Auxiliary and Ineligible

- GIVEN catalog with auxiliaries `compaction`,`summary`,`title` and `model-audit`
- WHEN fallback bulk targets are collected
- THEN none of those entries appear as fallback targets

#### Scenario: Excludes Orphan Without Valid Owner

- GIVEN a fallback key whose base maps to null per `deriveFallbackProfileKey`
- WHEN fallback bulk targets are collected
- THEN that fallback is excluded

### Requirement: Valid Fallback Preservation Versus Invalid Pruning

The system MUST preserve valid fallback mappings during catalog building and normalization and MUST prune only invalid or orphan fallback entries via an explicit rule. Valid means base in `BASE_CANONICAL_ORDER` fallback set and eligible per `isFallbackEligible`. Invalid means base ineligible, reserved auxiliary, or derived owner null. Pruning MUST NOT remove canonical 19 valid fallbacks.

#### Scenario: Preserve Valid Canonical Fallbacks

- GIVEN 19 canonical fallbacks with valid mappings
- WHEN catalog normalizes or builds sections
- THEN all 19 remain present in Fallbacks family

#### Scenario: Prune Orphan Fallback

- GIVEN profile with `unknown-agent-fallback` where base is not in base set
- WHEN normalization runs
- THEN that orphan entry is removed while 19 canonical remain

### Requirement: Primary and Individual Fallback Behavior Preservation

The existing primary bulk action and individual fallback selection MUST retain their behavior except where effort handling is explicitly extended by proposal. Fallback bulk MUST NOT alter primary targets.

#### Scenario: Primary Bulk Unchanged

- GIVEN primary bulk flow is triggered
- WHEN it completes
- THEN only primary targets are modified and primary flow remains identical to before

#### Scenario: Individual Fallback Intact

- GIVEN individual fallback picker is used
- WHEN a single fallback model is selected
- THEN only that fallback is updated and the individual flow remains functional
