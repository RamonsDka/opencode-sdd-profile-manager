# profile-model-configuration Specification

## Purpose

Define sequential model and reasoning effort selection, automatic compatibility pruning, non-interactive bulk assignments, single-snapshot versioning, and reasoning eligibility for primary runtime agents.

## Requirements

### Requirement: Sequential Primary Model and Reasoning Effort Flow

**User Story:** As a user configuring an agent, I want selecting a model to seamlessly prompt for reasoning effort when supported, so that I can configure both in one continuous flow.

When a user selects a model for a primary agent from the Profile Detail Hub or Primary Models submenu, the system MUST execute the sequential flow:
1. Save the new model to the active profile.
2. If the selected model metadata does not support reasoning (`capabilities.reasoning !== true` or empty effort options), the system MUST prune any previously saved effort, persist the profile, show a confirmation toast, and return directly to the caller screen (`hub` or `primary`).
3. If the selected model metadata supports reasoning, the system MUST immediately launch the Reasoning Effort Picker.
4. When an effort option is selected, the system MUST save the effort in `profile.configs[agent].reasoning_effort`, show a confirmation toast, and return to the caller screen.
5. When the user backs out or cancels from the Reasoning Effort Picker, the newly selected model MUST remain saved with no explicit effort (clearing any prior effort), show a confirmation toast, and return to the caller screen.

#### Scenario: Unsupported reasoning model selection
- GIVEN a primary agent `sdd-apply` with existing model `o3-mini` and effort `high`
- WHEN user selects `claude-3-5-sonnet` (reasoning unsupported)
- THEN `claude-3-5-sonnet` is saved
- AND previously saved effort `high` is removed
- AND system returns to caller screen without prompting reasoning effort

#### Scenario: Supported reasoning model selection with effort choice
- GIVEN a primary agent `sdd-spec` with model `claude-3-5-sonnet`
- WHEN user selects `o3-mini` (supports `low`, `medium`, `high`)
- THEN Reasoning Effort Picker opens immediately with options `low`, `medium`, `high`
- AND upon selecting `high`, `high` is saved to `profile.configs["sdd-spec"].reasoning_effort`
- AND system returns to caller screen with confirmation toast

#### Scenario: Supported reasoning model selection with effort cancel
- GIVEN a primary agent `sdd-spec` with existing model `o3-mini` and effort `high`
- WHEN user changes model to `o1` (supports reasoning) and cancels the Reasoning Effort Picker
- THEN `o1` remains saved in the profile
- AND `reasoning_effort` is cleared (no explicit effort)
- AND system returns to caller screen

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | Supported model transitions directly to effort picker | Dialog replace with picker |
| Edge | Unsupported model returns immediately to caller screen | No effort prompt |
| Edge | Cancel effort leaves model saved with cleared effort | `reasoning_effort === undefined` |
| Success | Caller target (`hub` vs `primary`) respected on completion | Return screen matches caller |

### Requirement: Reasoning Effort Compatibility and Immediate Pruning

**User Story:** As a user switching models, I want incompatible reasoning efforts cleaned up immediately, so that invalid configuration states are never stored.

When a primary agent's model is updated, the system MUST evaluate the compatibility of any existing `reasoning_effort`. If the existing effort is in the new model's supported effort list, it MAY be retained initially; however, if the user cancels or aborts the sequential effort prompt, the effort MUST be cleared. If the existing effort is NOT in the new model's supported options or the new model does not support reasoning, the system MUST remove `reasoning_effort` immediately upon model assignment.

#### Scenario: Incompatible effort pruned on model switch
- GIVEN agent `sdd-tasks` has model `custom-reasoner` with effort `max` (not supported by `o3-mini`)
- WHEN model is changed to `o3-mini` (supports `low`, `medium`, `high`)
- THEN previous effort `max` is pruned immediately upon model assignment

#### Scenario: Compatible effort re-selection or cancellation
- GIVEN agent `sdd-spec` has model `o3-mini` with effort `medium`
- WHEN model is changed to `o1` (which also supports `medium`)
- AND user cancels the effort picker
- THEN `o1` is saved and explicit effort is cleared to provider default

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | Incompatible effort removed on model change | Key deleted from configs |
| Edge | Switching to non-reasoning model removes effort | Key deleted from configs |
| Success | Cancel always yields no explicit effort | Effort cleared |

### Requirement: Single-Snapshot Versioning for Model and Effort Flow

