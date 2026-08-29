import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  migrateLegacyTaskManagerHtml,
  provisionTaskManagerBase,
  setTaskManagerErrorState,
  setTaskManagerProlongedState,
  setTaskManagerRunningState,
  setTaskManagerSyncedState,
  validateTaskManagerAgentOutput,
} from "./task-manager-lifecycle";
import { currentTaskManagerMeta } from "./task-manager-classifier";

const temporaryRoots: string[] = [];
afterEach(() => temporaryRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe("Task Manager lifecycle filesystem harness", () => {
  it("provisions a managed base once and opens it before foreground enrichment", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-manager-lifecycle-"));
    temporaryRoots.push(root);
    const template = path.join(root, "template.html");
    fs.writeFileSync(template, '<div data-tm-capability="token-insights-v2"></div><script id="tm-state">{"schemaVersion":"1.0"}</script>');

    const first = provisionTaskManagerBase(root, template, "foreground");
    const second = provisionTaskManagerBase(root, template, "foreground");

    expect(first).toEqual({ created: true, migrated: false, path: path.join(root, "Task-Manager-Portable.html"), route: "foreground" });
    expect(second).toEqual({ created: false, migrated: false, path: first.path, route: "foreground" });
    expect(fs.readFileSync(first.path, "utf8")).toContain('"signature":"opencode-task-manager"');
  });

  it("safely migrates legacy Task Manager with welcome-dialog while preserving full task and phase data", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-manager-lifecycle-"));
    temporaryRoots.push(root);
    const template = path.join(root, "template.html");
    fs.writeFileSync(template, '<!DOCTYPE html><html><body><header></header><div data-tm-capability="token-insights-v2"></div><script id="tm-state">{"schemaVersion":"1.0"}</script></body></html>');

    const target = path.join(root, "Task-Manager-Portable.html");
    const legacyIsland = {
      schemaVersion: "1.0",
      meta: { projectName: "Test Migration", customField: 123 },
      phases: [{ id: "p1", title: "Phase 1", tasks: [{ id: "T1", title: "Task 1", status: "completed", subtasks: [{ id: "ST1", title: "Sub 1", done: true }] }] }],
      todos: [{ id: "td-1", text: "Important Note", priority: "P0", done: true }],
      git: { branch: "feat/migration" },
    };
    const legacyHtml = `<!DOCTYPE html><html><body><div id="welcome-dialog">Welcome</div><script id="tm-state">${JSON.stringify(legacyIsland)}</script></body></html>`;
    fs.writeFileSync(target, legacyHtml, "utf8");

    const result = provisionTaskManagerBase(root, template, "foreground");

    expect(result).toEqual({ created: false, migrated: true, path: target, route: "foreground" });
    const content = fs.readFileSync(target, "utf8");
    expect(content).not.toContain("welcome-dialog");
    expect(content).toContain('"signature":"opencode-task-manager"');
    expect(content).toContain('\"templateVersion\":\"1.4.0\"');
    expect(content).toContain('"Test Migration"');
    expect(content).toContain('"Phase 1"');
    expect(content).toContain('"Task 1"');
    expect(content).toContain('"Important Note"');
    expect(content).toContain('"feat/migration"');
  });

  it("migrates prior-current 1.1.0, 1.2.0, and 1.3.0 shells missing capability marker to 1.3.1 and preserves tokenUsage and custom state", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-manager-lifecycle-"));
    temporaryRoots.push(root);
    const template = path.join(root, "template.html");
    fs.writeFileSync(template, '<!DOCTYPE html><html><body><header></header><div class="metric-card metric-insights-band" data-tm-capability="token-insights-v2"></div><script id="tm-state">{"schemaVersion":"1.0"}</script></body></html>');

    const target = path.join(root, "Task-Manager-Portable.html");
    const old110Island = {
      signature: "opencode-task-manager",
      pluginVersion: "1.7.0",
      templateVersion: "1.1.0",
      schemaVersion: "1.0",
      stateVersion: 1,
      meta: { projectName: "Prior 1.1.0 Project", customField: 456, syncStatus: "synced" },
      phases: [{ id: "phase-1", number: 1, title: "Core Phase", status: "completed", tasks: [{ id: "T1", title: "Task 1", status: "completed" }] }],
      todos: [{ id: "td-1", text: "Todo 1", priority: "P0", done: true }],
      tokenUsage: {
        schemaVersion: "1.0",
        totals: { total: 50000, input: 20000, output: 10000, reasoning: 5000, cacheRead: 15000, cacheWrite: 0 },
        byAgent: [{ agent: "sdd-apply", total: 50000 }]
      },
      codegraph: { nodes: [{ id: "n1", label: "Node 1" }], edges: [] }
    };
    // Old 5-column shell without data-tm-capability marker
    const old110Html = `<!DOCTYPE html><html><head><style>.insight-band-grid { grid-template-columns: minmax(150px, 1.15fr) minmax(126px, 0.85fr) minmax(150px, 1fr) minmax(150px, 1fr) minmax(190px, 1.2fr); }</style></head><body><div class="old-5-col-insights"></div><script id="tm-state">${JSON.stringify(old110Island)}</script></body></html>`;
    fs.writeFileSync(target, old110Html, "utf8");

    const result = provisionTaskManagerBase(root, template, "foreground");

    expect(result).toEqual({ created: false, migrated: true, path: target, route: "foreground" });
    const content = fs.readFileSync(target, "utf8");
    expect(content).toContain('data-tm-capability="token-insights-v2"');
    expect(content).not.toContain('minmax(126px, 0.85fr)');
    const state = JSON.parse(content.match(/<script\b[^>]*\bid=[\"']tm-state[\"'][^>]*>([\s\S]*?)<\/script>/i)![1]);
    expect(state.templateVersion).toBe("1.4.0");
    expect(state.meta.templateVersion).toBe("1.4.0");
    expect(state.meta.projectName).toBe("Prior 1.1.0 Project");
    expect(state.meta.customField).toBe(456);
    expect(state.tokenUsage.totals.total).toBe(50000);
    expect(state.tokenUsage.byAgent[0].agent).toBe("sdd-apply");
    expect(state.codegraph.nodes[0].id).toBe("n1");
    expect(state.phases[0].tasks[0].id).toBe("T1");
  });

  it("refuses to migrate arbitrary unrelated HTML", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-manager-lifecycle-"));
    temporaryRoots.push(root);
    const template = path.join(root, "template.html");
    fs.writeFileSync(template, '<script id="tm-state">{"schemaVersion":"1.0"}</script>');

    const target = path.join(root, "Task-Manager-Portable.html");
    const unrelatedHtml = "<html><body><h1>Random Website</h1><p>Not a task manager</p></body></html>";
    fs.writeFileSync(target, unrelatedHtml, "utf8");

    const result = provisionTaskManagerBase(root, template, "foreground");
    expect(result).toEqual({ created: false, migrated: false, path: target, route: "foreground" });
    expect(fs.readFileSync(target, "utf8")).toBe(unrelatedHtml);
  });

  it("manages running, synced, and error state transitions atomically in the state island", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-manager-lifecycle-"));
    temporaryRoots.push(root);
    const target = path.join(root, "Task-Manager-Portable.html");
    const initialIsland = {
      ...currentTaskManagerMeta(),
      meta: { syncStatus: "idle" },
      phases: [],
    };
    fs.writeFileSync(target, `<script id="tm-state">${JSON.stringify(initialIsland)}</script>`, "utf8");

    // Transition to running
    const runningOk = setTaskManagerRunningState(target, "opening");
    expect(runningOk).toBe(true);
    let state = JSON.parse(fs.readFileSync(target, "utf8").match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i)![1]);
    expect(state.meta.syncStatus).toBe("running");
    expect(state.meta.lastSyncSource).toBe("opening");
    expect(state.meta.lastSyncStartAt).toBeDefined();
    expect(state.meta.lastError).toBeUndefined();

    // Transition to prolonged
    const prolongedOk = setTaskManagerProlongedState(target, "agent-task-manager");
    expect(prolongedOk).toBe(true);
    state = JSON.parse(fs.readFileSync(target, "utf8").match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i)![1]);
    expect(state.meta.syncStatus).toBe("prolonged");
    expect(state.meta.lastSyncSource).toBe("agent-task-manager");
    expect(state.meta.lastError).toBeUndefined();

    // Transition to synced
    const timestamp = "2026-08-29T10:00:00.000Z";
    const syncedOk = setTaskManagerSyncedState(target, "agent-task-manager", timestamp);
    expect(syncedOk).toBe(true);
    state = JSON.parse(fs.readFileSync(target, "utf8").match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i)![1]);
    expect(state.meta.syncStatus).toBe("synced");
    expect(state.meta.lastSyncAt).toBe(timestamp);
    expect(state.meta.lastSyncSource).toBe("agent-task-manager");
    expect(state.meta.lastError).toBeUndefined();

    // Transition to error
    const errorOk = setTaskManagerErrorState(target, "Connection timed out", "agent-task-manager");
    expect(errorOk).toBe(true);
    state = JSON.parse(fs.readFileSync(target, "utf8").match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i)![1]);
    expect(state.meta.syncStatus).toBe("error");
    expect(state.meta.lastError).toBe("Connection timed out");
  });

  it("accepts bounded state-only agent output and rejects prohibited output fields", () => {
    expect(validateTaskManagerAgentOutput({ state: { tasks: [{ id: "T1", status: "completed" }] }, summary: "Sincronizado", provenance: { agent: "Agent-Task-Manager", requestId: "r1" } })).toEqual({ valid: true });
    expect(validateTaskManagerAgentOutput({ state: {}, summary: "x", provenance: { agent: "Agent-Task-Manager", requestId: "r2" }, shell: "git add ." })).toEqual({ valid: false, message: "La respuesta del agente excede el contrato de estado." });
  });
});
