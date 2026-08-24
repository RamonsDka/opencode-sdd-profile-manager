# Troubleshooting

## `Alt+K` does nothing

1. Confirm the local `dist/tui.js` path exists.
2. Confirm that exact absolute path appears in `tui.json`.
3. Fully restart OpenCode.
4. Try `:sdd-model` or `/sdd-model`.

If the command works but the shortcut does not, the terminal or operating system may intercept the key combination. Configure alternatives in `sdd-model-select.json`.

## Plugin file cannot be loaded

Check:

- JSON backslashes are escaped on Windows;
- the configured path points to a file, not a directory;
- `npm run build` completed;
- paths containing spaces are preserved as one JSON string;
- OpenCode was restarted after the build.

Do not construct plugin paths by splitting shell strings. Use absolute file paths or properly joined path segments.

## The active profile is not marked

Activate the profile again, close the list, and reopen it. The plugin prioritizes the persisted active profile name when it matches an existing profile file, then falls back to configuration comparison.

If the file was renamed or deleted outside the plugin, activate a valid profile to refresh the persisted state.

## A model appears as `Unassigned`

The catalog intentionally displays all supported agents, even when the profile has no assignment. Select the row to choose a provider and model.

## Reasoning effort cannot be edited

Assign a primary model first. Reasoning effort is available only when provider metadata advertises supported effort levels.

## An agent is skipped during activation

Profiles contain assignments, not complete agent definitions. The plugin applies an absent agent only when a complete definition is already installed or available from runtime configuration. Missing definitions are reported instead of fabricated.

## Fallback is unavailable for an auxiliary agent

This is expected for `compaction`, `summary`, and `title`. They support model and compatible reasoning configuration but are intentionally excluded from fallback generation.

## Engram memories do not load

Verify that Engram is available and that the current directory resolves to the intended project. Profile management is independent and should continue working.

## OpenCode still uses an old build

OpenCode does not hot-reload TUI plugins. Rebuild, close all OpenCode processes, then start a new process.
