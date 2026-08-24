# Installation

This guide covers a source checkout loaded directly by OpenCode. That path is the safest way to evaluate unreleased changes.

## Prerequisites

- Git
- Node.js 24 (`>=24 <25`)
- npm with lockfile support
- OpenCode `>=1.17.11`

Verify the environment:

```bash
node --version
npm --version
opencode --version
```

The checked-in `.nvmrc` currently selects Node `24.14.0`. npm may report an engine warning for a transitive development package that requests Node `24.15.0` or newer; the project typecheck, complete test suite, and build have been verified on `24.14.0`. Prefer the latest available Node 24 patch when setting up a new environment.

## Install from source

```bash
git clone https://github.com/RamonsDka/opencode-sdd-profile-manager.git
cd opencode-sdd-profile-manager
nvm use
npm ci
npm run build
```

The build creates:

```text
dist/tui.js
```

## Register the TUI plugin

OpenCode loads TUI plugins from `tui.json`.

### Linux and macOS

Edit `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "/absolute/path/to/opencode-sdd-profile-manager/dist/tui.js"
  ]
}
```

### Windows

Edit `C:\Users\<user>\.config\opencode\tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "C:\\projects\\opencode-sdd-profile-manager\\dist\\tui.js"
  ]
}
```

Use an absolute path and escape backslashes inside JSON strings.

## Restart and verify

Close every OpenCode process, start it again, and use one of:

```text
Alt+K
Super+K
:sdd-model
/sdd-model
```

Expected result: the **SDD Profile Management** menu opens.

## Update a source installation

```bash
git pull --ff-only
npm ci
npm run typecheck
npm test
npm run build
```

Restart OpenCode after rebuilding.

## Remove the plugin

1. Remove the local bundle path from `tui.json`.
2. Restart OpenCode.
3. Delete the clone only if its profiles are not stored inside it. By default, profile data lives under the OpenCode configuration directory, outside the repository.

## Optional Engram integration

Profile management does not require Engram. The **Project memories** screen requires a reachable Engram installation and a resolvable project context.

## Validation checklist

- [ ] `npm ci` completes.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` creates `dist/tui.js`.
- [ ] OpenCode restarts without a plugin-load error.
- [ ] `Alt+K` opens the manager.
