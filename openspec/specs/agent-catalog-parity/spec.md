# agent-catalog-parity Specification

## Purpose
Gentle AI 2.4.0 parity: 40 agents (21 primaries + 19 fallbacks) via hybrid base+discovery, visual families in canonical TUI order, lossless profile compat, no global mutation.

## Requirements

### Requirement: Hybrid Base Catalog, Union, Dedup, Precedence

**User Story:** As a maintainer I want 40 always present plus future/custom discovered.

The system MUST expose the 40 base names and MUST union `config.agent` and profile `models`/`fallback` keys; after dedup MUST be 40+extras, never omitting base. On collision base wins for family/eligibility.

#### Scenario: Base always visible
- GIVEN empty `config.agent`
- WHEN detail opens
- THEN 40 appear (any missing entry flagged Unconfigured yet visible/assignable)

#### Scenario: Extension dedup
- GIVEN config `sdd-future` + profile `my-agent` overlapping `sdd-init`
- WHEN catalog builds
- THEN 40+2 extras, no duplicate

**Checklist**
| Cat | Criterion | Signal |
|---|---|---|
| Happy | 40 rendered; extras Custom | Count |
| Edge | Dup=1; empty=40 | No dup |
| Error | Bad JSON=40 | No crash |
| Migration | Legacy w/o `model-audit` loads | Lossless |
| Success | `isManaged` true 40 | Test |

### Requirement: Visual Families and Deterministic Order

The system MUST classify agents into `Orchestrator>SDD>JD>Review>Tools>Fallbacks>Custom` and provide exactly one profile-wide bulk action rather than per-family bulk controls. Base members MUST follow `BASE_CANONICAL_ORDER` (40); extras after base alphabetically. `Fallbacks` SHALL be exactly 19 canonical plus explicit extras alphabetically after.

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
- THEN exactly one profile-wide bulk configuration action is present, with no per-family bulk controls

**Checklist**
| Cat | Criterion | Signal |
|---|---|---|
| Success | Tier order + 19 equality | `toEqual` |
| Bulk | Single profile-wide action present | `toBeDefined` |

### Requirement: Unconfigured Badge and model-audit Primacy

**User Story:** As a user I want any unconfigured base entry (primary or fallback) flagged yet assignable and `model-audit` primary w/o fallback.

The system MUST badge any base catalog entry (primary or fallback) missing from `config.agent` as `Unconfigured` yet selectable and assignable via its corresponding flow, MUST treat `model-audit` as primary Tools, MUST add it to `MANAGED_SDD_AGENT_EXCEPTIONS` and `FALLBACK_INELIGIBLE_AGENTS` (exactly `{sdd-orchestrator,gentle-orchestrator,model-audit}`), and MUST NOT generate `model-audit-fallback`.

#### Scenario: Unconfigured primary assignable
- GIVEN `sdd-spec` (primary) has no model in `config.agent`
- WHEN user selects it
- THEN `Unconfigured` badge is shown and picker persists selection to profile/config

#### Scenario: Unconfigured fallback assignable
- GIVEN `sdd-spec-fallback` (fallback) has no model in `config.agent`
- WHEN user selects it
- THEN `Unconfigured` badge is shown and picker persists selection via fallback assignment flow

#### Scenario: model-audit no fallback
- GIVEN `model-audit` assigned
- WHEN `syncSddFallbackAgents` runs
- THEN 19 fallbacks only; no `model-audit-fallback` created

**Checklist**
| Cat | Criterion | Signal |
|---|---|---|
| Happy | Any missing base entry (primary or fallback) shows Unconfigured badge and remains assignable | Badge visible + write succeeds |
| Edge | `model-audit` activate w/o fallback | No error |
| Error | Create `model-audit-fallback` rejected | Validation |
| Migration | Profiles with/without `model-audit` or fallbacks round-trip lossless | No loss |
| Success | `isFallbackEligible("model-audit")===false` and badge applies to all 40 when unconfigured | Assert |

### Requirement: Profile Preservation and No Global Mutation

**User Story:** As a user I want legacy/custom preserved and global untouched.

The system MUST load legacy, MUST preserve unknown/custom keys and extra fields lossless on write, and MUST NOT mutate unrelated global `agent` entries. `model-audit` MUST add only when assigned.

#### Scenario: Round-trip
- GIVEN pre-`model-audit` profile with `my-agent`
- WHEN read+write
- THEN loads ok, `my-agent` preserved

#### Scenario: No global mutation
- GIVEN global `external-agent`
- WHEN profile activates
- THEN `external-agent` unchanged

**Checklist**
| Cat | Criterion | Signal |
|---|---|---|
| Happy | Legacy/custom survive | Diff 0 |
| Edge | BOM+extras preserved | Tolerant |
| Error | Corrupt=empty models | Graceful |
| Migration | No schema break | Compat |
| Success | `extractPersistedProfileExtras` | Covered |

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

The system MUST NOT create or update `*-fallback` in `syncSddFallbackAgents` when only dynamic primary exists. It MUST create/update `base-fallback` iff `profile.fallback[base]` explicitly declared, `isFallbackEligible(base)`, and primary explicit in `BASE U config.agent U profile.models`. Existing `config.agent["sdd-future-fallback"]` MUST be preserved unchanged unless `profile.fallback["sdd-future"]` explicitly declares it. 19 base MUST still sync.

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

## Base Catalog (40)
`gentle-orchestrator`, `sdd-init`, `sdd-explore`, `sdd-propose`, `sdd-spec`, `sdd-design`, `sdd-tasks`, `sdd-apply`, `sdd-verify`, `sdd-archive`, `sdd-onboard`, `jd-judge-a`, `jd-judge-b`, `jd-fix-agent`, `review-risk`, `review-readability`, `review-reliability`, `review-resilience`, `review-refuter`, `review-validator`, `model-audit`, `jd-fix-agent-fallback`, `jd-judge-a-fallback`, `jd-judge-b-fallback`, `review-readability-fallback`, `review-refuter-fallback`, `review-reliability-fallback`, `review-resilience-fallback`, `review-risk-fallback`, `review-validator-fallback`, `sdd-apply-fallback`, `sdd-archive-fallback`, `sdd-design-fallback`, `sdd-explore-fallback`, `sdd-init-fallback`, `sdd-onboard-fallback`, `sdd-propose-fallback`, `sdd-spec-fallback`, `sdd-tasks-fallback`, `sdd-verify-fallback`.