**User Story:** As a user reviewing profile history, I want a model change and its subsequent reasoning effort choice to produce exactly one profile version snapshot, so that history is not cluttered with intermediate states.

The system MUST record exactly one `ProfileVersion` entry per model assignment flow. The initial model assignment MUST capture the version snapshot. A subsequent reasoning effort selection within the same sequential flow MUST update the active profile state without creating a second version snapshot.

#### Scenario: Single version generated for sequential flow
- GIVEN profile version count is `N`
- WHEN user completes sequential model change and effort selection for `sdd-init`
- THEN profile version count becomes `N + 1`
- AND the latest version reflects both the updated model and updated reasoning effort

#### Scenario: Single version on cancel
- GIVEN profile version count is `N`
- WHEN user selects a new model and cancels the effort picker
- THEN profile version count becomes `N + 1`
- AND the latest version reflects the updated model with no explicit effort

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | Complete flow produces exactly 1 snapshot | Version array length + 1 |
| Edge | Cancel produces exactly 1 snapshot | Version array length + 1 |
| Success | Standalone reasoning update creates its own single snapshot | Standalone flow N + 1 |

### Requirement: Fallback and Standalone Reasoning Boundary

**User Story:** As a user, I want fallback assignments to remain simple without reasoning prompts, while keeping standalone reasoning maintenance available on the Hub.

The system MUST NOT prompt for reasoning effort when assigning fallback models (`*-fallback`), as fallback configurations do not own reasoning effort. The system MUST retain the standalone "Reasoning effort..." submenu on the Profile Detail Hub for direct maintenance of primary agents without requiring model re-selection. Discovered custom primary agents (`Custom` family) MUST be eligible for reasoning configuration in both sequential and standalone flows if their model supports reasoning.

#### Scenario: Fallback model assignment without reasoning prompt
- GIVEN user selects fallback agent `sdd-tasks-fallback`
- WHEN user picks model `o3-mini`
- THEN `o3-mini` is saved to `profile.fallback["sdd-tasks"]`
- AND no reasoning effort picker is opened
- AND system returns to Fallback Models submenu

#### Scenario: Standalone reasoning effort submenu retained
- GIVEN user is on Profile Detail Hub
- WHEN user selects "Reasoning effort..."
- THEN standalone reasoning submenu opens listing all primary agents supporting reasoning
- AND selecting an agent allows updating effort directly

#### Scenario: Custom primary agent reasoning support
- GIVEN a discovered custom primary agent `security-auditor` assigned to `o3-mini`
- WHEN user configures its model or opens standalone reasoning menu
- THEN `security-auditor` is eligible for reasoning effort selection

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | Fallback assignment never prompts effort | Direct return to fallbacks |
| Happy | Standalone reasoning submenu accessible on Hub | Submenu opens |
| Success | Custom primary agents eligible for reasoning | Config accepted |

### Requirement: Non-Interactive Bulk Model Assignment

**User Story:** As a user applying bulk model changes, I want bulk operations to execute immediately without prompting for reasoning effort per agent, while safely pruning incompatible efforts.

When a bulk action is executed (such as "Set all primary phases"), the system MUST apply the selected model across all targeted agents without launching interactive reasoning prompts. For each affected primary agent, the system MUST prune existing `reasoning_effort` if incompatible with the newly assigned bulk model.

#### Scenario: Bulk primary model assignment with effort pruning
- GIVEN primary agents `sdd-spec` (effort `high`) and `sdd-tasks` (effort `max`)
- WHEN user executes bulk action setting all primary agents to `claude-3-5-sonnet` (no reasoning)
- THEN both agents are updated to `claude-3-5-sonnet`
- AND all prior reasoning efforts are pruned
- AND no interactive reasoning picker is shown

#### Scenario: Bulk action with compatible effort retention
- GIVEN primary agents `sdd-spec` (effort `high`) and `sdd-tasks` (effort `low`)
- WHEN user executes bulk action setting all primaries to `o3-mini` (supports `low`, `medium`, `high`)
- THEN both agents have their models updated to `o3-mini`
- AND existing compatible efforts (`high` and `low`) are preserved
- AND no per-agent prompts occur

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | Bulk actions update models non-interactively | 0 interactive prompts |
| Edge | Incompatible efforts pruned across all affected agents | Pruning loop verified |
| Success | Compatible efforts retained across bulk targets | Configs preserved |
