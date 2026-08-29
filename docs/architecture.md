# Architecture

## System Boundary & Overview

The `opencode-sdd-profile-manager` repository functions as the **principal plugin pack** for OpenCode. It operates as an OpenTUI terminal plugin and host orchestrator that coordinates model profiles, agent suites, offline project dashboards, and memory inspection without superseding host configuration ownership.

```text
OpenCode Host (TUI & Server Runtime)
    │
    ├── index.tsx — Plugin lifecycle, command registration, and status badge
    │
    └── src/dialogs.tsx — OpenTUI dialog workflows and screen routing
            │
            ├── src/catalog.ts — 25-agent ordered catalog and eligibility rules
            ├── src/profiles.ts — Profile I/O, atomic persistence, version snapshots
            ├── src/profile-reasoning.ts — Reasoning effort resolution and compatibility
            ├── src/orchestrator.ts — Orchestrator prompt aliases and fallback policy
            ├── src/host-compat.ts — Screen-aware dialog sizing and capability guards
            ├── src/memories.ts — Engram HTTP client for project observations
            ├── src/config.ts — Configuration paths and project identity resolution
            ├── src/state.ts — SolidJS reactive signals for active profile and badge state
            │
            └── src/plugins/ — Integrated Sub-Plugin Hub
                    ├── registry.ts — Plugin discovery and path security guards
                    ├── suite-adapter.ts — Suite de Agentes runtime integration bridge
                    ├── task-manager-classifier.ts — Intent detection for task operations
                    ├── task-manager-coordinator.ts — Multi-agent task coordinator
                    ├── task-manager-dispatcher.ts — Task dispatch and lifecycle events
                    ├── task-manager-git.ts — Git timeline extraction and audit logging
                    ├── task-manager-lifecycle.ts — Task state transitions and validation
                    ├── task-manager-merge.ts — State merging for JSON island updates
                    ├── task-manager-onboarding.ts — Automated project scaffolding
                    ├── task-manager-preferences.ts — UI-only preferences management
                    ├── task-manager-root.ts — Root discovery for task manager artifacts
                    ├── task-manager-routing.ts — Action routing and execution pipeline
                    ├── task-manager-telemetry.ts — Token usage and execution metrics
                    ├── task-manager-writer.ts — Safe atomic file writing for task state
                    └── offline-help.ts — Self-contained documentation renderer
```

---

## Subsystem Responsibilities

| Subsystem / Module | Responsibility |
|---|---|
| `index.tsx` | Registers plugin commands (`:sdd-model`, `/sdd-model`) and shortcuts (`Alt+K`), initializes configuration, and manages status bar badges. |
| `src/dialogs.tsx` | Constructs OpenTUI Solid components for profile management, model selection, reasoning effort, bulk actions, and plugin navigation. |
| `src/catalog.ts` | Maintains the canonical 25-agent ordered catalog and enforces runtime eligibility and fallback synchronization rules. |
| `src/profiles.ts` | Manages profile JSON serialization, atomic file writing, version snapshot history, and profile activation against OpenCode configuration. |
| `src/profile-reasoning.ts` | Inspects AI model provider metadata to determine reasoning effort support (`low`, `medium`, `high`, `xhigh`, `max`) and validates values. |
| `src/orchestrator.ts` | Preserves orchestrator prompt configurations across inline text and external `{file:...}` references, injecting required fallback policies. |
| `src/host-compat.ts` | Wraps OpenTUI host methods with screen-aware dimension calculations (`small`, `medium`, `large`, `xlarge`) and graceful degradation. |
| `src/memories.ts` | Interfaces asynchronously with the local Engram HTTP server (`127.0.0.1:7437`) to read and manage project-scoped observations. |
| `src/plugins/registry.ts` | Discovers available integrated plugins (Suite de Agentes, Task Manager) and enforces safe path inspection. |
| `src/plugins/suite-adapter.ts` | Bridges OpenCode runtime events to Suite de Agentes catalog and consent management workflows. |
| `src/plugins/task-manager-*.ts` | Implements task classification, coordination, git timeline extraction, token telemetry, and atomic `#tm-state` JSON updates. |

---

## Profile Activation & Synchronization Flow

