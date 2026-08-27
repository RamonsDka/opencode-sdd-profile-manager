# Design: TUI Profile Usability and Activation Fix

## Technical Approach

Keep the existing SolidJS/OpenTUI plugin architecture and profile JSON shape. Replace separator pseudo-options with native `DialogSelect` option categories, centralize ordered catalog metadata and eligibility, and make activation a best-effort pipeline that imports only complete definitions already present in installed/runtime configuration. Fix the separately owned global CommonJS resolver and validate that boundary independently. Strict TDD applies: each behavioral change starts with a failing focused test.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|---|---|---|
| `CATALOG_GROUPS` is the single ordered source; agent options carry `category` and no separator token/row is emitted | Keep synthetic dividers; post-sort UI rows | Native headers cannot receive focus/search/action, and source order preserves the exact requested category and agent sequence. Add `judgment-day` and `model-audit`; keep identifiers/tokens unchanged elsewhere. |
| Build visibility, persistence, fallback, and runtime-sync eligibility as explicit catalog predicates | Infer all behavior from `sdd-*` prefixes | Auxiliaries `compaction`, `summary`, and `title` remain primary model/effort editable and persisted, but never appear in fallback menus or generate fallback agents. |
| Activation partitions requested agents into resolvable and missing before applying changes | Fabricate `{ model }` agents; fail the whole profile | Definitions are discovered dynamically from complete existing objects in on-disk global config and host runtime config, cloned without inventing fields. Valid entries activate; one exact warning lists unresolved names in catalog order. |
| Dense menus request `xlarge` only through `safeSetDialogSize`; prompts/confirms retain current sizes | Numeric dimensions; OpenCode core change | Uses the supported host abstraction and degrades safely on hosts lacking the setter. |
| Test the global resolver beside the resolver with Node's built-in test runner | Hard-code a user-global path in Vitest; add a framework | The file is outside repository ownership and CommonJS. A sibling test validates the exact deployed module without coupling repository CI to one workstation path. |

## Data Flow

    CATALOG_GROUPS -> category-tagged options -> DialogSelect
    profile JSON -> discover installed definitions -> partition valid/missing
                 -> apply models/effort -> eligible fallback sync -> global.config.update
                 -> runtime/UI sync + exact missing-definition warning

    env root + segments -> resolve-home-path.cjs -> normalized module path -> plugin load

## File Changes

| File | Action | Description |
|---|---|---|
| `src/catalog.ts` | Modify | Exact groups/order and centralized visibility/fallback/runtime predicates. |
| `src/types.ts` | Modify | Remove separator row/token types; align persisted catalog keys. |
| `src/dialogs.tsx` | Modify | Category options, `Nivel de esfuerzo`, `agent: value`, and dense-only `xlarge`. |
| `src/profiles.ts` | Modify | Complete-definition discovery, partial activation, exact warnings, auxiliary-safe sync. |
| `src/catalog.test.ts` | Modify | Order and eligibility RED tests. |
| `src/dialogs.test.ts` | Modify | No separator options; category/copy/row/size RED tests. |
| `src/profiles.test.ts` | Modify | Persistence, discovery, partial activation, warning, and fallback RED tests. |
| `src/profile-reasoning.test.ts` | Modify | Auxiliary effort persistence and unchanged token/value tests. |
| `C:/Users/DELL/.config/opencode/bin/resolve-home-path.cjs` | Modify | Join configured root with all segments; HOME/USERPROFILE fallback. |
| `C:/Users/DELL/.config/opencode/bin/resolve-home-path.test.cjs` | Create | Isolated `node:test` resolver boundary tests. |

## Interfaces / Contracts

`discoverInstalledAgentDefinitions(diskConfig, runtimeConfig, names)` returns cloned complete definitions plus exact missing names. “Complete” means an existing non-array agent object from an authoritative config source; model-only placeholders are never constructed. Activation returns the applied config and emits a warning containing every unresolved requested agent.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Catalog order/categories, eligibility, labels, unchanged values, resolver inputs | Vitest; sibling `node --test` for CJS resolver |
| Integration | Partial activation, definition import, fallback exclusion, runtime/UI result | Mock filesystem and host config APIs in `profiles.test.ts` |
| E2E | Not available | Manual restart smoke test using deployed `dist/tui.js` |

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior and planned RED test |
|---|---|---|
| Path/env traversal | Applicable | Root plus relative segments normalizes; reject/avoid segments resolving outside the selected root. RED: `..`, absolute segment, empty/malformed segment. |
| Spaces and malformed env | Applicable | Preserve spaces; absent workspace root falls back to HOME/USERPROFILE; missing all roots throws named error. RED per case. |
| Module-loading target | Applicable | Resolve complete file path; missing/invalid target reports the full untruncated path. RED: spaced missing target and directory/file mismatch. |
| Documentation-like executable classification | N/A | Resolver receives path segments and does not classify executables. |
| Git repository, commit, push, PR commands | N/A | No VCS or command-composition boundary. |

## Migration / Rollout

No profile data migration. Run focused RED/GREEN tests, full `npm test`, `npm run typecheck`, then `npm run build`. Because `tui.json` loads this repository's `dist/tui.js`, fully restart OpenCode after rebuilding; reload is insufficient for resolver/module caching. Smoke-test activation with and without `OPENCODE_WORKSPACE_ROOT` and with spaces. Roll back repository commits/build output independently from restoring the two global resolver files.

## Open Questions

None blocking.
