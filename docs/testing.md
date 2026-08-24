# Testing and validation

## Full validation

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Expected baseline when this repository was created:

```text
Test files: 12 passed
Tests: 364 passed
Build artifact: dist/tui.js
```

## Focused suites

| Area | Command |
|---|---|
| Agent catalog | `npm test -- src/catalog.test.ts` |
| Dialog UX and navigation | `npm test -- src/dialogs.test.ts` |
| Profiles and activation | `npm test -- src/profiles.test.ts` |
| Reasoning effort | `npm test -- src/profile-reasoning.test.ts` |
| Host compatibility | `npm test -- src/host-compat.test.ts` |
| Orchestrator aliases | `npm test -- src/orchestrator.test.ts` |
| Engram memory browser | `npm test -- src/memories.test.ts` |

## Coverage

```bash
npm run test:coverage
```

Coverage is evidence, not the acceptance criterion by itself. Required behavior should be asserted at the nearest stable public boundary.

## Example fixtures

```bash
npm run examples
```

The examples validate inline/external OpenCode configurations and representative profile shapes.

## Manual TUI smoke test

After any TUI or activation change:

1. Run `npm run build`.
2. Fully restart OpenCode.
3. Open the manager with `Alt+K`.
4. Confirm all five catalog categories and 25 agent IDs.
5. Verify category labels never receive focus.
6. Open model and reasoning screens and confirm consistent grouping.
7. Activate a profile.
8. Confirm no plugin-load error appears.
9. Reopen the list and confirm `✓ Active`.
10. Restart OpenCode and confirm the marker persists.

## Pull request evidence

Each PR should report:

- focused test command and exact result;
- typecheck/build status when applicable;
- manual runtime scenario or explicit reason it is not applicable;
- rollback boundary.
