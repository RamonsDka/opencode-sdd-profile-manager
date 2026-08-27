# Delta for spanish-tui-agent-catalog

## MODIFIED Requirements

### Requirement: Grouped 24-Agent Symmetrical Catalog

The TUI MUST display agents under native visual category headers that never receive focus, selection, search action matching, or trigger handlers, with no selectable separator items. The catalog MUST render in exact visual category sequence:
1. ORCHETATOR (`sdd-ORCHETATOR`)
2. SDD (`sdd-propose`, `sdd-design`, `sdd-apply`, `sdd-verify`, `sdd-spec`, `sdd-onboard`, `sdd-explore`, `sdd-init`, `sdd-tasks`, `sdd-archive`)
3. JD (`judgment-day`)
4. Reviewers (`readability`, `reliability`, `resilience`, `validator`, `refuter`, `risk`, `model-audit`)
5. Auxiliaries (`gentle-ai-windows-validator`, `compaction`, `summary`, `title`)

Primary menus MUST display all 24 agents across these groups. Fallback menus MUST exclude auxiliary agents (`compaction`, `summary`, `title`) from visibility and selection.
(Previously: 24 agents displayed in five groups separated by selectable dummy divider rows, identical in both primary and fallback menus.)

#### Scenario: Browsing Primary Catalog with Native Headers
- GIVEN the primary profile configuration menu
- WHEN opened and navigated
- THEN 24 agents appear organized in 5 categories with non-interactive, non-focusable visual headers in exact specified order

#### Scenario: Browsing Fallback Catalog
- GIVEN the fallback configuration menu
- WHEN opened
- THEN only eligible agents appear under native headers, and auxiliary agents `compaction`, `summary`, and `title` are omitted

#### Scenario: Header and Search Interaction
- GIVEN category headers and search input
- WHEN headers are clicked, pressed Enter on, or matched during search
- THEN no item selection occurs, no dialog triggers, and list focus advances only across real agent entries

### Requirement: Maximum Safe Dialog Sizing & Degradation

Dense multi-item dialogs MUST request host-level `xlarge` sizing. Small confirmation and prompt dialogs MUST remain proportionally sized. Dialogs MUST adapt to viewport dimensions without clipping or introducing numeric dimension overrides or core engine modifications.
(Previously: All dialogs maximized safe area identically without distinct dense-dialog xlarge tiers.)

#### Scenario: Dense Dialog Presentation
- GIVEN a dense agent listing or multi-tier configuration dialog
- WHEN opened in the terminal
- THEN the dialog renders using the host `xlarge` size class without control truncation

#### Scenario: Small Prompt Presentation
- GIVEN a single-value confirmation or effort prompt
- WHEN opened
- THEN the dialog renders in a compact, proportionate container without stretching to `xlarge`

### Requirement: Unconditional Reasoning Effort Flow

The user-facing effort selector MUST be labeled `Nivel de esfuerzo`. Effort summary rows MUST display format `<agent>: <value>` where `<value>` is one of `low`, `medium`, `high`, `xhigh`, `max`, or `Predeterminado`/unassigned token without repeating descriptive phrases per row. Selecting any model MUST prompt for effort confirmation. Internal keys (`reasoningEffort`), IDs, and values (`high`) MUST remain unchanged.
(Previously: User-facing labels and row layouts varied and repeated descriptive text per row.)

#### Scenario: Configurable Model Selection and Row Display
- GIVEN a model with reasoning support
- WHEN selected for an agent
- THEN effort dialog labeled `Nivel de esfuerzo` opens, and upon selection the list row updates to `<agent>: <value>`

#### Scenario: Non-Configurable Model Default
- GIVEN a model lacking custom reasoning
- WHEN selected
- THEN effort dialog offers only `Predeterminado` and updates the row cleanly to `<agent>: Predeterminado`

### Requirement: Persistence Symmetry & Runtime Sync Safety

Persisted profiles MUST store model and effort level for all compatible agents, including auxiliaries `compaction`, `summary`, and `title`. Runtime sync MUST NOT generate or register fallback agents for auxiliary entries. Missing agent definitions at activation MUST only be materialized if complete installed definitions exist; missing definitions MUST NOT be fabricated. Activation MUST apply all valid agents and report the exact missing agents.
(Previously: Missing agent handling at activation did not enforce complete installed definition checks or explicit missing agent reporting.)

#### Scenario: Auxiliary Model and Level Persistence
- GIVEN configured primary models and effort levels for `compaction`, `summary`, or `title`
- WHEN the profile is saved and activated
- THEN configuration persists model and effort without creating fallback entries in runtime sync

#### Scenario: Missing Agent at Activation
- GIVEN a profile referencing an uninstalled or incomplete agent definition
- WHEN activation is executed
- THEN valid installed agents are applied, missing definitions are not fabricated, and an explicit warning names the missing agents
