# Architecture / Arquitectura

## Objective / Objetivo

Maintain a comprehensive, interactive project dashboard within a **single standalone HTML file** that operates 100% offline and can be updated exclusively by modifying an embedded JSON state block.

---

## Data Flow / Flujo de datos

```text
#tm-state JSON
     │
     ▼
TMCore (Parser & Derivations)
├── parseIsland
├── validateState
├── deriveMetrics
└── deriveInsights
     │
     ├── TMHeaderHud → Header metrics, HUD summary, and dialogs
     ├── TMPhases    → Project phases, search filters, and Kanban board
     ├── TMPanels    → Git timeline, repository tree, and CodeGraph map
     └── TMTodoHelp  → Signals, help overlays, and diagnostics
```

---

## Modular Source Files / Módulos fuente

| Module File | Subsystem Responsibility |
|---|---|
| `modules/01-skeleton.html` | Semantic HTML layout, CSS design tokens, and base styling |
| `modules/02-core.js` | JSON parsing, validation, metric calculations, and filtering logic |
| `modules/03-header-hud.js` | Header HUD, progress indicators, metrics, and insights dialogs |
| `modules/04-phases.js` | Project phases, task accordions, search filtering, and Kanban board |
| `modules/05-panels.js` | Git timeline, repository file tree, and CodeGraph visualization |
| `modules/06-todo-help.js` | Keyboard shortcuts, help modals, diagnostics, and JSON export |

The build script `scripts/assemble.mjs` concatenates these modular sources into the standalone `Task-Manager-Portable.html` deliverable.

---

## Core Architectural Invariants / Decisiones principales

### Single Declarative State / Un único estado declarativo
The embedded JSON island avoids external databases, servers, or cloud dependencies. All analytics and percentages are derived at runtime, ensuring no duplicated metrics in storage.

### Zero Runtime Dependencies / Cero dependencias runtime
The distributable HTML contains no `fetch` calls, ES module imports, external CDNs, or third-party web fonts. Dependencies in `package.json` exist solely for development, testing, and assembly (`Cero dependencias runtime`).

### Informational Contract / Interfaz informativa
The dashboard is strictly an observational, read-only interface. It never invokes shell commands or mutates filesystem contents, guaranteeing security when sharing files across teams.

### Graceful Degradation / Degradación controlada
Missing or partial data in optional sections (such as Git history or CodeGraph) degrades gracefully without preventing the rest of the dashboard from rendering. Malformed JSON renders a non-blocking recovery banner.

---

## Browser Security Sandbox / Seguridad de `file://`

Web browsers isolate local HTML files using opaque origins. Task Manager Portable adheres strictly to this sandbox:
- Never requests directory inspection permissions.
- Never reads `.git` or local configuration directly.
- Does not persist project state in browser `localStorage`.
- Consumes state exclusively from the embedded `#tm-state` JSON element.

---

## Accessibility & Responsiveness / Accesibilidad

- Keyboard navigation support (`navegación por teclado`).
- Visible focus rings across interactive controls.
- Native HTML `<dialog>` elements with focus restoration (`diálogos nativos con restauración de foco`).
- Statuses conveyed with text labels and iconography, not color alone.
- Respects `prefers-reduced-motion` media queries.
- Responsive layout tested up to 200% zoom.
