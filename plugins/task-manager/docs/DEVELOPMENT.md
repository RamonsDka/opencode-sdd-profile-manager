# Task Manager Portable — Development & Verification

This guide is intended for developers contributing to or modifying Task Manager Portable. End users viewing `Task-Manager-Portable.html` do not need any development tools.

---

## Prerequisites

- **Node.js**: Version 20 or higher (CI uses Node.js 24)
- **npm**
- **Chromium** (for Playwright browser end-to-end testing)

---

## Setup

```bash
cd plugins/task-manager
npm install
```

---

## Verification Commands

| Command | Purpose |
|---|---|
| `npm test` | Runs the Node test suite using Happy DOM across platforms |
| `npm run check` | Typechecks JavaScript source modules using TypeScript `checkJs` |
| `npm run assemble` | Assembles source modules into `Task-Manager-Portable.html` |
| `npm run test:browser` | Executes real Playwright browser end-to-end verification |
| `node scripts/scan-portability.mjs` | Audits offline contracts, JSON island integrity, and file size |

---

## Development Workflow

1. Execute tests for the specific module you intend to modify.
2. Add a failing unit test asserting the desired behavior.
3. Implement the minimal change in `modules/`.
4. Run focused tests:
   ```bash
   npm test
   ```
5. Run the typechecker:
   ```bash
   npm run check
   ```
6. Re-assemble the distributable HTML:
   ```bash
   npm run assemble
   ```
7. Run the browser suite and portability scanner:
   ```bash
   npm run test:browser
   node scripts/scan-portability.mjs
   ```

---

## Invariant Rules

- Exactly one `script#tm-state` element must exist in the HTML.
- Zero external runtime dependencies, network calls, or CDN scripts.
- No task state persisted in browser `localStorage`.
- All text rendered from state must be properly escaped against XSS.
- The file must open and function cleanly via direct `file://` double-click.
- Distributable `Task-Manager-Portable.html` is generated exclusively via `scripts/assemble.mjs`—never edit it manually.
