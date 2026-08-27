# Delta for agent-catalog-parity

## MODIFIED Requirements

### Requirement: Hybrid Base Catalog, Union, Dedup, Precedence

**User Story:** As a developer, I want the agent catalog to reflect only active runtime agents from `api.state.config.agent` while maintaining known presentation order, so that unused roles do not clutter the configuration.

The system MUST derive the active catalog inventory strictly from `api.state.config.agent` at OpenCode startup, MUST NOT force unconfigured base agents into the active inventory, and MUST order known base agents according to canonical presentation order with discovered custom agents ordered alphabetically thereafter. Profile entries for agents absent from runtime MUST be preserved in storage but MUST remain hidden in UI views.

(Previously: Catalog forced a static 40-agent base union regardless of runtime configuration.)

#### Scenario: Runtime-driven inventory discovery
- GIVEN `api.state.config.agent` contains only `gentle-orchestrator`, `sdd-spec`, and `sdd-spec-fallback`
- WHEN the agent catalog is built
- THEN exactly those 3 agents are exposed in the catalog
- AND absent base agents are not rendered

#### Scenario: Known presentation order with discovered extras
- GIVEN `api.state.config.agent` contains `custom-eval`, `sdd-init`, `gentle-orchestrator`, and `review-risk`
- WHEN catalog sections are generated
- THEN agents appear in canonical order (`gentle-orchestrator` -> `sdd-init` -> `review-risk`) followed by custom agent `custom-eval`

#### Scenario: Non-runtime profile entries preserved hidden
- GIVEN a profile containing configuration for `sdd-archive` (absent from runtime)
- WHEN the profile detail is opened and saved
- THEN `sdd-archive` is hidden from the UI but preserved in the written profile JSON

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | Catalog contains only runtime-active agents | Inventory count matches config |
| Edge | Empty `config.agent` produces 0 active agents | No crash, empty view |
| Migration | Profiles with non-runtime agents round-trip lossless | Diff 0 for hidden keys |
| Success | Known agents follow canonical presentation order | Ordered sequence test |

### Requirement: Visual Families and Deterministic Order

**User Story:** As a user, I want strict separation between primary agents, fallback agents, and custom agents, so that fallback agents never appear in primary or custom views.

The system MUST classify agents into visual families `Orchestrator > SDD > JD > Review > Tools > Fallbacks > Custom`. Any agent name matching the suffix `*-fallback` MUST be classified under `Fallbacks` family and MUST NOT appear in Profile Detail Hub, Primary Models submenu, or `Custom` family. Discovered non-fallback, non-denylist agents MUST be classified under `Custom`.

(Previously: Fallback detection was limited to a hardcoded prefix list, allowing custom fallbacks to leak into Custom primaries.)

#### Scenario: Discovered fallback isolation
- GIVEN a discovered runtime agent `tester-fallback`
- WHEN visual families are classified
- THEN `tester-fallback` is assigned to `Fallbacks` family
- AND `tester-fallback` is absent from Hub and Primary Models submenu

#### Scenario: Discovered custom primary classification
- GIVEN a discovered runtime agent `security-scanner` (not ending in `-fallback`)
- WHEN visual families are classified
- THEN `security-scanner` is assigned to `Custom` family in Primary Models

#### Scenario: Canonical family hierarchy
- GIVEN runtime agents spanning orchestrator, sdd, jd, review, tools, custom, and fallbacks
- WHEN rendered in TUI
- THEN family groups follow exact order `Orchestrator > SDD > JD > Review > Tools > Fallbacks > Custom`

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | `*-fallback` agents isolated to Fallback Models | Absent from Hub / Primary |
| Edge | Unknown prefix `foo-fallback` placed in Fallbacks | `isFallback === true` |
| Success | Non-fallback custom placed in Custom | Appears under Custom family |

### Requirement: Unconfigured Badge and model-audit Primacy

**User Story:** As a user, I want internal OpenCode roles excluded from the catalog and `gentle-ai-windows-validator` displayed only when active at runtime, so that only configurable agents are exposed.