```text
Profile JSON Selection (e.g. team-production.json)
    │
    ├── 1. Validate profile structure and model IDs
    ├── 2. Read on-disk OpenCode configuration (preserving {file:...} references)
    ├── 3. Match complete installed agent definitions
    ├── 4. Apply primary model overrides
    ├── 5. Apply validated reasoning effort options
    ├── 6. Synchronize eligible fallback sub-agents (*-fallback)
    ├── 7. Persist updated configuration atomically
    └── 8. Save active profile name in OpenCode KV store
```

By reading the on-disk OpenCode configuration as the primary activation baseline, declarative `{file:...}` prompt links are never unintentionally expanded into raw inline content.

---

## Catalog Presentation & Fallback Model

Presentation order, persistence, runtime synchronization, and fallback eligibility are strictly separated concerns:

- **Orchestrator**: `sdd-ORCHETATOR` (primary coordinator; prompts checked for fallback routing).
- **SDD Core Agents**: `sdd-propose`, `sdd-design`, `sdd-apply`, `sdd-verify`, `sdd-spec`, `sdd-onboard`, `sdd-explore`, `sdd-init`, `sdd-tasks`, `sdd-archive` (eligible for fallback synchronization).
- **Judgment Day Agents**: `jd-judge-a`, `jd-judge-b`, `jd-fix-agent` (eligible for fallback synchronization).
- **Reviewer Agents**: `review-readability`, `review-reliability`, `review-resilience`, `review-validator`, `review-refuter`, `review-risk`, `model-audit` (eligible for fallback synchronization).
- **Auxiliary Agents**: `gentle-ai-windows-validator`, `compaction`, `summary`, `title` (support model and reasoning configuration, but internal agents like `compaction`, `summary`, and `title` are excluded from fallback generation).

---

## Integrated Plugin Pack Architecture

### 1. Suite de Agentes (Agent Suite)
Suite de Agentes (`plugins/suite-de-agentes`) operates as an integrated and standalone sub-plugin:
- Provides an OpenTUI catalog of seed and custom agents.
- Manages AI provider discovery and model assignments per agent.
- Enforces strict security boundaries: internal agents (`sdd-*`, `review-*`, `jd-*`) are permanently allowlisted, while external sub-agents require per-turn user consent (`usa también agente: <agent-id>`).

### 2. Task Manager Portable
Task Manager Portable (`plugins/task-manager`) provides an offline-first project dashboard:
- Self-contained single HTML file (`Task-Manager-Portable.html`) with zero runtime dependencies.
- Consumes state exclusively from an embedded `<script type="application/json" id="tm-state">` tag.
- Visualizes sprint progress, Kanban columns, project phases, CodeGraph architectural maps, and Git commit timelines.
- Protected by browser `file://` sandboxing: never attempts local network requests or direct disk access.

---

## Host Compatibility & Degradation

All TUI screens use capability-guarded calls through `src/host-compat.ts`:
- Screen-aware dialog sizing dynamically scales from compact confirmation boxes to full-screen `xlarge` catalogs.
- Terminals with limited dimensions or unsupported optional OpenTUI features degrade gracefully to standard textual layouts rather than crashing.

---

## Persistence & Storage Boundaries

| Artifact | Storage Location | Privacy & Security Boundary |
|---|---|---|
| Profile Configurations | `~/.config/opencode/profiles/*.json` | Portable model and reasoning definitions; no secrets |
| Profile Version History | `~/.config/opencode/profile-versions/*.json` | Snapshots of prior configurations (up to 60 per profile) |
| Active Profile State | OpenCode KV store (`active_profile`) | Local-only key-value storage |
| Status Badge Preferences | OpenCode KV store (`badge_mode`) | Display preferences (`model`, `profile`, `off`) |
| Engram Observations | Local Engram HTTP server (`127.0.0.1:7437`) | Project memory observations; local loopback only |
| Task Manager State | `#tm-state` inside `Task-Manager-Portable.html` | Project-scoped JSON island; fully client-side |

---

## Build Pipeline & Packaging

The build pipeline compiles the TypeScript and SolidJS sources into optimized production artifacts:
1. `tsup` compiles `index.tsx` into `dist/tui.js`.
2. `scripts/copy-plugin-assets.ts` copies vendored sub-plugin assets and documentation into `dist/plugins/`.
3. `scripts/package-release.mjs` bundles deterministic ZIP and tar.gz release archives with `SHA256SUMS.txt`.
