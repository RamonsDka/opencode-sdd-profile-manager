# Architecture

## System boundary

The package is a TUI plugin. It does not replace OpenCode configuration ownership; it provides safe workflows that read, transform, and submit configuration through host APIs.

```text
Keyboard shortcut / command
        │
        ▼
index.tsx — plugin lifecycle and registration
        │
        ▼
src/dialogs.tsx — user workflows
        │
        ├── catalog.ts — stable presentation and eligibility
        ├── profiles.ts — profile persistence and activation
        ├── profile-reasoning.ts — effort compatibility
        ├── orchestrator.ts — aliases and migration policy
        ├── host-compat.ts — capability guards
        ├── memories.ts — Engram reads
        └── state.ts — active profile and badge state
```

## Module responsibilities

| Module | Responsibility |
|---|---|
| `index.tsx` | Registers commands and shortcuts, loads preferences, hydrates active state, and wires the badge |
| `src/dialogs.tsx` | Builds OpenTUI dialogs and routes user actions |
| `src/catalog.ts` | Owns the ordered 25-agent catalog and visibility/runtime/fallback predicates |
| `src/profiles.ts` | Profile I/O, validation, versioning, activation, installed-definition discovery, and fallback synchronization |
| `src/profile-reasoning.ts` | Resolves whether a model supports reasoning effort and applies compatible values |
| `src/orchestrator.ts` | Handles historical and current orchestrator aliases without duplicating assignments |
| `src/host-compat.ts` | Wraps optional host methods and dialog sizing for graceful degradation |
| `src/config.ts` | Resolves config/profile paths, project identity, and shortcut configuration |
| `src/memories.ts` | Reads project-scoped Engram observations |
| `src/state.ts` | SolidJS signals for profile and badge state |

## Profile activation flow

```text
Profile JSON
   │
   ├── validate profile data
   ├── read on-disk OpenCode config
   ├── preserve complete agent definitions
   ├── apply model overrides
   ├── validate and sync eligible fallbacks
   ├── apply compatible reasoning effort
   ├── update OpenCode global config
   └── persist active profile name in KV
```

On-disk configuration is the primary activation source so `{file:...}` references are not accidentally materialized into inline content.

## Catalog model

Presentation, persistence, runtime synchronization, and fallback eligibility are separate concerns. An agent may be visible and persistible without being eligible for generated fallback synchronization.

That separation is especially important for OpenCode internal agents such as `compaction`, `summary`, and `title`.

## Host compatibility

Host calls are wrapped in safe compatibility helpers. Dense selection screens request `xlarge`; prompts and confirmations remain compact. Unsupported optional APIs degrade rather than crashing the plugin.

## Persistence boundaries

| Data | Location |
|---|---|
| Profile JSON | OpenCode config directory `/profiles` |
| Profile versions | OpenCode config directory `/profile-versions` |
| Active profile name | OpenCode KV state |
| Badge preferences | OpenCode KV state |
| Engram observations | Engram service/storage, read-only from this plugin |

## Build output

`tsup` compiles the SolidJS/OpenTUI entry into `dist/tui.js`. The npm export is `./tui`.