The system MUST exclude reserved roles from the catalog denylist: `{build, plan, general, explore, compaction, summary, title, gentle-reviewer, gentle-worker, sdd-orchestrator}`. The system MUST render `gentle-ai-windows-validator` only when present in `api.state.config.agent`. The system MUST treat `model-audit` as primary `Tools` without fallback synthesis.

(Previously: Unconfigured badges applied across static 40 entries and internal worker roles were not explicitly denylisted.)

#### Scenario: Reserved roles excluded
- GIVEN `api.state.config.agent` contains `build`, `plan`, `explore`, `summary`, and `sdd-tasks`
- WHEN catalog is loaded
- THEN `build`, `plan`, `explore`, and `summary` are excluded
- AND only `sdd-tasks` is exposed

#### Scenario: Windows validator conditional display
- GIVEN `gentle-ai-windows-validator` is present in `api.state.config.agent`
- WHEN catalog is rendered
- THEN `gentle-ai-windows-validator` appears under `Tools`
- AND when absent from `api.state.config.agent`, it is omitted

#### Scenario: model-audit primary with no fallback
- GIVEN `model-audit` present in runtime config
- WHEN catalog is rendered
- THEN `model-audit` is in `Tools` primary family and no `model-audit-fallback` is created

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | Denylisted roles never appear in UI | Denylist filter count = 0 |
| Edge | `gentle-ai-windows-validator` only renders if present | Dynamic presence check |
| Success | `model-audit` has no fallback counterpart | Fallback ineligible |

### Requirement: Profile Preservation and No Global Mutation

**User Story:** As a user, I want my inactive agents and custom configurations preserved without mutating global agent settings, so that profile switching remains safe and non-destructive.

The system MUST preserve unknown/custom agent configurations and non-runtime profile keys losslessly upon read and write, MUST NOT mutate global `agent` entries outside the active profile scope, and MUST refresh runtime catalog mappings upon next OpenCode start.

(Previously: Profile preservation lacked explicit hidden handling for non-runtime agent keys.)

#### Scenario: Inactive agent lossless roundtrip
- GIVEN an existing profile JSON with `models["inactive-agent"] = "m1"`
- WHEN profile is loaded in an environment where `inactive-agent` is not in `config.agent`
- AND profile is updated and saved
- THEN `models["inactive-agent"] = "m1"` is preserved in the output file

#### Scenario: Global agent isolation
- GIVEN global configuration containing non-profile agent settings
- WHEN profile activation occurs
- THEN non-profile global agent configurations remain unmodified

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | Inactive profile keys preserved on disk | JSON deep equality |
| Edge | Malformed config recovers gracefully | No crash on save |
| Success | Global non-profile agents unmodified | Config diff inspection |

### Requirement: Canonical 19 Fallback Sequence Exact Order

**User Story:** As a user, I want runtime fallback agents displayed in canonical order, so that fallback navigation is predictable.

The system MUST order runtime fallback agents matching the known 19 base roles according to canonical order: `jd-fix-agent-fallback, jd-judge-a-fallback, jd-judge-b-fallback, review-readability-fallback, review-refuter-fallback, review-reliability-fallback, review-resilience-fallback, review-risk-fallback, review-validator-fallback, sdd-apply-fallback, sdd-archive-fallback, sdd-design-fallback, sdd-explore-fallback, sdd-init-fallback, sdd-onboard-fallback, sdd-propose-fallback, sdd-spec-fallback, sdd-tasks-fallback, sdd-verify-fallback`. Discovered custom fallback agents MUST appear alphabetically after known fallbacks.

(Previously: 19 fallbacks were always rendered from a static array regardless of runtime presence.)

#### Scenario: Active fallbacks ordered canonically
- GIVEN active runtime fallbacks `sdd-verify-fallback`, `jd-fix-agent-fallback`, `custom-fallback`
- WHEN Fallback Models menu renders
- THEN order is `jd-fix-agent-fallback` followed by `sdd-verify-fallback` followed by `custom-fallback`

**Checklist**
| Category | Criterion | Signal |
|---|---|---|
| Happy | Known fallbacks ordered by canonical index | Relative order verified |
| Edge | Discovered fallbacks appended alphabetically | Alpha sorted at tail |
| Success | Omitted runtime fallbacks leave sequence intact | Subsequence equality |
