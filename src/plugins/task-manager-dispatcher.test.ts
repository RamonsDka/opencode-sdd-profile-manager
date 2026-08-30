import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskManagerInitPrompt,
  buildTaskManagerRefreshPrompt,
  createTaskManagerStore,
  defaultTaskManagerAgentRunner,
  setTaskManagerDispatcherForTests,
  TaskManagerDispatcher,
  verifyDashboardUpdated,
} from "./task-manager-dispatcher";
import type { TaskManagerProjectIdentity } from "./task-manager-root";

const project: TaskManagerProjectIdentity = {
  root: "C:/work/app",
  canonicalRoot: "C:/work/app",
  key: "c:/work/app",
  confirmed: true,
};

describe("TaskManagerDispatcher & Store", () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-store-test-"));
    storePath = path.join(tempDir, "state.json");
    setTaskManagerDispatcherForTests(null);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    setTaskManagerDispatcherForTests(null);
  });

  it("builds evidence-based initialization prompt for first run", () => {
    const prompt = buildTaskManagerInitPrompt(project, "C:/work/app/Task-Manager-Portable.html");
    expect(prompt).toContain("Agent Task Manager");
    expect(prompt).toContain("direct execution authority");
    expect(prompt).toContain("C:/work/app");
    expect(prompt).toContain("Task-Manager-Portable.html");
    expect(prompt).toContain("schemaVersion: \"1.0\"");
    expect(prompt).toContain("\\u003c/script\\u003e");
    expect(prompt).toContain("STRICT SAFETY RULES");
    expect(prompt).toContain("Never delegate tasks to subagents or workers");
    expect(prompt).toContain('set meta.syncStatus to "synced"');
    expect(prompt).toContain("meta.lastSyncCompletedAt");
    expect(prompt.toLowerCase()).not.toContain("autónomo + subagente");
    expect(prompt.toLowerCase()).not.toContain("delegación y subagente");
  });

  it("builds concise refresh prompt preserving user modifications without delegation", () => {
    const prompt = buildTaskManagerRefreshPrompt(project, "C:/work/app/Task-Manager-Portable.html", "sdd-tasks");
    expect(prompt).toContain("incremental refresh");
    expect(prompt).toContain("Milestone reached: sdd-tasks");
    expect(prompt).toContain("PRESERVE all existing task IDs, custom user notes");
    expect(prompt).toContain("C:/work/app");
    expect(prompt).toContain("Never delegate tasks to subagents or workers");
    expect(prompt).toContain('set meta.syncStatus to "synced"');
    expect(prompt).toContain("meta.lastSyncCompletedAt");
    expect(prompt.toLowerCase()).not.toContain("autónomo + subagente");
    expect(prompt.toLowerCase()).not.toContain("delegación y subagente");
  });

  it("persists project state per canonical project key", () => {
    const store = createTaskManagerStore(storePath);
    expect(store.isInitialized(project.key)).toBe(false);

    store.markInitialized(project.key);
    expect(store.isInitialized(project.key)).toBe(true);

    const reloadedStore = createTaskManagerStore(storePath);
    expect(reloadedStore.isInitialized(project.key)).toBe(true);
    expect(reloadedStore.getProject(project.key).syncStatus).toBe("idle");
  });

  it("migrates and resets legacy entries where initialized: true was paired with syncStatus: error", () => {
    const rawLegacyData = {
      "c:/legacy/failed": {
        initialized: true,
        syncStatus: "error" as const,
        lastError: "OpenCode client/session API is unavailable; skipping dispatch until client is connected",
      },
      "c:/legacy/valid": {
        initialized: true,
        syncStatus: "idle" as const,
        lastSyncAt: "2026-08-29T10:00:00.000Z",
      },
    };
    fs.writeFileSync(storePath, JSON.stringify(rawLegacyData, null, 2), "utf8");

    const store = createTaskManagerStore(storePath);
    expect(store.isInitialized("c:/legacy/failed")).toBe(false);
    expect(store.getProject("c:/legacy/failed").initialized).toBe(false);
    expect(store.isInitialized("c:/legacy/valid")).toBe(true);
  });

  it("dispatches init prompt on first opening and marks initialized on success", async () => {
    const store = createTaskManagerStore(storePath);
    const runnerMock = vi.fn().mockResolvedValue({ success: true });
    const dispatcher = new TaskManagerDispatcher({ store, runner: runnerMock, debounceMs: 0 });

    const result = await dispatcher.dispatch({
      project,
      dashboardPath: "C:/work/app/Task-Manager-Portable.html",
      reason: "opening",
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe("init");
    expect(runnerMock).toHaveBeenCalledTimes(1);
    expect(runnerMock.mock.calls[0][0].mode).toBe("init");
    expect(runnerMock.mock.calls[0][0].prompt).toContain("Perform evidence-based initialization");
    expect(store.isInitialized(project.key)).toBe(true);
  });

  it("dispatches refresh prompt on later openings once initialized", async () => {
    const store = createTaskManagerStore(storePath);
    store.markInitialized(project.key);
    const runnerMock = vi.fn().mockResolvedValue({ success: true });
    const dispatcher = new TaskManagerDispatcher({ store, runner: runnerMock, debounceMs: 0 });

    const result = await dispatcher.dispatch({
      project,
      dashboardPath: "C:/work/app/Task-Manager-Portable.html",
      reason: "opening",
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe("refresh");
    expect(runnerMock).toHaveBeenCalledTimes(1);
    expect(runnerMock.mock.calls[0][0].mode).toBe("refresh");
    expect(runnerMock.mock.calls[0][0].prompt).toContain("incremental refresh");
  });

  it("does not mark initialized if runner fails, allowing safe retry on next opening", async () => {
    const store = createTaskManagerStore(storePath);
    const runnerMock = vi.fn().mockResolvedValue({ success: false, error: "Network timeout" });
    const dispatcher = new TaskManagerDispatcher({ store, runner: runnerMock, debounceMs: 0 });

    const result = await dispatcher.dispatch({
      project,
      dashboardPath: "C:/work/app/Task-Manager-Portable.html",
      reason: "opening",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network timeout");
    expect(store.isInitialized(project.key)).toBe(false);
    expect(store.getProject(project.key).lastError).toBe("Network timeout");

    // Next opening retries with init mode
    runnerMock.mockResolvedValue({ success: true });
    const retryResult = await dispatcher.dispatch({
      project,
      dashboardPath: "C:/work/app/Task-Manager-Portable.html",
      reason: "opening",
    });
    expect(retryResult.success).toBe(true);
    expect(retryResult.mode).toBe("init");
    expect(store.isInitialized(project.key)).toBe(true);
  });

  it("ignores self-activity to prevent recursion loops", async () => {
    const store = createTaskManagerStore(storePath);
    const runnerMock = vi.fn().mockResolvedValue({ success: true });
    const dispatcher = new TaskManagerDispatcher({ store, runner: runnerMock, debounceMs: 0 });

    const result = await dispatcher.dispatch({
      project,
      dashboardPath: "C:/work/app/Task-Manager-Portable.html",
      reason: "milestone",
      milestone: "sdd-tasks",
      sourceAgent: "agent-task-manager",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("self-recursion");
    expect(runnerMock).not.toHaveBeenCalled();
  });

  it("filters non-milestone events when reason is milestone", async () => {
    const store = createTaskManagerStore(storePath);
    const runnerMock = vi.fn().mockResolvedValue({ success: true });
    const dispatcher = new TaskManagerDispatcher({ store, runner: runnerMock, debounceMs: 0 });

    const result = await dispatcher.dispatch({
      project,
      dashboardPath: "C:/work/app/Task-Manager-Portable.html",
      reason: "milestone",
      milestone: "random-unapproved-event",
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("ignored");
    expect(runnerMock).not.toHaveBeenCalled();
  });

  it("debounces rapid milestone triggers within debounce window", async () => {
    const store = createTaskManagerStore(storePath);
    const runnerMock = vi.fn().mockResolvedValue({ success: true });
    const dispatcher = new TaskManagerDispatcher({ store, runner: runnerMock, debounceMs: 5000 });

    const first = await dispatcher.dispatch({
      project,
      dashboardPath: "C:/work/app/Task-Manager-Portable.html",
      reason: "milestone",
      milestone: "sdd-tasks",
    });
    expect(first.success).toBe(true);

    const second = await dispatcher.dispatch({
      project,
      dashboardPath: "C:/work/app/Task-Manager-Portable.html",
      reason: "milestone",
      milestone: "sdd-verify",
    });
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe("debounced");
    expect(runnerMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent requests to one active job and enqueues latest pending", async () => {
    const store = createTaskManagerStore(storePath);
    const calls: string[] = [];
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });

    const runnerMock = vi.fn().mockImplementation(async ({ milestone }) => {
      calls.push(milestone || "init");
      if (calls.length === 1) await gate;
      return { success: true };
    });

    const dispatcher = new TaskManagerDispatcher({ store, runner: runnerMock, debounceMs: 0 });

    const job1 = dispatcher.dispatch({ project, dashboardPath: "C:/work/app/Task-Manager-Portable.html", reason: "milestone", milestone: "sdd-tasks" });
    const job2 = dispatcher.dispatch({ project, dashboardPath: "C:/work/app/Task-Manager-Portable.html", reason: "milestone", milestone: "sdd-verify" });
    const job3 = dispatcher.dispatch({ project, dashboardPath: "C:/work/app/Task-Manager-Portable.html", reason: "milestone", milestone: "sdd-archive" });

    releaseGate();
    await Promise.all([job1, job2, job3]);

    // First ran, and last pending ("sdd-archive") ran
    expect(calls).toEqual(["sdd-tasks", "sdd-archive"]);
  });

  it("defaultTaskManagerAgentRunner uses flat SDK v2 contract and verifies write", async () => {
    const promptMock = vi.fn().mockResolvedValue({});
    const createMock = vi.fn().mockResolvedValue({ data: { id: "sess-123" } });
    const mockClient = {
      session: {
        create: createMock,
        prompt: promptMock,
      },
    };
    const verifyMock = vi.fn().mockResolvedValue(true);

    const res = await defaultTaskManagerAgentRunner({
      project,
      prompt: "test prompt",
      mode: "init",
      dashboardPath: "C:/work/app/Task-Manager-Portable.html",
      client: mockClient,
      verifyDashboard: verifyMock,
    });

    expect(res.success).toBe(true);
    expect(createMock).toHaveBeenCalledWith({ title: `[Task Manager] ${project.root}` });
    expect(promptMock).toHaveBeenCalledWith({
      sessionID: "sess-123",
      agent: "agent-task-manager",
      directory: project.canonicalRoot,
      parts: [{ type: "text", text: "test prompt" }],
    });
    expect(verifyMock).toHaveBeenCalledTimes(1);
  });

  it("defaultTaskManagerAgentRunner uses promptAsync with flat SDK v2 contract and verifies write", async () => {
    const promptAsyncMock = vi.fn().mockResolvedValue({});
    const createMock = vi.fn().mockResolvedValue({ data: { id: "sess-async-456" } });
    const mockClient = {
      session: {
        create: createMock,
        promptAsync: promptAsyncMock,
      },
    };
    const verifyMock = vi.fn().mockResolvedValue(true);

    const res = await defaultTaskManagerAgentRunner({
      project,
      prompt: "async test prompt",
      mode: "refresh",
      dashboardPath: "C:/work/app/Task-Manager-Portable.html",
      client: mockClient,
      verifyDashboard: verifyMock,
    });

    expect(res.success).toBe(true);
    expect(promptAsyncMock).toHaveBeenCalledWith({
      sessionID: "sess-async-456",
      agent: "agent-task-manager",
      directory: project.canonicalRoot,
      parts: [{ type: "text", text: "async test prompt" }],
    });
    expect(verifyMock).toHaveBeenCalledTimes(1);
  });

  it("defaultTaskManagerAgentRunner returns prolonged status when prompt succeeds but verification times out", async () => {
    const promptAsyncMock = vi.fn().mockResolvedValue({});
    const createMock = vi.fn().mockResolvedValue({ id: "sess-prolonged" });
    const mockClient = {
      session: {
        create: createMock,
        promptAsync: promptAsyncMock,
      },
    };
    const verifyMock = vi.fn().mockResolvedValue(false);

    const res = await defaultTaskManagerAgentRunner({
      project,
      prompt: "test prompt",
      mode: "init",
      dashboardPath: "C:/work/app/Task-Manager-Portable.html",
      client: mockClient,
      verifyDashboard: verifyMock,
    });

    expect(res.success).toBe(true);
    expect(res.prolonged).toBe(true);
  });

  it("dispatcher transitions to prolonged state when agent takes longer, without marking initialized", async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-dispatch-prolonged-"));
    const dashboardFile = path.join(testDir, "Task-Manager-Portable.html");
    const initialHtml = `<script id="tm-state">{"schemaVersion":"1.0","meta":{"syncStatus":"idle"},"phases":[]}</script>`;
    fs.writeFileSync(dashboardFile, initialHtml, "utf8");

    const store = createTaskManagerStore(storePath);
    const runnerMock = vi.fn().mockResolvedValue({ success: true, prolonged: true });
    const dispatcher = new TaskManagerDispatcher({ store, runner: runnerMock, debounceMs: 0 });

    const result = await dispatcher.dispatch({
      project,
      dashboardPath: dashboardFile,
      reason: "opening",
    });

    expect(result.success).toBe(true);
    expect(result.prolonged).toBe(true);
    expect(result.mode).toBe("init");
    expect(store.isInitialized(project.key)).toBe(false);
    expect(store.getProject(project.key).syncStatus).toBe("prolonged");

    const onDiskContent = fs.readFileSync(dashboardFile, "utf8");
    const state = JSON.parse(onDiskContent.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i)![1]);
    expect(state.meta.syncStatus).toBe("prolonged");
    expect(state.meta.lastError).toBeUndefined();

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("prolonged monitor marks initialized and synced upon observing subsequent island update", async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-monitor-sync-"));
    const dashboardFile = path.join(testDir, "Task-Manager-Portable.html");
    const initialHtml = `<script id="tm-state">{"schemaVersion":"1.0","meta":{"syncStatus":"idle"},"phases":[]}</script>`;
    fs.writeFileSync(dashboardFile, initialHtml, "utf8");

    const store = createTaskManagerStore(storePath);
    let polls = 0;
    const runnerMock = vi.fn().mockResolvedValue({ success: true, prolonged: true });
    const dispatcher = new TaskManagerDispatcher({ store, runner: runnerMock, debounceMs: 0 });

    const result = await dispatcher.dispatch({
      project,
      dashboardPath: dashboardFile,
      reason: "opening",
      monitorOptions: {
        maxPolls: 3,
        pollIntervalMs: 1,
        sleep: async () => {
          polls++;
          if (polls === 2) {
            // Simulate background agent writing updated island
            const updatedHtml = `<script id="tm-state">{"schemaVersion":"1.0","meta":{"syncStatus":"synced"},"phases":[{"id":"P1","title":"Phase 1","status":"completed","tasks":[]}]}</script>`;
            fs.writeFileSync(dashboardFile, updatedHtml, "utf8");
          }
        },
      },
    });

    expect(result.prolonged).toBe(true);

    // Wait for the detached monitor to complete
    const monitor = dispatcher.getActiveMonitor(project.key);
    if (monitor) {
      const outcome = await monitor.wait();
      expect(outcome).toBe("synced");
    }

    expect(store.isInitialized(project.key)).toBe(true);

    const onDiskContent = fs.readFileSync(dashboardFile, "utf8");
    const state = JSON.parse(onDiskContent.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i)![1]);
    expect(state.meta.syncStatus).toBe("synced");
    expect(state.meta.lastSyncCompletedAt).toBeDefined();

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("prolonged monitor remains in prolonged status without error if no update occurs", async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-monitor-timeout-"));
    const dashboardFile = path.join(testDir, "Task-Manager-Portable.html");
    const initialHtml = `<script id="tm-state">{"schemaVersion":"1.0","meta":{"syncStatus":"idle"},"phases":[]}</script>`;
    fs.writeFileSync(dashboardFile, initialHtml, "utf8");

    const store = createTaskManagerStore(storePath);
    const runnerMock = vi.fn().mockResolvedValue({ success: true, prolonged: true });
    const dispatcher = new TaskManagerDispatcher({ store, runner: runnerMock, debounceMs: 0 });

    await dispatcher.dispatch({
      project,
      dashboardPath: dashboardFile,
      reason: "opening",
      monitorOptions: {
        maxPolls: 3,
        pollIntervalMs: 1,
        sleep: async () => {},
      },
    });

    const monitor = dispatcher.getActiveMonitor(project.key);
    if (monitor) {
      const outcome = await monitor.wait();
      expect(outcome).toBe("prolonged");
    }

    expect(store.isInitialized(project.key)).toBe(false);
    expect(store.getProject(project.key).syncStatus).toBe("prolonged");
    expect(store.getProject(project.key).lastError).toBeUndefined();

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("verifyDashboardUpdated performs bounded polling checks without infinite loops", async () => {
    let checkCount = 0;
    const readFingerprint = vi.fn().mockImplementation(() => {
      checkCount++;
      return checkCount >= 2 ? "new-fingerprint" : "initial-fingerprint";
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const updated = await verifyDashboardUpdated("test.html", "initial-fingerprint", {
      maxAttempts: 3,
      pollIntervalMs: 10,
      readFingerprint,
      sleep,
    });

    expect(updated).toBe(true);
    expect(checkCount).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("defaultTaskManagerAgentRunner fails safely without client instead of falsely claiming initialization", async () => {
    const res = await defaultTaskManagerAgentRunner({
      project,
      prompt: "test prompt",
      mode: "init",
      dashboardPath: "C:/work/app/Task-Manager-Portable.html",
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("OpenCode client/session API is unavailable");
  });

  it("client-free dispatch does not mark project initialized in the store", async () => {
    const store = createTaskManagerStore(storePath);
    const dispatcher = new TaskManagerDispatcher({ store, debounceMs: 0 });

    const result = await dispatcher.dispatch({
      project,
      dashboardPath: "C:/work/app/Task-Manager-Portable.html",
      reason: "opening",
    });

    expect(result.success).toBe(false);
    expect(store.isInitialized(project.key)).toBe(false);
  });

  it("updates state island on disk with running, synced, and error statuses during dispatch lifecycle", async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-dispatch-island-"));
    const dashboardFile = path.join(testDir, "Task-Manager-Portable.html");
    const initialHtml = `<script id="tm-state">{"schemaVersion":"1.0","meta":{"syncStatus":"idle"},"phases":[]}</script>`;
    fs.writeFileSync(dashboardFile, initialHtml, "utf8");

    const store = createTaskManagerStore(storePath);
    let capturedRunningStatus = "";
    const runnerMock = vi.fn().mockImplementation(async () => {
      const current = fs.readFileSync(dashboardFile, "utf8");
      const match = current.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
      capturedRunningStatus = JSON.parse(match![1]).meta.syncStatus;
      return { success: true };
    });

    const dispatcher = new TaskManagerDispatcher({ store, runner: runnerMock, debounceMs: 0 });
    const res = await dispatcher.dispatch({
      project,
      dashboardPath: dashboardFile,
      reason: "opening",
    });

    expect(res.success).toBe(true);
    expect(capturedRunningStatus).toBe("running");

    // After success, state is synced
    const finalContent = fs.readFileSync(dashboardFile, "utf8");
    const state = JSON.parse(finalContent.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i)![1]);
    expect(state.meta.syncStatus).toBe("synced");
    expect(state.meta.lastSyncAt).toBeDefined();

    // Now test failure writes error state to island
    runnerMock.mockResolvedValueOnce({ success: false, error: "Mock failure reason" });
    const failRes = await dispatcher.dispatch({
      project,
      dashboardPath: dashboardFile,
      reason: "manual",
    });
    expect(failRes.success).toBe(false);
    const failContent = fs.readFileSync(dashboardFile, "utf8");
    const failState = JSON.parse(failContent.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i)![1]);
    expect(failState.meta.syncStatus).toBe("error");
    expect(failState.meta.lastError).toBe("Mock failure reason");

    fs.rmSync(testDir, { recursive: true, force: true });
  });
});
