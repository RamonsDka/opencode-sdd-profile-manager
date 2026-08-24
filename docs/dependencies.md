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

`package.json` pins selected transitive packages for security and reproducibility. Review overrides when updating npm, Vite, esbuild, YAML parsing, HTTP clients, or Babel.

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
