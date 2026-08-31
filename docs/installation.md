# Installation & Distribution Guide

This guide covers installing and deploying the **OpenCode SDD Profile Manager** principal plugin pack and its integrated companion plugins via versioned release archives, npm packages, or local source checkouts.

---

## Prerequisites

- **Node.js 24**: Major version 24 is required (`>=24 <25`).
- **OpenCode**: Version `>=1.17.11` (or `>=1.18.5` for full Suite de Agentes integration).
- **OpenTUI**: Version `>=0.4.2 <1`.
- **SolidJS**: Version `1.9.12`.
- **Optional**: [Engram](https://github.com/Gentle-AI/engram) running locally on port `7437` for project memory browsing.

---

## Deployment Matrix

| Deployment Method | Recommended For | Network Access Required? | Build Steps Required? |
|---|---|---|---|
| **Versioned Release Archive** | Production users, team workstations, air-gapped setups | No (offline bundle) | No (pre-built) |
| **npm Package** | Standard OpenCode automated package management | Yes (during initial download) | No (pre-built) |
| **Source Checkout** | Plugin contributors, custom feature development | Yes (for dependencies) | Yes (`npm run build`) |

---

## Method 1 — Downloadable Release Archive (Recommended)

GitHub Releases provide pre-compiled, verifiable distribution bundles containing `dist/tui.js`, vendored sub-plugins, documentation, and SHA-256 checksums.

1. Download `sdd-profile-manager-v2.0.1.zip` (or `.tar.gz`) from [GitHub Releases](https://github.com/RamonsDka/opencode-sdd-profile-manager/releases).
2. Extract the archive into your local OpenCode plugins directory:
   - **Linux / macOS**: `~/.config/opencode/plugins/sdd-profile-manager`
   - **Windows**: `C:\Users\<user>\.config\opencode\plugins\sdd-profile-manager`

3. Configure your OpenCode TUI configuration (`~/.config/opencode/tui.json` or `%USERPROFILE%\.config\opencode\tui.json`):

   **Linux / macOS (`~/.config/opencode/tui.json`):**
   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": [
       "~/.config/opencode/plugins/sdd-profile-manager/dist/tui.js"
     ]
   }
   ```

   **Windows (`C:\Users\<user>\.config\opencode\tui.json`):**
   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": [
       "C:\\Users\\<user>\\.config\\opencode\\plugins\\sdd-profile-manager\\dist\\tui.js"
     ]
   }
   ```

4. Restart OpenCode completely.
5. Press **`Alt+K`** or run **`/sdd-model`** to open the manager.

---

## Method 2 — npm Package

OpenCode can automatically install, cache, and load the canonical npm package:

1. Add `opencode-sdd-profile-manager` to your `tui.json`:

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": [
       "opencode-sdd-profile-manager"
     ]
   }
   ```

2. Restart OpenCode. The host will automatically resolve and cache the package.

### Upgrading from Legacy `opencode-sdd-engram-manage` (v1.x)
If upgrading from the legacy v1.x package:
1. Replace `"opencode-sdd-engram-manage"` with `"opencode-sdd-profile-manager"` in `tui.json`.
2. Existing profile configurations in `~/.config/opencode/profiles/` and snapshot histories in `~/.config/opencode/profile-versions/` remain 100% compatible.

---

## Method 3 — Build from Source Checkout

To build and run from the latest git checkout:

```bash
# 1. Clone repository
git clone https://github.com/RamonsDka/opencode-sdd-profile-manager.git
cd opencode-sdd-profile-manager

# 2. Ensure Node.js 24 is active
nvm use

# 3. Install locked dependencies
npm ci

# 4. Build TUI bundle and sync sub-plugin assets
npm run build
```

The build process generates `dist/tui.js` and populates `dist/plugins/`. Register the absolute path to `dist/tui.js` in `tui.json` and restart OpenCode.

---

## Standalone Sub-Plugin Deployments

### Suite de Agentes Standalone Deployment
If you wish to install Suite de Agentes independently of the principal pack:
1. Navigate to `plugins/suite-de-agentes/`.
2. Run the platform installer:
   - **POSIX**: `./install.sh [--agent-permissions recommended|prompt|none] [--replace-agent-config]`
   - **Windows**: `.\install.ps1 [-AgentPermissions recommended|prompt|none] [-ReplaceAgentConfig]`
3. See [`plugins/suite-de-agentes/docs/local-install.md`](../plugins/suite-de-agentes/docs/local-install.md) for full options.

### Task Manager Portable Standalone Deployment
Task Manager Portable requires no installation or runtime dependencies:
1. Copy `plugins/task-manager/Task-Manager-Portable.html` into your target project directory.
2. Double-click the file to open it in any modern browser (Chrome, Edge, Firefox, Safari).
3. See [`plugins/task-manager/docs/USAGE.md`](../plugins/task-manager/docs/USAGE.md) for usage details.

---

## Uninstallation & Cleanup

To remove the plugin:
1. Remove the plugin entry from `tui.json`.
2. (Optional) Delete profile configurations from `~/.config/opencode/profiles/` and snapshots from `~/.config/opencode/profile-versions/`.
3. Restart OpenCode.
