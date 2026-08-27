# Design: Fallback Bulk Model and Effort Assignment

## Technical Approach

Extend the current catalog projection, staged model→effort dialog flow, pure bulk overwrite builder, version snapshot, and atomic profile write with an explicit `primary | fallback` target (default `primary`). Fallback model values remain in `profile.fallback[primary]`; effort is stored in `profile.configs[`${primary}-fallback`].reasoningEffort`, matching the actual runtime agent name and preventing primary/fallback ambiguity.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|---|---|---|
| Reuse `configs["<primary>-fallback"]` | Add `fallbackConfigs` map | Runtime reasoning is already agent-name keyed. A dedicated map duplicates normalization/application machinery. Suffix keys distinguish scopes while `fallback[primary]` remains the model contract. Legacy profiles stay untouched until an explicit fallback write. |
| Make config eligibility relation-aware | Preserve every suffix; canonical-only pruning | Primary config survives only with `models[name]`; fallback config survives only when `deriveFallbackProfileKey(name)` returns an eligible owner and `fallback[owner]` exists. Preserve `provider-default`, canonical 19, and valid explicit catalog extras; prune reserved, ineligible, null-owner, and orphan configs. |
| Apply fallback effort inside fallback materialization | Run generic primary effort pass afterward | `syncSddFallbackAgents` is the exact boundary that creates/updates `${primary}-fallback`. It SHALL set the resolved fallback model and apply/clear effort from the matching suffixed config; `provider-default` clears both runtime effort locations. The generic primary pass must continue excluding fallbacks. |
| Generalize projection and overwrite by target | Separate fallback engine; hardcoded UI list | `collectConfigurableProfileTargets(config, target="primary")` preserves callers. Fallback mode derives the exact ordered 19 from `CANONICAL_FALLBACK_ORDER`/policy, validates owners, and emits `{field:"fallback", profileKey:primary}` even when unconfigured. The shared builder branches only at model/config key projection. |
| Strengthen transaction compensation | Per-agent writes; snapshot fallback subset | Snapshot the complete profile `beforeRaw`, create a version whose operation target is `fallback`, then perform one atomic replacement. Snapshot failure prevents writing. Any reported write failure restores `beforeRaw` atomically and removes the failed version; compensation failure is surfaced, never hidden. |

## Data Flow

```text
bulk action → provider/model picker → effort picker
      cancel at either picker ─────────→ detail (zero I/O)
      confirm → target projection → pure overwrite → snapshot(profile beforeRaw)
              → atomic write → combined toast

profile activation → primary merge → fallback sync(model + suffixed effort)
                   → primary-only reasoning application
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/types.ts` | Modify | Target-aware projection/result contracts; no new persisted map. |
| `src/catalog.ts` | Modify | Defaulted primary projection plus policy-derived canonical fallback projection. |
| `src/profile-reasoning.ts` | Modify | Validate/preserve fallback configs and expose shared apply/clear semantics. |
| `src/profiles.ts` | Modify | Target-aware builder/version metadata, relation-aware persistence, runtime fallback effort, compensation. |
| `src/dialogs.tsx` | Modify | Exactly two actions; shared picker pipeline and combined labels/toasts. |
| `src/catalog.test.ts` | Modify | Exact 19/order, unconfigured inclusion, owner/exclusion rules. |
| `src/profile-reasoning.test.ts` | Modify | Fallback preservation/pruning and `provider-default`. |
| `src/profiles.test.ts` | Modify | Builder, legacy load, snapshot/write compensation, runtime safe harness. |
| `src/dialogs.test.ts` | Modify | Two actions, exact Spanish labels, cancel zero I/O, individual and bulk flow. |

Estimated incremental change: 9 files, roughly 450–650 authored lines. **400-line budget risk: High**; tasks should split storage/runtime from catalog/dialog work. All forecast files overlap substantial dirty work (current relevant diff: 4,259 lines), and the archived `profile-model-bulk-effort-corrections` design established the shared staged-flow/snapshot pattern; implementation must layer onto current code, not replay archived patches.

## Interfaces / Contracts

`collectConfigurableProfileTargets(config, target = "primary")` and `updateProfileWithBulkOverwrite(..., target = "primary")` remain backward compatible. Fallback targets use primary `profileKey`, `field:"fallback"`; effort ownership is `${profileKey}-fallback`.

Individual fallback selection now MUST request effort immediately, because the delta spec explicitly extends the unconditional flow to individual and fallback bulk. Cancel discards both; success produces one model+effort toast.

## Testing Strategy

| Phase | Tests |
|---|---|
| RED | Add failing assertions per file above: 19 targets, pruning, individual effort prompt, zero-I/O cancellation, correct snapshot target, failed-write restoration, activation model+effort/default clearing. Runtime tests use cloned config/providers and temp profile/version directories—never user config. |
| GREEN | Implement the smallest shared target/key helpers and one transaction/runtime boundary. |
| REFACTOR | Remove duplicate primary/fallback picker and effort code; run focused Vitest suites, `npm test`, and `npm run typecheck`. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable classification, or process-integration boundary changes.

## Migration / Rollout

No eager migration. Legacy reads remain lossless and do not create fallback/config keys; explicit individual or bulk fallback commits create them. Existing snapshots and rollback remain readable. Roll out through tests/typecheck only; no deployment included.

## Open Questions

None.
