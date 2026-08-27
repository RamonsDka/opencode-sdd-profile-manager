# Proposal: Streamline Agent Model Configuration

## Problem

The static catalog exposes inactive roles, can leak unknown fallbacks into primary views, and separates model selection from reasoning setup. This creates stale effort and duplicate snapshots.

## Goals and Scope

### In Scope
- Derive inventory from `api.state.config.agent`; use known order only for presentation.
- Enforce primary/fallback separation and exclude reserved roles.
- Chain primary provider → model → supported effort selection.
- Keep bulk assignment non-interactive and prune invalid effort.
- Preserve profiles losslessly with one snapshot per model-change flow.

### Non-Goals
- OpenCode/provider API changes.
- Removing Reasoning maintenance or changing dialog sizing.

## Product Behavior

- Exclude `build`, `plan`, `general`, `explore`, `compaction`, `summary`, `title`, `gentle-reviewer`, `gentle-worker`, and `sdd-orchestrator`. Show `gentle-ai-windows-validator` only when runtime-present.
- Any `*-fallback` role appears only in Fallback Models and Bulk Actions—never Hub, Primary Models, or Custom.
- Primary assignment flows provider → model → effort when supported. Unsupported models return automatically; effort back/cancel keeps the model without explicit effort.
- Standalone Reasoning remains available for maintenance.
- A model change retains saved effort only when valid for the new model; otherwise it prunes it. Runtime custom primaries use the same metadata rule.
- Bulk assignment never prompts per agent and prunes invalid efforts for affected primaries.
- Non-runtime profile agents round-trip unchanged but stay hidden.

## Source Authority

`api.state.config.agent` owns inventory; model metadata owns reasoning support/efforts; profile JSON owns saved assignments. Known order is presentation-only.

## Compatibility and Migration

No schema migration is required. Preserve non-runtime keys; remove invalid effort only during affected model/bulk changes. Leave global agents untouched.

## Capabilities

### New Capabilities
- `profile-model-configuration`: Sequential assignment, effort compatibility, bulk behavior, and snapshot ownership.

### Modified Capabilities
- `agent-catalog-parity`: Use runtime inventory with reserved filtering, strict fallback separation, and lossless inactive agents.

## Approach and Affected Areas

Update `src/catalog.ts`/`src/utils.ts` discovery, `src/profile-reasoning.ts` validation, `src/profiles.ts` persistence/versioning, and `src/dialogs.tsx` navigation.

**Estimate:** one surgical 300–400-line slice if design evidence confirms the boundary.

## Risks

| Risk | Mitigation |
|---|---|
| Empty inventory | Show no active agents; preserve profile data. |
| Partial model/effort flow | Persist model first; cancel means provider default. |
| Data loss or duplicate snapshots | Lossless round-trip; model change owns one snapshot. |

## Rollback

Revert catalog, navigation, pruning, and versioning together; unchanged schema keeps profiles readable.

## Success Criteria

- [ ] Inventory follows runtime agents after reserved/fallback filtering.
- [ ] No fallback appears in Hub, Primary, or Custom.
- [ ] Primary/bulk flows prune effort correctly without per-agent bulk prompts.
- [ ] Profiles preserve inactive agents and each model flow creates one snapshot.
