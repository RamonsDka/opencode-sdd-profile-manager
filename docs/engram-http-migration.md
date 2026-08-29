# Migration to Engram HTTP API

## Context & Motivation

Historically, early iterations of the plugin interacted directly with Engram's underlying SQLite database (`~/.engram/engram.db`) by spawning child processes running the `sqlite3` command-line binary. This legacy approach introduced several architectural challenges:

1. **External CLI Dependency**: Required `sqlite3` to be installed and available in the system `PATH`, causing failures on non-standard Windows and minimal container environments.
2. **Architectural Inconsistency**: Bypassed the official Engram HTTP service layer used by the rest of the OpenCode ecosystem.
3. **Process Spawning Overhead**: Spawning subprocesses for every query created unnecessary I/O overhead and lacked connection pooling.

---

## Architectural Changes

### 1. Loopback HTTP Communication
The plugin communicates with Engram exclusively via standard `fetch` HTTP requests. By default, it connects to loopback `http://127.0.0.1:7437`, while respecting the `ENGRAM_PORT` environment variable when custom port binding is configured.

### 2. Consumed API Endpoints

- **Observation Retrieval**: `GET /observations/recent?project={name}&limit=50`
  - Queries potential project identifiers (Git remote name, root directory name, aliases) in parallel.
  - Aggregates, deduplicates by observation ID, and sorts results chronologically (most recent first).
- **Observation Soft-Delete**: `DELETE /observations/{id}`
  - Performs a soft delete through the Engram server API.

### 3. Asynchronous Workflow & Error Handling
All memory access logic in `src/memories.ts` is asynchronous (`async/await`). The OpenTUI dialogs in `src/dialogs.tsx` handle connection timeouts gracefully and display non-blocking error toasts if the local Engram service is unreachable.

### 4. Unit & Mock Testing
Test suite `src/memories.test.ts` uses global `fetch` mocking instead of child process mocks, ensuring robust coverage of network failure states, malformed response handling, and project ID deduplication.

---

## Runtime Requirements

Engram memory browsing is an optional, non-blocking feature. If Engram is running locally, project observations appear automatically in **Project memories**. If Engram is not running, profile management, model assignments, and reasoning effort configuration continue operating without interruption.
