# Testing & Verification Guide

This guide details the test suites, verification pipelines, and smoke testing procedures for the **OpenCode SDD Profile Manager** principal plugin pack and its integrated companion plugins.

---

## 1. Full Validation Pipeline

To run the complete verification suite across all components:

```bash
# Clean dependency installation
npm ci

# Typecheck TypeScript codebase
npm run typecheck

# Execute Vitest test suite
npm test

# Verify plugin pack packaging and asset distribution
npm run verify:plugins

# Build production artifacts
npm run build
```

---

## 2. Test Suite Architecture

The repository tests core business logic, OpenTUI dialog rendering, fallback policies, and sub-plugin adapters:

| Test Area | Target Suite | Key Invariants Asserted |
|---|---|---|
| **Agent Catalog** | `src/catalog.test.ts` | 25-agent ordering, category groupings, visibility, and fallback eligibility rules |
| **Dialog UX & Sizing** | `src/dialogs.test.ts`, `src/dialogs.test.tsx` | OpenTUI Solid rendering, screen sizing tiers (`small` to `xlarge`), user input routing |
| **Profile Management** | `src/profiles.test.ts` | Atomic JSON serialization, safe path traversal rejection, version snapshots, activation |
| **Reasoning Effort** | `src/profile-reasoning.test.ts` | Model provider capability checks, effort tier validation (`low` to `max`), schema persistence |
| **Host Compatibility** | `src/host-compat.test.ts` | OpenTUI version detection, optional host API guards, graceful degradation |
| **Orchestrator Policy** | `src/orchestrator.test.ts`, `scripts/ensure-orchestrator-fallback-policy.test.ts` | Fallback policy block presence in inline and `{file:...}` external prompt configurations |
| **Engram HTTP Client** | `src/memories.test.ts` | Loopback HTTP fetch mocking, asynchronous project observation aggregation, error handling |
| **Plugin Pack Hub** | `src/plugins/registry.test.ts`, `src/plugins/suite-adapter.test.ts` | Sub-plugin discovery, safe path inspection, Suite de Agentes bridge |
| **Task Manager Core** | `src/plugins/task-manager-*.test.ts` | Task classification, coordination, git extraction, token telemetry, and `#tm-state` updates |
| **Suite de Agentes** | `plugins/suite-de-agentes/test/*.test.ts` | Agent catalog navigation, per-turn consent ledger, provider selection, security policies |
| **Task Manager Portable**| `plugins/task-manager/tests/*.test.mjs` | Zero runtime dependencies, Happy DOM rendering, JSON island parsing, Kanban calculations |

---

## 3. Focused Test Execution

To execute specific suites during iterative development:

```bash
# Profile and reasoning tests
npm test -- src/profiles.test.ts src/profile-reasoning.test.ts

# Dialog and UX tests
npm test -- src/dialogs.test.ts src/host-compat.test.ts

# Integrated sub-plugin tests
npm test -- src/plugins/

# Test coverage report
npm run test:coverage
```

---

## 4. Fallback Policy Validation

Verify and ensure orchestrator prompt configurations maintain necessary fallback routing blocks:

```bash
# Check orchestrator prompt fallback policy without modifying files
npm run orchestrator:fallback:check

# Apply fallback policy block to orchestrator prompts
npm run orchestrator:fallback:apply

# Execute fallback unit tests
npm run test:fallback
```

---

## 5. Example Fixtures & Smoke Testing

Smoke test example configurations located in `examples/`:

```bash
npm run examples
```

Validates:
1. Fallback policy injection for both inline and external prompt configurations.
2. Readability of new (`models` + `fallback` + `configs`) and legacy profile JSON formats.
3. Safe preservation of `{file:...}` prompt links.

---

## 6. Manual OpenTUI Smoke Test Checklist

After making modifications to TUI dialogs or activation logic:

1. Run `npm run build` to generate `dist/tui.js`.
2. Fully restart OpenCode.
3. Open the manager with **`Alt+K`**.
4. Confirm all 5 categories and 25 agents are visible in correct order.
5. Verify category headers are non-selectable visual labels.
6. Open **Reasoning effort** and confirm supported tiers match active model capabilities.
7. Perform a bulk assignment and confirm a new version snapshot is recorded in **Profile versions...**.
8. Activate a profile and verify the persistent `✓ Active` marker.
9. Open **Plugins...** and verify navigation to Suite de Agentes and Task Manager.
