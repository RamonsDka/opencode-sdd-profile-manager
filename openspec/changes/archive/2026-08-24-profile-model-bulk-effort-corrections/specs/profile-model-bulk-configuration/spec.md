# profile-model-bulk-configuration Specification

## Purpose

Define requirements for atomic, profile-wide model and reasoning-effort assignment across all configurable profile agents with cancellation safety, snapshot preservation, and compatibility defaults.

## Requirements

### Requirement: Unified Profile-Wide Model and Effort Assignment

The TUI MUST provide exactly ONE visible bulk action with Spanish meaning "Asignar un modelo y esfuerzo a todos los agentes". The operation MUST target every configurable agent in the profile (orchestrators, SDD phases, reviewers, auxiliaries, and configurable tools) and MUST NOT include internal-only or non-configurable entries. The flow MUST sequence model selection then reasoning-effort selection before applying a single atomic mutation without additional confirmation prompts.

#### Scenario: Full Profile Overwrite

- GIVEN a profile with heterogeneous agent models and reasoning efforts
- WHEN the operator selects the bulk action, chooses model "openai/o3-mini", and chooses effort "high"
- THEN every configurable agent in the profile is updated to model "openai/o3-mini" and effort "high" in a single transaction

#### Scenario: Non-Configurable Internal Exclusion

- GIVEN a profile containing internal engine entries and 40 base configurable agents
- WHEN bulk model and effort assignment executes
- THEN all configurable agents receive the new model and effort while internal non-configurable entries remain untouched

### Requirement: Atomic Cancellation and Snapshot Integrity

The bulk assignment MUST be strictly atomic. Cancelling either the model selector or the effort selector MUST abort the operation and leave the profile unmodified. Before persisting bulk changes, the system MUST create or retain an internal profile snapshot for rollback and compatibility.

#### Scenario: Aborting at Effort Step

- GIVEN an operator who selected a new model in the bulk flow
- WHEN the operator cancels the subsequent reasoning-effort selector
- THEN no changes are written to the profile and all agents retain their original models and efforts

#### Scenario: Snapshot Retention Before Mutation

- GIVEN a valid profile state
- WHEN bulk assignment completes successfully
- THEN an internal snapshot of the pre-mutation profile is captured and available for rollback

### Requirement: Reasoning Compatibility Defaulting

When the chosen model lacks custom reasoning effort support, the system MUST persist reasoning effort as `provider-default` across all targeted agents.

#### Scenario: Unsupported Effort Model Selection

- GIVEN an operator selecting a model without reasoning effort tiers (e.g. "anthropic/claude-3-5-sonnet")
- WHEN the bulk assignment commits
- THEN every configurable agent is assigned that model and reasoning effort `provider-default`
