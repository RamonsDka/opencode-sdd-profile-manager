import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  collectTaskManagerTokenTelemetry,
  estimateTokensFromText,
  syncTaskManagerTokenTelemetry,
  type TaskManagerTokenUsage,
} from "./task-manager-telemetry";
import type { TaskManagerProjectIdentity } from "./task-manager-root";
import { mergeTaskManagerState } from "./task-manager-writer";

const project: TaskManagerProjectIdentity = {
  root: "C:/projects/my-app",
  canonicalRoot: "C:/projects/my-app",
  key: "c:/projects/my-app",
  confirmed: true,
};

describe("TaskManagerTokenTelemetry", () => {
  it("computes deterministic token estimates from text length (chars / 4)", () => {
    const text = "Hello world! This is a test message of 50 chars...";
    const estimated = estimateTokensFromText(text);
    expect(estimated).toBe(Math.ceil(text.length / 4));
    expect(estimateTokensFromText("")).toBe(0);
    expect(estimateTokensFromText(null as unknown as string)).toBe(0);
  });

  it("aggregates exact measured token telemetry across parent and child sessions with SDK v2 signatures", async () => {
    const mockSessions = [
      {
        id: "sess-root",
        directory: "C:/projects/my-app",
        title: "Root Session",
      },
      {
        id: "sess-child-1",
        directory: "C:/projects/my-app",
        parentID: "sess-root",
        title: "SDD Apply Task",
      },
      {
        id: "sess-unrelated",
        directory: "C:/other/unrelated-project",
        title: "Other Project",
      },
    ];

    const mockMessagesBySession: Record<string, any[]> = {
      "sess-root": [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Please implement the feature" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          agent: "orchestrator",
          model: "claude-3-7-sonnet",
          tokens: {
            input: 1000,
            output: 250,
            reasoning: 100,
            cacheRead: 2000,
            cacheWrite: 50,
            total: 3400,
          },
          cost: 0.015,
        },
      ],
      "sess-child-1": [
        {
          id: "msg-3",
          info: {
            role: "assistant",
            agent: "sdd-apply",
            model: { providerID: "anthropic", modelID: "claude-3-7-sonnet" },
            tokens: {
              input: 3000,
              output: 800,
              reasoning: 400,
              cacheRead: 5000,
              cacheWrite: 100,
              total: 9300,
            },
            cost: 0.045,
          },
        },
      ],
      "sess-unrelated": [
        {
          id: "msg-4",
          role: "assistant",
          agent: "sdd-apply",
          tokens: { input: 99999, output: 99999, total: 199998 },
        },
      ],
    };

    const mockClient = {
      session: {
        list: vi.fn().mockResolvedValue({ data: mockSessions }),
        messages: vi.fn().mockImplementation(async (req: { path?: { id: string }; sessionID?: string }) => {
          const id = req.path?.id || req.sessionID;
          return { data: mockMessagesBySession[id || ""] || [] };
        }),
      },
    };

    const telemetry = await collectTaskManagerTokenTelemetry({
      client: mockClient,
      project,
    });

    expect(telemetry).not.toBeNull();
    expect(telemetry!.schemaVersion).toBe("1.0");
    expect(telemetry!.source).toBe("opencode-sdk");
    expect(telemetry!.scope).toBe(project.canonicalRoot);
    expect(telemetry!.root).toBe(project.canonicalRoot);

    // Unrelated project session should be excluded
    expect(telemetry!.totals.input).toBe(4000);
    expect(telemetry!.totals.output).toBe(1050);
    expect(telemetry!.totals.reasoning).toBe(500);
    expect(telemetry!.totals.cacheRead).toBe(7000);
    expect(telemetry!.totals.cacheWrite).toBe(150);
    expect(telemetry!.totals.total).toBe(12700);
    expect(telemetry!.totals.cost).toBeCloseTo(0.060, 4);

    expect(telemetry!.byAgent).toHaveLength(2);

    const sddApply = telemetry!.byAgent.find((a) => a.agent === "sdd-apply");
    expect(sddApply).toBeDefined();
    expect(sddApply!.total).toBe(9300);
    expect(sddApply!.categories.input).toBe(3000);
    expect(sddApply!.categories.output).toBe(800);
    expect(sddApply!.categories.reasoning).toBe(400);
    expect(sddApply!.categories.cacheRead).toBe(5000);
    expect(sddApply!.categories.cacheWrite).toBe(100);
    expect(sddApply!.model).toBe("claude-3-7-sonnet");
    expect(sddApply!.models).toEqual(["claude-3-7-sonnet"]);
    expect(sddApply!.cost).toBe(0.045);
    expect(sddApply!.evidence).toBe("measured");
    expect(sddApply!.confidence).toBe(1.0);
    expect(sddApply!.sessions).toBe(1);
    expect(sddApply!.messages).toBe(1);

    const orchestrator = telemetry!.byAgent.find((a) => a.agent === "orchestrator");
    expect(orchestrator).toBeDefined();
    expect(orchestrator!.total).toBe(3400);
    expect(orchestrator!.evidence).toBe("measured");
    expect(orchestrator!.confidence).toBe(1.0);
  });

  it("handles deterministic estimated fallback when assistant tokens are missing from real transcript", async () => {
    const textOutput = "A".repeat(800); // 800 chars -> 200 estimated output tokens
    const mockSessions = [{ id: "sess-est", directory: project.canonicalRoot }];
    const mockMessages = [
      {
        id: "msg-est-1",
        role: "assistant",
        agent: "sdd-verify",
        parts: [{ type: "text", text: textOutput }],
      },
    ];

    const mockClient = {
      session: {
        list: vi.fn().mockResolvedValue(mockSessions), // direct array format
        messages: vi.fn().mockResolvedValue(mockMessages),
      },
    };

    const telemetry = await collectTaskManagerTokenTelemetry({
      client: mockClient,
      project,
    });

    expect(telemetry).not.toBeNull();
    const verifyAgent = telemetry!.byAgent.find((a) => a.agent === "sdd-verify");
    expect(verifyAgent).toBeDefined();
    expect(verifyAgent!.total).toBe(200);
    expect(verifyAgent!.categories.output).toBe(200);
    expect(verifyAgent!.evidence).toBe("estimated");
    expect(verifyAgent!.confidence).toBeLessThanOrEqual(0.4);
    expect(verifyAgent!.cost).toBeUndefined();
  });

  it("strictly enforces privacy: no prompt text or message parts in telemetry output", async () => {
    const secretPrompt = "SUPER_SECRET_TOKEN_API_KEY_12345";
    const secretAssistantResponse = "SECRET_DATABASE_PASSWORD_67890";
    const mockSessions = [{ id: "sess-secret", directory: project.canonicalRoot }];
    const mockMessages = [
      {
        id: "msg-sec-1",
        role: "user",
        parts: [{ type: "text", text: secretPrompt }],
      },
      {
        id: "msg-sec-2",
        role: "assistant",
        agent: "sdd-tasks",
        parts: [{ type: "text", text: secretAssistantResponse }],
        tokens: { input: 100, output: 50, total: 150 },
      },
    ];

    const mockClient = {
      session: {
        list: vi.fn().mockResolvedValue({ data: mockSessions }),
        messages: vi.fn().mockResolvedValue({ data: mockMessages }),
      },
    };

    const telemetry = await collectTaskManagerTokenTelemetry({
      client: mockClient,
      project,
    });

    const serialized = JSON.stringify(telemetry);
    expect(serialized).not.toContain(secretPrompt);
    expect(serialized).not.toContain(secretAssistantResponse);
    expect(serialized).not.toContain("SUPER_SECRET");
    expect(serialized).not.toContain("SECRET_DATABASE");
  });

  it("correctly extracts nested cache read/write tokens and attributes agent from UserMessage via parentID", async () => {
    const mockSessions = [
      {
        id: "sess-nested-cache",
        directory: project.canonicalRoot,
        agent: "fallback-session-agent",
      },
    ];

    const mockMessages = [
      {
        id: "msg-user-1",
        role: "user",
        agent: "agent-authoring",
        parts: [{ type: "text", text: "Create an agent" }],
      },
      {
        id: "msg-asst-1",
        role: "assistant",
        parentID: "msg-user-1",
        // agent is absent on assistant message; should be resolved via parentID msg-user-1 -> "agent-authoring"
        model: "claude-3-7-sonnet",
        tokens: {
          input: 1500,
          output: 400,
          reasoning: 200,
          cache: {
            read: 8500,
            write: 300,
          },
          total: 10900,
        },
        cost: 0.035,
      },
      {
        id: "msg-asst-orphan",
        role: "assistant",
        // parentID missing; should fall back to Session.agent -> "fallback-session-agent"
        model: "gpt-5",
        tokens: {
          input: 500,
          output: 100,
          reasoning: 50,
          cache: {
            read: 1000,
            write: 0,
          },
          total: 1650,
        },
      },
    ];

    const mockClient = {
      session: {
        list: vi.fn().mockImplementation(async (opts: any) => {
          // Verify SDK v2 query shape
          if (opts?.query?.directory === project.canonicalRoot || opts?.directory === project.canonicalRoot) {
            return { data: mockSessions };
          }
          return { data: [] };
        }),
        messages: vi.fn().mockResolvedValue({ data: mockMessages }),
      },
    };

    const telemetry = await collectTaskManagerTokenTelemetry({
      client: mockClient,
      project,
    });

    expect(telemetry).not.toBeNull();
    expect(telemetry!.totals.cacheRead).toBe(9500);
    expect(telemetry!.totals.cacheWrite).toBe(300);
    expect(telemetry!.totals.total).toBe(12550);

    const authoringAgent = telemetry!.byAgent.find((a) => a.agent === "agent-authoring");
    expect(authoringAgent).toBeDefined();
    expect(authoringAgent!.categories.cacheRead).toBe(8500);
    expect(authoringAgent!.categories.cacheWrite).toBe(300);
    expect(authoringAgent!.total).toBe(10900);
    expect(authoringAgent!.evidence).toBe("measured");

    const fallbackAgent = telemetry!.byAgent.find((a) => a.agent === "fallback-session-agent");
    expect(fallbackAgent).toBeDefined();
    expect(fallbackAgent!.categories.cacheRead).toBe(1000);
    expect(fallbackAgent!.total).toBe(1650);
  });

  it("falls back to local SQLite read-only database when OpenCode SDK is unavailable or returns 0 tokens", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-sqlite-test-"));
    const sqliteDbPath = path.join(tempDir, "opencode.db");

    // Create a real SQLite database using Node's DatabaseSync
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(sqliteDbPath);
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        directory TEXT,
        parent_id TEXT,
        agent TEXT,
        model TEXT,
        tokens_input INTEGER,
        tokens_output INTEGER,
        tokens_reasoning INTEGER,
        tokens_cache_read INTEGER,
        tokens_cache_write INTEGER,
        cost REAL
      );
    `);

    const insert = db.prepare(`
      INSERT INTO session (id, directory, parent_id, agent, model, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run("ses_1", project.canonicalRoot, null, "sdd-apply", '{"id":"claude-3-7-sonnet"}', 10000, 2000, 500, 30000, 100, 0.08);
    insert.run("ses_2", project.canonicalRoot, null, "sdd-verify", '{"id":"gemini-2.5-flash"}', 5000, 1000, 200, 15000, 50, 0.02);
    insert.run("ses_other", "C:/other/unrelated", null, "sdd-apply", '{"id":"claude-3-7-sonnet"}', 99999, 99999, 0, 0, 0, 1.0);
    db.close();

    // With client returning null, fallback to sqlite
    const telemetry = await collectTaskManagerTokenTelemetry({
      client: null,
      project,
      sqlitePath: sqliteDbPath,
    } as any);

    expect(telemetry).not.toBeNull();
    expect(telemetry!.source).toBe("opencode-sqlite-readonly");
    expect(telemetry!.totals.input).toBe(15000);
    expect(telemetry!.totals.output).toBe(3000);
    expect(telemetry!.totals.reasoning).toBe(700);
    expect(telemetry!.totals.cacheRead).toBe(45000);
    expect(telemetry!.totals.cacheWrite).toBe(150);
    expect(telemetry!.totals.total).toBe(63850);
    expect(telemetry!.totals.cost).toBeCloseTo(0.10, 3);

    expect(telemetry!.byAgent).toHaveLength(2);
    const apply = telemetry!.byAgent.find((a) => a.agent === "sdd-apply");
    expect(apply).toBeDefined();
    expect(apply!.evidence).toBe("derived");
    expect(apply!.confidence).toBe(0.95);
    expect(apply!.total).toBe(42600);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("provides Tier 3 activity fallback with deterministic units and explicit badge when no exact tokens exist", async () => {
    const { deriveActivityTelemetryFromState } = await import("./task-manager-telemetry");

    const stateWithTasks = {
      phases: [
        {
          id: "p1",
          title: "Phase 1",
          tasks: [
            { id: "T1", title: "Task 1", owner: "sdd-apply", status: "completed", subtasks: [{ id: "s1", done: true }, { id: "s2", done: true }] }, // 10 + 2*2 = 14
            { id: "T2", title: "Task 2", owner: "sdd-apply", status: "in-progress" }, // 5
            { id: "T3", title: "Task 3", owner: "sdd-verify", status: "completed" }, // 10
            { id: "T4", title: "Task 4", owner: "Orquestador", status: "pending" }, // 2
          ],
        },
      ],
    };

    const activityTelemetry = deriveActivityTelemetryFromState(stateWithTasks, project.canonicalRoot);

    expect(activityTelemetry).not.toBeNull();
    expect(activityTelemetry!.source).toBe("activity-estimation");
    expect(activityTelemetry!.totals.total).toBe(31); // 14 + 5 + 10 + 2
    expect(activityTelemetry!.totals.input).toBe(0); // Never fabricate fake input/output token counts!

    const applyAgent = activityTelemetry!.byAgent.find((a: any) => a.agent === "sdd-apply");
    expect(applyAgent).toBeDefined();
    expect(applyAgent!.total).toBe(19);
    expect(applyAgent!.evidence).toBe("estimated");
    expect(applyAgent!.confidence).toBeLessThanOrEqual(0.30);

    // Empty state returns null
    expect(deriveActivityTelemetryFromState({ phases: [] }, project.canonicalRoot)).toBeNull();
  });

  it("handles empty / client-free / unavailable telemetry gracefully without fake charts", async () => {
    const emptyTelemetry = await collectTaskManagerTokenTelemetry({
      client: null,
      project,
    });

    // In a completely empty environment without sqlite or client, returns null
    expect(emptyTelemetry === null || emptyTelemetry.totals.total === 0).toBe(true);

    const emptyClientMock = {
      session: {
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
    };

    const result = await collectTaskManagerTokenTelemetry({
      client: emptyClientMock,
      project,
    });

    expect(result).not.toBeNull();
    expect(result!.totals.total).toBe(0);
    expect(result!.byAgent).toEqual([]);
  });

  it("preserves previous tokenUsage on disk when collector fails or client is unavailable", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-telemetry-test-"));
    const htmlFile = path.join(tempDir, "Task-Manager-Portable.html");

    const existingTelemetry: TaskManagerTokenUsage = {
      schemaVersion: "1.0",
      updatedAt: "2026-08-28T12:00:00Z",
      source: "opencode-sdk",
      scope: project.canonicalRoot,
      root: project.canonicalRoot,
      totals: { input: 5000, output: 1000, reasoning: 0, cacheRead: 2000, cacheWrite: 0, total: 8000 },
      byAgent: [
        {
          agent: "sdd-apply",
          categories: { input: 5000, output: 1000, reasoning: 0, cacheRead: 2000, cacheWrite: 0, total: 8000 },
          total: 8000,
          evidence: "measured",
          confidence: 1.0,
        },
      ],
    };

    const initialHtml = `<script type="application/json" id="tm-state">${JSON.stringify({
      schemaVersion: "1.0",
      meta: { syncStatus: "synced" },
      tokenUsage: existingTelemetry,
      phases: [],
      todos: [],
    })}</script>`;

    fs.writeFileSync(htmlFile, initialHtml, "utf8");

    // Failing client
    const failingClient = {
      session: {
        list: vi.fn().mockRejectedValue(new Error("Connection refused")),
      },
    };

    const syncOk = await syncTaskManagerTokenTelemetry({
      client: failingClient,
      project,
      dashboardPath: htmlFile,
    });

    expect(syncOk).toBe(false);

    // Verify existing state on disk is preserved intact
    const contentOnDisk = fs.readFileSync(htmlFile, "utf8");
    const match = contentOnDisk.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
    expect(match).not.toBeNull();
    const parsedState = JSON.parse(match![1]);
    expect(parsedState.tokenUsage).toEqual(existingTelemetry);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("atomically merges tokenUsage into HTML state island without overwriting tasks or user edits", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-telemetry-write-"));
    const htmlFile = path.join(tempDir, "Task-Manager-Portable.html");

    const initialHtml = `<script type="application/json" id="tm-state">${JSON.stringify({
      schemaVersion: "1.0",
      meta: { syncStatus: "synced" },
      phases: [
        {
          id: "p1",
          number: 1,
          title: "Phase 1",
          status: "in-progress",
          tasks: [
            { id: "T1", title: "Task 1", status: "completed", note: "Custom operator note" },
          ],
        },
      ],
      todos: [],
    })}</script>`;

    fs.writeFileSync(htmlFile, initialHtml, "utf8");

    const mockClient = {
      session: {
        list: vi.fn().mockResolvedValue([
          { id: "s1", directory: project.canonicalRoot },
        ]),
        messages: vi.fn().mockResolvedValue([
          {
            id: "m1",
            role: "assistant",
            agent: "sdd-apply",
            tokens: { input: 1200, output: 300, total: 1500 },
          },
        ]),
      },
    };

    const syncOk = await syncTaskManagerTokenTelemetry({
      client: mockClient,
      project,
      dashboardPath: htmlFile,
    });

    expect(syncOk).toBe(true);

    const updatedContent = fs.readFileSync(htmlFile, "utf8");
    const match = updatedContent.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);

    expect(parsed.tokenUsage).toBeDefined();
    expect(parsed.tokenUsage.totals.total).toBe(1500);
    expect(parsed.tokenUsage.byAgent[0].agent).toBe("sdd-apply");

    // Tasks and notes must remain intact
    expect(parsed.phases[0].tasks[0].id).toBe("T1");
    expect(parsed.phases[0].tasks[0].note).toBe("Custom operator note");
    expect(parsed.phases[0].tasks[0].status).toBe("completed");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("mergeTaskManagerState preserves tokenUsage during concurrent agent task updates", () => {
    const priorState = {
      tokenUsage: {
        schemaVersion: "1.0",
        totals: { total: 5000 },
      },
      tasks: [{ id: "T1", title: "Task", status: "pending" }],
    };

    const evidenceState = {
      tasks: [{ id: "T1", status: "completed" }],
    };

    const merged = mergeTaskManagerState(priorState as any, evidenceState as any);
    expect(merged.tokenUsage).toEqual(priorState.tokenUsage);
    expect(merged.tasks).toEqual([{ id: "T1", title: "Task", status: "completed" }]);
  });
});
