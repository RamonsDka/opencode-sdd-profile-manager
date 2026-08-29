# Suite de Agentes — Project Boundary

## Scope

This repository is exclusively the Suite de Agentes product (`opencode-agent-suite`). Keep product source, tests, documentation, OpenSpec product artifacts, and repository history together in this standalone Git project.

## Out of scope

- External Gentle-AI / Observer Router work is outside this repository.
- Superpowers adoption, repair, and activation work is outside this repository.
- Do not copy or reference external `gentle-ai-plus-observer-router` material here.
- `openspec/changes/*` is reserved for Suite de Agentes product changes; do not create or modify SDD phase/state artifacts for unrelated work.

## Canonical boundary

- The canonical source for Suite de Agentes is now vendored directly at `plugins/suite-de-agentes` within the `opencode-sdd-profile-manager` repository.
- All product source, tests, skills, documentation, and OpenSpec artifacts are maintained here as the single source of truth.
- Standard build and packaging pipelines copy assets directly from `plugins/suite-de-agentes` to `dist/plugins/suite-de-agentes`. External import synchronization is obsolete.

## Documentation

Technical artifacts are written in English unless an explicit project requirement says otherwise.
