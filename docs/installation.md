# Installation & Distribution Guide

This guide covers installing the SDD Profile Manager via versioned downloadable release archives, npm package, or a local development checkout.

## Prerequisites

- Node.js 24 (`>=24 <25`)
- OpenCode `>=1.17.11`
- Optional: Engram for persistent memory browsing

---

## Method 1 — Downloadable Release Archive (Recommended)

GitHub Releases provide ready-to-use versioned executable bundles with zero compilation steps.

> Note: The release archive is a versioned ZIP / tar.gz containing the runnable plugin bundle (`dist/tui.js`), vendored plugin assets, documentation, and checksums. It is not a native `.exe` binary.

1. Download `sdd-profile-manager-v2.0.0.zip` (or `.tar.gz`) and verify with `SHA256SUMS` from [GitHub Releases](https://github.com/RamonsDka/opencode-sdd-profile-manager/releases).
2. Extract the archive into a dedicated plugins folder:
   - Linux/macOS: `~/.config/opencode/plugins/sdd-profile-manager`
   - Windows: `C:\Users\<user>\.config\opencode\plugins\sdd-profile-manager`
3. Configure `tui.json`:

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": [
       "C:\\Users\\<user>\\.config\\opencode\\plugins\\sdd-profile-manager\\dist\\tui.js"
     ]
   }
   ```
4. Restart OpenCode and press `Alt+K` or `/sdd-model`.

---

## Method 2 — npm Package

OpenCode can load the canonical npm package directly:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-sdd-profile-manager"
  ]
}
```

### Migration from Legacy `opencode-sdd-engram-manage`
If upgrading from the legacy `opencode-sdd-engram-manage` (v1.x) package:
1. Replace `"opencode-sdd-engram-manage"` with `"opencode-sdd-profile-manager"` in `tui.json`.
2. Existing profiles in `~/.config/opencode/profiles/` and snapshots in `~/.config/opencode/profile-versions/` remain 100% compatible.

---

## Method 3 — Install from Source Checkout

```bash
git clone https://github.com/RamonsDka/opencode-sdd-profile-manager.git
cd opencode-sdd-profile-manager
nvm use
npm ci
npm run build
```

The build creates `dist/tui.js` and synchronizes plugin assets into `dist/plugins/`.

Add the absolute path of `dist/tui.js` to `tui.json` and restart OpenCode.
