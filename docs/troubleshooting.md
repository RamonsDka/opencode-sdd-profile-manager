# Troubleshooting & Diagnostic Guide

This document provides diagnostic steps and resolutions for common issues encountered when using the **OpenCode SDD Profile Manager** principal plugin pack and its integrated components.

---

## 1. Keybindings & Plugin Discovery

### Symptom: `Alt+K` or `Alt+S` does nothing
1. **Verify Plugin Registration**: Check your `tui.json` (`~/.config/opencode/tui.json` or `%USERPROFILE%\.config\opencode\tui.json`) to confirm `dist/tui.js` is declared as an absolute path or valid package specifier.
2. **Verify Bundle Exists**: Confirm `npm run build` completed and `dist/tui.js` exists on disk.
3. **Restart OpenCode**: OpenCode loads TUI plugins strictly at startup. Hot-reloading is not supported; restart all running OpenCode instances.
4. **Test Alternative Commands**: In the chat prompt, run `/sdd-model` or `:sdd-model`.
5. **Shortcut Collisions**: Certain terminal emulators or window managers intercept `Alt+K`. Configure alternative shortcuts in `~/.config/opencode/sdd-model-select.json`:
   ```json
   {
     "shortcuts": ["alt+k", "super+k", "ctrl+shift+p"]
   }
   ```

---

## 2. Profile Activation & Status Indicators

### Symptom: Active profile indicator (`✓ Active`) is missing
- **Reactivate Profile**: Open the profile in the manager and choose **Activate profile**.
- **External Renaming**: If a profile JSON was renamed or deleted externally, open the profile list and activate a valid profile to synchronize OpenCode KV state.
- **On-Disk Permissions**: Ensure the profile directory `~/.config/opencode/profiles/` has read/write permissions for the current user.

### Symptom: Reasoning effort setting is disabled
- **Provider Metadata**: Reasoning effort configuration requires the assigned model provider to advertise reasoning support (e.g. Anthropic Claude 3.7 Sonnet, OpenAI o3-mini, Google Gemini 2.0 Flash Thinking). If using a non-reasoning model, the setting cannot be modified.
- **Assign Primary Model First**: Assign a compatible primary model before configuring its reasoning effort tier.

### Symptom: Auxiliary agents cannot configure fallbacks
- **Expected Behavior**: Auxiliary internal agents (`compaction`, `summary`, `title`) support model and reasoning assignments, but are intentionally excluded from fallback sub-agent generation.

---

## 3. Engram Memory Integration

### Symptom: "Project memories" shows an error or empty list
1. **Server Status**: Verify the Engram server is running locally on loopback (`http://127.0.0.1:7437`).
2. **Port Configuration**: If running Engram on a non-default port, ensure the `ENGRAM_PORT` environment variable is set.
3. **Git Project Detection**: Ensure the current working directory is inside a Git repository. Engram indexes observations based on Git remote and root identity.
4. **Graceful Fallback**: Failure to connect to Engram does not impair profile management or model switching.

---

## 4. Task Manager Portable Dashboard

### Symptom: Blank screen or error banner in Task Manager Portable
1. **Check JSON Syntax**: Open `Task-Manager-Portable.html` in an editor and inspect the `<script type="application/json" id="tm-state">` block. Ensure the JSON is valid with no trailing commas.
2. **Schema Version**: Ensure `"schemaVersion": "1.0"` is present at the root of the JSON state.
3. **Closing Script Tags**: Ensure any `</script>` string inside descriptions or notes is escaped as `\u003c/script\u003e`.

### Symptom: Browser security warnings when opening `Task-Manager-Portable.html`
- **File Origin Restrictions**: Modern browsers enforce opaque origins on `file://` URLs. Task Manager Portable is deliberately self-contained and does not perform network requests or disk reads. All data must reside inside the embedded `#tm-state` island.

---

## 5. Terminal Display & Dialog Sizing

### Symptom: OpenTUI dialogs appear clipped or truncated
- **Terminal Dimensions**: Increase your terminal window size. The plugin implements screen-aware sizing and requests `xlarge` dimensions for dense catalog views.
- **Font & UTF-8 Support**: Ensure your terminal emulator supports UTF-8 characters and box-drawing glyphs (`✓`, `─`, `│`, `┌`, `└`).

---

## 6. Diagnostic Checklist

Run the built-in diagnostic commands to verify repository and runtime integrity:

```bash
# Verify TypeScript definitions
npm run typecheck

# Run all test suites
npm test

# Verify plugin pack packaging and asset distribution
npm run verify:plugins

# Check orchestrator fallback prompt policies
npm run orchestrator:fallback:check
```
