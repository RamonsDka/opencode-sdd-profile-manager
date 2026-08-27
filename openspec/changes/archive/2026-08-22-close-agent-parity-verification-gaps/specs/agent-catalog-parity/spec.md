# Delta for agent-catalog-parity

## ADDED Requirements

### Requirement: Canonical 19 Fallback Sequence Exact Order

**User Story:** As verifier I want full 19 order pinned.

The system MUST render Fallbacks in exact order: `jd-fix-agent-fallback,jd-judge-a-fallback,jd-judge-b-fallback,review-readability-fallback,review-refuter-fallback,review-reliability-fallback,review-resilience-fallback,review-risk-fallback,review-validator-fallback,sdd-apply-fallback,sdd-archive-fallback,sdd-design-fallback,sdd-explore-fallback,sdd-init-fallback,sdd-onboard-fallback,sdd-propose-fallback,sdd-spec-fallback,sdd-tasks-fallback,sdd-verify-fallback` and SHALL expose `FALLBACK_MANAGED_COUNT=19`.

#### Scenario: Exact 19 order
- GIVEN empty `config.agent` and `{models:{}}`
- WHEN `buildCatalogSections` builds Fallbacks
- THEN list strictly equals 19-element canonical array

**Checklist**
| Cat | Criterion | Signal |
|---|---|---|
| Success | Array equality, not count+endpoints | `toEqual(CANONICAL)` |

### Requirement: Explicit-Only Fallback Synthesis Gate

**User Story:** As user I want dynamic primaries not to shadow fallbacks.

The system MUST NOT create or update `*-fallback` in `syncSddFallbackAgents` when only dynamic primary exists. It MUST create/update `base-fallback` iff `profile.fallback[base]` explicitly declared, `isFallbackEligible(base)`, and primary explicit in `BASE∪config.agent∪profile.models`. Existing `config.agent["sdd-future-fallback"]` MUST be preserved unchanged unless `profile.fallback["sdd-future"]` explicitly declares it. 19 base MUST still sync.

#### Scenario: Dynamic primary alone no synthesis
- GIVEN `config.agent={"sdd-future":{model:"m1"}}` and `profile.fallback={}`
- WHEN activation calls `syncSddFallbackAgents`
- THEN `config.agent["sdd-future-fallback"]` absent

#### Scenario: Existing future fallback preserved
- GIVEN `config.agent` has `"sdd-future-fallback":{model:"old"}` and `profile.fallback` omits it
- WHEN activation syncs
- THEN fallback keeps `model:"old"`

#### Scenario: 19 base still sync
- GIVEN 19 eligible base primaries present
- WHEN activation runs
- THEN each base fallback exists with base or override model

**Checklist**
| Cat | Criterion | Signal |
|---|---|---|
| Happy | 19 sync; future only when explicit | RED no-synthesis |
| Edge | `model-audit-fallback` never | `derive===null` |

## MODIFIED Requirements

### Requirement: Visual Families and Deterministic Order

The system MUST classify agents into `Orchestrator>SDD>JD>Review>Tools>Fallbacks>Custom` without bulk. Base members MUST follow `BASE_CANONICAL_ORDER` (40); extras after base alphabetically. `Fallbacks` SHALL be exactly 19 canonical plus explicit extras alphabetically after.
(Previously: fallback order checked only count+endpoints.)

#### Scenario: Ordered groups canonical TUI
- GIVEN 40 plus `sdd-extra-a`, `my-agent`
- WHEN rendered
- THEN families tier order; base subsequence equals `BASE`, extras alpha after base

#### Scenario: Fallback exact order
- GIVEN 40 base entries
- WHEN Fallbacks rendered
- THEN equals exact 19 array

#### Scenario: No bulk
- GIVEN grouped view
- WHEN inspected
- THEN no family bulk action

**Checklist**
| Cat | Criterion | Signal |
|---|---|---|
| Success | Tier order + 19 equality | `toEqual` |
