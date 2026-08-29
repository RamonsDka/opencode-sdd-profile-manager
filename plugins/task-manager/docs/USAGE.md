# Task Manager Portable — Usage Guide

This guide explains how to embed, view, and maintain **Task Manager Portable** in your projects.

---

## Basic Setup

1. Copy `Task-Manager-Portable.html` into the root directory of your project.
2. Double-click the file to open it in your default web browser.
3. Keep the file tracked in Git so the entire team can inspect project status locally.

```text
my-project/
├── app/
├── tests/
├── package.json
└── Task-Manager-Portable.html
```

No server, `npm install`, or Internet connection is required to view or use the dashboard.

---

## Updating Project State

Locate the embedded JSON island inside `Task-Manager-Portable.html`:

```html
<script type="application/json" id="tm-state">
{
  "schemaVersion": "1.0",
  "meta": { "projectName": "My Project", "version": "1.0.0" },
  "phases": [],
  "todos": []
}
</script>
```

Edit only the JSON content between the `<script>` and `</script>` tags. After editing:
1. Save the file.
2. Switch back to your browser.
3. Reload with **`Ctrl+R`** (or **`Cmd+R`**).

---

## Available Task Statuses

| Status | Usage |
|---|---|
| `pending` | Task planned but not yet started |
| `in-progress` | Task actively being worked on |
| `completed` | Task finished and verified |
| `blocked` | Task halted due to an external blocker or dependency |

---

## Interface Navigation

| Tab / Section | Content & Functionality |
|---|---|
| **Executive HUD** | Global progress metrics, risk distribution, phase completion, and insights |
| **Phases & Tasks** | Search filters, phase accordions, and detailed task cards |
| **Kanban Board** | Visual status columns for sprint task flow |
| **CodeGraph** | Declared module boundaries and symbol dependency relationships |
| **Repository Tree** | Structural overview of directories and key files |
| **Git Stream** | Timeline of declared commits, branches, and verification receipts |
| **AI Console** | AI orchestration instructions, prompt templates, and JSON export |

---

## Sharing & Collaboration

You can share `Task-Manager-Portable.html` via email, Slack, USB drive, or cloud storage. The recipient only needs a standard web browser to view the complete interactive cockpit.

---

## Troubleshooting

| Problem | Recommended Action |
|---|---|
| Error banner displayed | Check JSON syntax for missing commas or quotes; verify `schemaVersion: "1.0"`. |
| Progress does not update | Update individual task statuses (`completed`, `in-progress`); percentages are derived automatically. |
| A panel appears empty | Add data to `git`, `tree`, or `codegraph` in the JSON state. |
| Text contains `</script>` | Escape closing script tags as `\u003c/script\u003e` inside JSON strings. |
| Browser blocks local file access | This is expected browser security behavior for `file://`; all data is supplied via the embedded JSON block. |

---

## Next Steps

- See [`CUSTOMIZATION.md`](CUSTOMIZATION.md) for full schema definitions.
- See [`AI-ORCHESTRATOR-GUIDE.md`](AI-ORCHESTRATOR-GUIDE.md) to automate updates via AI assistants.
