# Delta for agent-catalog-parity

## MODIFIED Requirements

### Requirement: Visual Families and Deterministic Order

The system MUST classify agents into `Orchestrator>SDD>JD>Review>Tools>Fallbacks>Custom` and provide exactly one profile-wide bulk action rather than per-family bulk controls. Base members MUST follow `BASE_CANONICAL_ORDER` (40); extras after base alphabetically. `Fallbacks` SHALL be exactly 19 canonical plus explicit extras alphabetically after.
(Previously: prohibited all bulk actions.)

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
