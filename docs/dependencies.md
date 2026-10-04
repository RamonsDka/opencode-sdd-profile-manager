# Dependencies

## Version policy

The repository uses a locked development dependency graph (`package-lock.json`) and peer dependency ranges for libraries provided by the OpenCode host.

Node.js is intentionally constrained to major version 24:

```json
{
  "node": ">=24 <25"
}
```

## Runtime peer dependencies

| Library | Role |
|---|---|
| `@opencode-ai/plugin` | OpenCode plugin API and host integration |
| `@opentui/core` | Terminal UI types and primitives |
| `@opentui/keymap` | Shortcut expansion and keymap support |
| `@opentui/solid` | SolidJS renderer for OpenTUI |
| `solid-js` | Reactive signals, roots, and effects |

Peer dependencies are not bundled as independent runtime copies; OpenCode supplies the compatible host environment.

## Development dependencies

| Library | Role |
|---|---|
| TypeScript | Static type checking |
| Vitest | Unit and integration-style tests |
| `@vitest/coverage-v8` | Coverage reporting |
| tsup | ESM bundle creation |
| `esbuild-plugin-solid` | Solid JSX transformation |
| semantic-release | Conventional-commit-driven releases |

## Overrides

`package.json` pins selected transitive packages for security and reproducibility. Review overrides when updating npm, Vite, esbuild, YAML parsing, HTTP clients, or Babel. Two nested overrides additionally pin the `solid-js` peer of `@opentui/keymap` and `@opentui/solid` to the root `solid-js` (`$solid-js`, currently 1.9.15): both packages publish an exact `1.9.12` peer that otherwise breaks `npm ci` with ERESOLVE. Keep the root Solid version as the single identity; do not downgrade it to satisfy the upstream pin and do not replace these entries with `--force`/`--legacy-peer-deps`. The standalone manifests `plugins/suite-de-agentes/package.json` and `plugins/opencode-session-vault/package.json` carry the same two nested `solid-js` overrides against their own `1.9.15` dev dependency so isolated `npm install --package-lock-only --ignore-scripts --dry-run` resolves GREEN in all three manifests; `src/host-v2.test.ts` imports `plugins/suite-de-agentes/node_modules/solid-js/dist/dev.js`, so the suite install must succeed for the V2 bridge test. Node 24 reports an unsupported-engine warning for `@opentui/core@0.5.14` (requires `node >=26.4.0`); it does not block install or tests and is left unresolved.

## Known install audit state

At repository creation, `npm ci` reported transitive audit findings in development/release tooling. The application test and build baseline remained green. Do not run `npm audit fix --force` blindly: it may replace major versions and invalidate the lockfile contract. Review [`docs/npm-vulnerability-audit.md`](npm-vulnerability-audit.md) and update dependencies in a focused issue/PR with full verification.

## Install strategy

Use:

```bash
npm ci
```

Do not replace the lockfile casually. Dependency upgrades should include:

1. lockfile diff review;
2. `npm run typecheck`;
3. `npm test`;
4. `npm run build`;
5. a restarted OpenCode smoke test.
