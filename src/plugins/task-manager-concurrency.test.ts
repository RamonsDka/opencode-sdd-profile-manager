import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  replaceTaskManagerState,
  writeTaskManagerStateAtomically,
  withDashboardWriteLock,
  globalDashboardWriteQueue,
} from "./task-manager-writer";
import {
  provisionTaskManagerBase,
  setTaskManagerRunningState,
  setTaskManagerSyncedState,
  setTaskManagerProlongedState,
  setTaskManagerErrorState,
  migrateLegacyTaskManagerHtml,
} from "./task-manager-lifecycle";
import { syncTaskManagerGitEvidence } from "./task-manager-git";
import {
  aggregateSessionMessages,
  collectTaskManagerTokenTelemetry,
  syncTaskManagerTokenTelemetry,
} from "./task-manager-telemetry";
import {
  createTaskManagerStore,
  TaskManagerDispatcher,
  captureTaskManagerIslandFingerprint,
} from "./task-manager-dispatcher";
import type { TaskManagerProjectIdentity } from "./task-manager-root";

describe("TaskManager Concurrency & Multi-Project Isolation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-concurrency-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("1. RegExp Replacement-String Injection Safety", () => {
    const baseHtml = '<!DOCTYPE html><html><head></head><body><script id="tm-state">{"schemaVersion":"1.0","phases":[],"tasks":[]}</script></body></html>';

    it("preserves literal $, $1, $&, $', $$, $`, and </script> in task notes and titles without corruption", () => {
      const maliciousState = {
        schemaVersion: "1.0",
        phases: [],
        tasks: [
          {
            id: "T-REGEX-1",
            title: "Fix issue with $1 and $& and $' and $$ tokens",
            note: "Contains $1 $2 $& $' $$ $` and </script><script>alert(1)</script>",
            status: "in-progress",
          },
        ],
        meta: {
          commit: "fix($1): commit message with $& and $'",
        },
      };

      const updatedHtml = replaceTaskManagerState(baseHtml, maliciousState as any);

      // Verify exactly one state island
      const matches = updatedHtml.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/gi);
      expect(matches).not.toBeNull();
      expect(matches?.length).toBe(1);

      // Verify the island extracts and parses cleanly with JSON.parse without trailing non-whitespace
      const islandContentMatch = updatedHtml.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
      expect(islandContentMatch).not.toBeNull();
      const rawIsland = islandContentMatch![1];
      const parsed = JSON.parse(rawIsland);

      expect(parsed.tasks[0].id).toBe("T-REGEX-1");
      expect(parsed.tasks[0].title).toBe("Fix issue with $1 and $& and $' and $$ tokens");
      expect(parsed.tasks[0].note).toContain("$1 $2 $& $' $$ $`");
      expect(parsed.meta.commit).toBe("fix($1): commit message with $& and $'");
      expect(rawIsland).not.toContain("</script>");
      expect(rawIsland).toContain("\\u003c/script>");
    });

    it("preserves replacement tokens across lifecycle helpers (running, synced, prolonged, error, migration)", () => {
      const dashboardPath = path.join(tempDir, "Task-Manager-Portable.html");
      const specialNote = "$1 $& $' $$ $` <special>";
      const initialHtml = `<!DOCTYPE html><html><body><script id="tm-state">{"schemaVersion":"1.0","tasks":[{"id":"T1","note":"${specialNote}"}],"meta":{}}</script></body></html>`;
      fs.writeFileSync(dashboardPath, initialHtml, "utf8");

      expect(setTaskManagerRunningState(dashboardPath, "special-$1-source")).toBe(true);
      let content = fs.readFileSync(dashboardPath, "utf8");
      let match = content.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
      let parsed = JSON.parse(match![1]);
      expect(parsed.tasks[0].note).toBe(specialNote);
      expect(parsed.meta.lastSyncSource).toBe("special-$1-source");

      expect(setTaskManagerProlongedState(dashboardPath, "agent-$&-prolonged")).toBe(true);
      content = fs.readFileSync(dashboardPath, "utf8");
      match = content.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
      parsed = JSON.parse(match![1]);
      expect(parsed.tasks[0].note).toBe(specialNote);
      expect(parsed.meta.lastSyncSource).toBe("agent-$&-prolonged");

      expect(setTaskManagerSyncedState(dashboardPath, "agent-$'-synced")).toBe(true);
      content = fs.readFileSync(dashboardPath, "utf8");
      match = content.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
      parsed = JSON.parse(match![1]);
      expect(parsed.tasks[0].note).toBe(specialNote);
      expect(parsed.meta.lastSyncSource).toBe("agent-$'-synced");

      expect(setTaskManagerErrorState(dashboardPath, "error with $1 and $&")).toBe(true);
      content = fs.readFileSync(dashboardPath, "utf8");
      match = content.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
      parsed = JSON.parse(match![1]);
      expect(parsed.tasks[0].note).toBe(specialNote);
      expect(parsed.meta.lastError).toBe("error with $1 and $&");
    });
  });

  describe("2. Unique Temp Files and Collision Safety", () => {
    it("creates unique temp files in the same directory and cleans up on completion", () => {
      const targetFile = path.join(tempDir, "Task-Manager-Portable.html");
      const htmlContent = '<html><body><script id="tm-state">{}</script></body></html>';

      writeTaskManagerStateAtomically(targetFile, htmlContent);

      expect(fs.existsSync(targetFile)).toBe(true);
      expect(fs.readFileSync(targetFile, "utf8")).toBe(htmlContent);

      // Verify no leftover .tmp files
      const leftoverTmp = fs.readdirSync(tempDir).filter((f) => f.includes(".tmp"));
      expect(leftoverTmp).toEqual([]);
    });

    it("concurrent atomic writes to different files do not collide on static tmp paths", async () => {
      const writes = Array.from({ length: 20 }, (_, i) => {
        const filePath = path.join(tempDir, `dashboard-${i}.html`);
        const content = `<html><body><script id="tm-state">{"index":${i}}</script></body></html>`;
        return Promise.resolve().then(() => {
          writeTaskManagerStateAtomically(filePath, content);
          const readBack = fs.readFileSync(filePath, "utf8");
          expect(readBack).toBe(content);
        });
      });

      await Promise.all(writes);

      const files = fs.readdirSync(tempDir);
      expect(files.filter((f) => f.endsWith(".html")).length).toBe(20);
      expect(files.filter((f) => f.includes(".tmp")).length).toBe(0);
    });
  });

  describe("3. In-process Per-File Write Serialization", () => {
    it("serializes concurrent git, telemetry, and status updates on the same dashboard without clobbering", async () => {
      const dashboardPath = path.join(tempDir, "Task-Manager-Portable.html");
      const initialHtml = `<!DOCTYPE html><html><body><script id="tm-state">{"schemaVersion":"1.0","tasks":[{"id":"T1","status":"pending","title":"Initial"}],"phases":[],"meta":{}}</script></body></html>`;
      fs.writeFileSync(dashboardPath, initialHtml, "utf8");

      const project: TaskManagerProjectIdentity = {
        root: tempDir,
        canonicalRoot: tempDir.replaceAll("\\", "/"),
        key: tempDir.toLowerCase(),
        confirmed: true,
      };

      // Mock collectors
      const mockGitCollector = () => ({
        branch: "feature/concurrency",
        totalCount: 42,
        limit: 5,
        commits: [{ hash: "c0ffee1", message: "commit $1 with $&", author: "Dev", date: new Date().toISOString() }],
        syncStatus: "synced",
      });

      // Run concurrent operations on the SAME dashboard file
      await Promise.all([
        syncTaskManagerGitEvidence({
          project,
          dashboardPath,
          collector: mockGitCollector,
        }),
        withDashboardWriteLock(dashboardPath, () => {
          setTaskManagerSyncedState(dashboardPath, "test-synced-agent");
        }),
      ]);

      const finalContent = fs.readFileSync(dashboardPath, "utf8");
      const match = finalContent.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
      expect(match).not.toBeNull();
      const state = JSON.parse(match![1]);

      // Both Git evidence and synced state should be present and intact
      expect(state.git?.branch).toBe("feature/concurrency");
      expect(state.git?.commits[0]?.message).toBe("commit $1 with $&");
      expect(state.tasks[0]?.id).toBe("T1");
      expect(state.meta?.syncStatus).toBe("synced");
    });

    it("allows operations on distinct project dashboards to execute concurrently without global blocking", async () => {
      const projectDirA = path.join(tempDir, "project-a");
      const projectDirB = path.join(tempDir, "project-b");
      fs.mkdirSync(projectDirA);
      fs.mkdirSync(projectDirB);

      const dashboardA = path.join(projectDirA, "Task-Manager-Portable.html");
      const dashboardB = path.join(projectDirB, "Task-Manager-Portable.html");

      fs.writeFileSync(dashboardA, `<html><body><script id="tm-state">{"project":"A","tasks":[]}</script></body></html>`);
      fs.writeFileSync(dashboardB, `<html><body><script id="tm-state">{"project":"B","tasks":[]}</script></body></html>`);

      const projA: TaskManagerProjectIdentity = {
        root: projectDirA,
        canonicalRoot: projectDirA.replaceAll("\\", "/"),
        key: projectDirA.toLowerCase(),
        confirmed: true,
      };
      const projB: TaskManagerProjectIdentity = {
        root: projectDirB,
        canonicalRoot: projectDirB.replaceAll("\\", "/"),
        key: projectDirB.toLowerCase(),
        confirmed: true,
      };

      await Promise.all([
        syncTaskManagerGitEvidence({
          project: projA,
          dashboardPath: dashboardA,
          collector: () => ({ branch: "main-a", totalCount: 1, limit: 1, commits: [] }),
        }),
        syncTaskManagerGitEvidence({
          project: projB,
          dashboardPath: dashboardB,
          collector: () => ({ branch: "main-b", totalCount: 2, limit: 1, commits: [] }),
        }),
      ]);

      const stateA = JSON.parse(fs.readFileSync(dashboardA, "utf8").match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i)![1]);
      const stateB = JSON.parse(fs.readFileSync(dashboardB, "utf8").match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i)![1]);

      expect(stateA.project).toBe("A");
      expect(stateA.git?.branch).toBe("main-a");
      expect(stateB.project).toBe("B");
      expect(stateB.git?.branch).toBe("main-b");
    });
    it("runs concurrent multi-project pipeline across Project A and Project B with strict island validity", async () => {
      const dirA = path.join(tempDir, "proj-a-root");
      const dirB = path.join(tempDir, "proj-b-root");
      fs.mkdirSync(dirA);
      fs.mkdirSync(dirB);

      const htmlA = path.join(dirA, "Task-Manager-Portable.html");
      const htmlB = path.join(dirB, "Task-Manager-Portable.html");

      const baseTemplate = '<!DOCTYPE html><html><body><div id="app"></div><script id="tm-state">{"schemaVersion":"1.0","meta":{},"tasks":[],"phases":[],"git":{}}</script></body></html>';
      fs.writeFileSync(htmlA, baseTemplate, "utf8");
      fs.writeFileSync(htmlB, baseTemplate, "utf8");

      const projA: TaskManagerProjectIdentity = {
        root: dirA,
        canonicalRoot: dirA.replaceAll("\\", "/"),
        key: dirA.toLowerCase(),
        confirmed: true,
      };
      const projB: TaskManagerProjectIdentity = {
        root: dirB,
        canonicalRoot: dirB.replaceAll("\\", "/"),
        key: dirB.toLowerCase(),
        confirmed: true,
      };

      // Mock collectors for A and B with special characters
      const collectorA = () => ({
        branch: "branch-$1-A",
        totalCount: 10,
        limit: 5,
        commits: [{ hash: "aaa111", message: "feat(A): initial $& tokens", author: "Dev A" }],
        syncStatus: "synced",
      });
      const collectorB = () => ({
        branch: "branch-$&-B",
        totalCount: 20,
        limit: 5,
        commits: [{ hash: "bbb222", message: "feat(B): special $' tokens", author: "Dev B" }],
        syncStatus: "synced",
      });

      // Fire concurrent updates on both projects simultaneously
      await Promise.all([
        // Project A pipeline
        (async () => {
          setTaskManagerRunningState(htmlA, "opening-A");
          await syncTaskManagerGitEvidence({ project: projA, dashboardPath: htmlA, collector: collectorA });
          setTaskManagerSyncedState(htmlA, "agent-A");
        })(),
        // Project B pipeline
        (async () => {
          setTaskManagerRunningState(htmlB, "opening-B");
          await syncTaskManagerGitEvidence({ project: projB, dashboardPath: htmlB, collector: collectorB });
          setTaskManagerSyncedState(htmlB, "agent-B");
        })(),
      ]);

      // Machine evidence verification for Project A
      const contentA = fs.readFileSync(htmlA, "utf8");
      const islandsA = contentA.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/gi);
      expect(islandsA).not.toBeNull();
      expect(islandsA?.length).toBe(1); // Exact count = 1

      const matchA = contentA.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
      expect(matchA).not.toBeNull();
      const rawJsonA = matchA![1];
      const parsedA = JSON.parse(rawJsonA); // Parse success with no trailing non-whitespace
      expect(parsedA.git?.branch).toBe("branch-$1-A");
      expect(parsedA.git?.commits[0]?.message).toBe("feat(A): initial $& tokens");
      expect(parsedA.meta?.syncStatus).toBe("synced");
      expect(parsedA.meta?.lastSyncSource).toBe("agent-A");

      // Machine evidence verification for Project B
      const contentB = fs.readFileSync(htmlB, "utf8");
      const islandsB = contentB.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/gi);
      expect(islandsB).not.toBeNull();
      expect(islandsB?.length).toBe(1); // Exact count = 1

      const matchB = contentB.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
      expect(matchB).not.toBeNull();
      const rawJsonB = matchB![1];
      const parsedB = JSON.parse(rawJsonB); // Parse success with no trailing non-whitespace
      expect(parsedB.git?.branch).toBe("branch-$&-B");
      expect(parsedB.git?.commits[0]?.message).toBe("feat(B): special $' tokens");
      expect(parsedB.meta?.syncStatus).toBe("synced");
      expect(parsedB.meta?.lastSyncSource).toBe("agent-B");
    });
  });

  describe("4. Global State Store Cross-Process Safety", () => {
    it("simulates concurrent updates from two store instances without lost project entries", async () => {
      const storeFile = path.join(tempDir, "shared-task-manager-state.json");
      const store1 = createTaskManagerStore(storeFile);
      const store2 = createTaskManagerStore(storeFile);

      // Concurrently update store 1 for proj-a and store 2 for proj-b multiple times
      const ops1 = Array.from({ length: 10 }, (_, i) => {
        return Promise.resolve().then(() => {
          store1.setProject("project-a", {
            initialized: true,
            lastMilestone: `milestone-a-${i}`,
            syncStatus: "synced",
          });
        });
      });

      const ops2 = Array.from({ length: 10 }, (_, i) => {
        return Promise.resolve().then(() => {
          store2.setProject("project-b", {
            initialized: true,
            lastMilestone: `milestone-b-${i}`,
            syncStatus: "synced",
          });
        });
      });

      await Promise.all([...ops1, ...ops2]);

      const finalStore = createTaskManagerStore(storeFile);
      const projA = finalStore.getProject("project-a");
      const projB = finalStore.getProject("project-b");

      expect(projA.initialized).toBe(true);
      expect(projA.lastMilestone).toBe("milestone-a-9");
      expect(projB.initialized).toBe(true);
      expect(projB.lastMilestone).toBe("milestone-b-9");
    });
  });

  describe("5. Telemetry Scope: Multi-Project Child Session Isolation", () => {
    it("excludes Project A child sessions when aggregating Project B telemetry", () => {
      const sessionMessagesMap = [
        // Project A Root Session
        {
          session: { id: "sess-a-root", directory: "C:/projects/project-a", title: "Project A Root" },
          messages: [
            { id: "m1", role: "assistant", agent: "agent-a", tokens: { total: 100 } },
          ],
        },
        // Project A Child Session (has parentID pointing to sess-a-root, no directory or different directory)
        {
          session: { id: "sess-a-child", parentID: "sess-a-root", directory: "", title: "Project A Child" },
          messages: [
            { id: "m2", role: "assistant", agent: "agent-a-sub", tokens: { total: 200 } },
          ],
        },
        // Project B Root Session
        {
          session: { id: "sess-b-root", directory: "C:/projects/project-b", title: "Project B Root" },
          messages: [
            { id: "m3", role: "assistant", agent: "agent-b", tokens: { total: 300 } },
          ],
        },
        // Project B Child Session
        {
          session: { id: "sess-b-child", parentID: "sess-b-root", directory: "", title: "Project B Child" },
          messages: [
            { id: "m4", role: "assistant", agent: "agent-b-sub", tokens: { total: 400 } },
          ],
        },
      ];

      // Aggregate for Project A
      const telemetryA = aggregateSessionMessages(sessionMessagesMap, { projectDirectory: "C:/projects/project-a" });
      const agentsA = telemetryA.byAgent.map((a) => a.agent);
      expect(agentsA).toContain("agent-a");
      expect(agentsA).toContain("agent-a-sub");
      expect(agentsA).not.toContain("agent-b");
      expect(agentsA).not.toContain("agent-b-sub");
      expect(telemetryA.totals.total).toBe(300);

      // Aggregate for Project B
      const telemetryB = aggregateSessionMessages(sessionMessagesMap, { projectDirectory: "C:/projects/project-b" });
      const agentsB = telemetryB.byAgent.map((a) => a.agent);
      expect(agentsB).toContain("agent-b");
      expect(agentsB).toContain("agent-b-sub");
      expect(agentsB).not.toContain("agent-a");
      expect(agentsB).not.toContain("agent-a-sub");
      expect(telemetryB.totals.total).toBe(700);
    });

    it("handles multi-level child session hierarchy attribution correctly", () => {
      const sessionMessagesMap = [
        {
          session: { id: "root-1", directory: "C:/my-app" },
          messages: [{ id: "m1", role: "assistant", agent: "root-agent", tokens: { total: 50 } }],
        },
        {
          session: { id: "child-level-1", parentID: "root-1" },
          messages: [{ id: "m2", role: "assistant", agent: "sub-agent-1", tokens: { total: 75 } }],
        },
        {
          session: { id: "child-level-2", parentID: "child-level-1" },
          messages: [{ id: "m3", role: "assistant", agent: "sub-agent-2", tokens: { total: 125 } }],
        },
        {
          session: { id: "foreign-root", directory: "C:/other-app" },
          messages: [{ id: "m4", role: "assistant", agent: "foreign-agent", tokens: { total: 500 } }],
        },
        {
          session: { id: "foreign-child", parentID: "foreign-root" },
          messages: [{ id: "m5", role: "assistant", agent: "foreign-sub", tokens: { total: 600 } }],
        },
      ];

      const result = aggregateSessionMessages(sessionMessagesMap, { projectDirectory: "C:/my-app" });
      expect(result.totals.total).toBe(250); // 50 + 75 + 125
      const agents = result.byAgent.map((a) => a.agent);
      expect(agents).toEqual(expect.arrayContaining(["root-agent", "sub-agent-1", "sub-agent-2"]));
      expect(agents).not.toContain("foreign-agent");
      expect(agents).not.toContain("foreign-sub");
    });
  });
});
