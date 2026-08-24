# Usage

## Open the manager

Use `Alt+K`, `Super+K`, `:sdd-model`, or `/sdd-model`.

The entry screen provides profile creation, profile management, Engram project memories, and badge preferences.

## Create a profile

1. Choose **Create new SDD profile**.
2. Enter a safe profile name.
3. Open the created profile.
4. Configure models and reasoning effort.
5. Activate it when ready.

Profile names reject traversal and unsafe path characters.

## Configure models

The profile detail screen shows the full catalog in five visual categories:

1. Orchestrator
2. SDD Core
3. Judgment Day
4. Reviewers
5. Auxiliaries

Selecting an agent opens the provider and model picker. Unassigned agents remain visible so the profile can be completed incrementally.

## Configure reasoning effort

Open **Reasoning effort** and select an agent. The supported values come from the selected model's provider metadata:

```text
low
medium
high
xhigh
max
```

If the current model does not advertise configurable reasoning, the TUI explains why the setting cannot be edited.

Internally the profile preserves the OpenCode field name `reasoningEffort`.

## Configure fallback models

Only fallback-eligible agents appear in this screen. `compaction`, `summary`, and `title` can retain model and reasoning configuration but do not receive generated fallback agents.

Dynamic agents require explicit fallback assignments; the plugin does not invent fallback definitions.

## Bulk actions

Bulk actions support two safe modes:

- **Complete missing** — fills unassigned entries and preserves existing choices.
- **Overwrite** — replaces the selected group intentionally.

Profile versions are created around behavior-changing mutations so previous states can be restored.

## Activate a profile

Activation:

1. Reads the on-disk OpenCode configuration to preserve declarative `{file:...}` references.
2. Applies only complete installed or configured agent definitions.
3. Applies valid model and reasoning assignments.
4. Synchronizes eligible fallback agents.
5. Reports exact agent names whose complete definitions were unavailable.
6. Persists the active profile name.

After activation, the list displays:

```text
✓ profile-name
  ✓ Active
```

The marker survives list reopening and plugin restart through OpenCode KV state.

## Restore a version

Open **Profile versions**, inspect a preview, and restore the selected snapshot. Version files live separately from the profile JSON.

## View Engram memories

Choose **Project memories** to browse recent observations for the resolved project. The screen is read-only and does not change profile state.

## Badge modes

The status badge can be hidden or switched between:

- active model information;
- active profile name.

Badge preferences are stored through the host KV API.
