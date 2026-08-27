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
| Edge | Dup→1; empty→40 | No dup |
| Error | Bad JSON→40 | No crash |
| Migration | Legacy w/o `model-audit` loads | Lossless |
| Success | `isManaged` true 40 | Test |

### Requirement: Visual Families and Deterministic Order

**User Story:** As a user I want Gentle AI TUI order to scan quickly.

The system MUST classify each agent into one family in `Orchestrator > SDD > JD > Review > Tools > Fallbacks > Custom` without bulk actions. Within each family, base members MUST follow the canonical Gentle AI TUI sequence derived from the approved 40-entry base catalog order; any additional dynamic agents in that family MUST appear deterministically after the base members of the same family, ordered alphabetically among themselves. Map: `Orchestrator`=gentle-orchestrator; `SDD`=sdd-* primaries in base catalog order; `JD`=jd-* primaries in base catalog order; `Review`=review-* primaries in base catalog order; `Tools`=model-audit; `Fallbacks`=*-fallback where base eligible in base catalog fallback order; `Custom`=other managed keys.

#### Scenario: Ordered groups with canonical TUI sequence
- GIVEN 40 plus `sdd-extra-a`, `sdd-extra-b` and `my-agent` (Custom)
- WHEN rendered
- THEN families appear in tier order and base members within each family follow the canonical base catalog sequence, with dynamic extras after base members alphabetically

#### Scenario: No bulk
- GIVEN grouped view
- WHEN inspecting
- THEN no family bulk action exists

#### Scenario: Fallback family canonical order
- GIVEN 40 base entries
- WHEN Fallbacks family rendered
- THEN members follow the base catalog fallback order (jd-fix-agent-fallback, jd-judge-a-fallback, jd-judge-b-fallback, review-*-fallback, sdd-*-fallback as approved)

**Checklist**
| Cat | Criterion | Signal |
|---|---|---|
| Happy | Order tier; base members in canonical TUI sequence; extras after base alphabetically | Snapshot against base catalog order |
| Edge | `sdd-` custom→SDD after base SDD members alphabetically | Correct family + deterministic position |
| Error | Ineligible not Custom | No misclass |
| Migration | Old alphabetical→canonical TUI sequence | Visual |
| Success | Counts match map; sequence equals base catalog subsequence per family | Deterministic sequence assertion |

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
| Error | Corrupt→empty models | Graceful |
| Migration | No schema break | Compat |
| Success | `extractPersistedProfileExtras` | Covered |

## Base Catalog (40)
`gentle-orchestrator`, `sdd-init`, `sdd-explore`, `sdd-propose`, `sdd-spec`, `sdd-design`, `sdd-tasks`, `sdd-apply`, `sdd-verify`, `sdd-archive`, `sdd-onboard`, `jd-judge-a`, `jd-judge-b`, `jd-fix-agent`, `review-risk`, `review-readability`, `review-reliability`, `review-resilience`, `review-refuter`, `review-validator`, `model-audit`, `jd-fix-agent-fallback`, `jd-judge-a-fallback`, `jd-judge-b-fallback`, `review-readability-fallback`, `review-refuter-fallback`, `review-reliability-fallback`, `review-resilience-fallback`, `review-risk-fallback`, `review-validator-fallback`, `sdd-apply-fallback`, `sdd-archive-fallback`, `sdd-design-fallback`, `sdd-explore-fallback`, `sdd-init-fallback`, `sdd-onboard-fallback`, `sdd-propose-fallback`, `sdd-spec-fallback`, `sdd-tasks-fallback`, `sdd-verify-fallback`.
