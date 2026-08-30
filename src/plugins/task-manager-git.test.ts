import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectTaskManagerGitEvidence,
  syncTaskManagerGitEvidence,
} from "./task-manager-git";
import type { TaskManagerProjectIdentity } from "./task-manager-root";

describe("TaskManagerGit Collector & Sync", () => {
  let tempDir: string;
  let gitRepoDir: string;
  let nonGitDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-git-test-"));
    gitRepoDir = path.join(tempDir, "repo");
    nonGitDir = path.join(tempDir, "nongit");

    fs.mkdirSync(gitRepoDir, { recursive: true });
    fs.mkdirSync(nonGitDir, { recursive: true });

    // Initialize real git repo with 7 commits (> 5 commits limit)
    child_process.execFileSync("git", ["init"], { cwd: gitRepoDir, stdio: "ignore" });
    child_process.execFileSync("git", ["config", "user.name", "Test Runner"], { cwd: gitRepoDir, stdio: "ignore" });
    child_process.execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: gitRepoDir, stdio: "ignore" });

    for (let i = 1; i <= 7; i++) {
      const filePath = path.join(gitRepoDir, `file_${i}.txt`);
      fs.writeFileSync(filePath, `content ${i}`, "utf8");
      child_process.execFileSync("git", ["add", `file_${i}.txt`], { cwd: gitRepoDir, stdio: "ignore" });
      child_process.execFileSync("git", ["commit", "-m", `feat: commit message ${i}`], { cwd: gitRepoDir, stdio: "ignore" });
    }
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("collects truthful totalCount and bounded 5 latest commits from git repository", () => {
    const evidence = collectTaskManagerGitEvidence(gitRepoDir, 5);

    expect(evidence).not.toBeNull();
    expect(evidence!.totalCount).toBe(7);
    expect(evidence!.limit).toBe(5);
    expect(evidence!.commits).toHaveLength(5);
    expect(evidence!.commits[0].message).toBe("feat: commit message 7");
    expect(evidence!.commits[4].message).toBe("feat: commit message 3");
    expect(evidence!.commits[0].hash).toMatch(/^[0-9a-f]{40}$/i);
    expect(evidence!.commits[0].author).toBe("Test Runner");
    expect(evidence!.commits[0].date).toBeDefined();
    expect(evidence!.branch).toBeTruthy();
    expect(evidence!.syncStatus).toBe("synced");
  });

  it("returns null safely for non-git directories", () => {
    const evidence = collectTaskManagerGitEvidence(nonGitDir);
    expect(evidence).toBeNull();
  });

  it("returns null safely for non-existent directories", () => {
    const evidence = collectTaskManagerGitEvidence(path.join(tempDir, "missing"));
    expect(evidence).toBeNull();
  });

  it("syncs host git evidence into dashboard HTML state island atomically", async () => {
    const dashboardPath = path.join(gitRepoDir, "Task-Manager-Portable.html");
    const initialHtml = `<script id="tm-state">{"schemaVersion":"1.0","meta":{"projectName":"test-app","syncStatus":"idle"},"phases":[],"tasks":[{"id":"T1","title":"Initial","status":"pending"}]}</script>`;
    fs.writeFileSync(dashboardPath, initialHtml, "utf8");

    const project: TaskManagerProjectIdentity = {
      root: gitRepoDir,
      canonicalRoot: gitRepoDir,
      key: gitRepoDir.toLowerCase(),
      confirmed: true,
    };

    const synced = await syncTaskManagerGitEvidence({
      project,
      dashboardPath,
      limit: 5,
    });

    expect(synced).toBe(true);

    const updatedContent = fs.readFileSync(dashboardPath, "utf8");
    const match = updatedContent.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
    expect(match).not.toBeNull();

    const state = JSON.parse(match![1]);
    expect(state.git).toBeDefined();
    expect(state.git.totalCount).toBe(7);
    expect(state.git.limit).toBe(5);
    expect(state.git.commits).toHaveLength(5);
    expect(state.git.commits[0].message).toBe("feat: commit message 7");
    expect(state.meta.branch).toBe(state.git.branch);
    expect(state.meta.commit).toBe(state.git.commits[0].hash);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe("T1");
  });

  it("prevents foreign git data leakage when updating project dashboard", async () => {
    const dashboardPath = path.join(gitRepoDir, "Task-Manager-Portable.html");
    // Dashboard had foreign/sample git data from another project template
    const foreignHtml = `<script id="tm-state">{"schemaVersion":"1.0","meta":{"projectName":"foreign-repo","branch":"foreign-branch","commit":"foreign123"},"git":{"branch":"foreign-branch","commits":[{"hash":"foreign123","message":"chore: foreign commit"}],"totalCount":999},"phases":[]}</script>`;
    fs.writeFileSync(dashboardPath, foreignHtml, "utf8");

    const project: TaskManagerProjectIdentity = {
      root: gitRepoDir,
      canonicalRoot: gitRepoDir,
      key: gitRepoDir.toLowerCase(),
      confirmed: true,
    };

    const synced = await syncTaskManagerGitEvidence({
      project,
      dashboardPath,
      limit: 5,
    });

    expect(synced).toBe(true);

    const updatedContent = fs.readFileSync(dashboardPath, "utf8");
    const state = JSON.parse(updatedContent.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i)![1]);

    expect(state.git.totalCount).toBe(7);
    expect(state.git.commits[0].message).toBe("feat: commit message 7");
    expect(state.git.commits.some((c: any) => c.message.includes("foreign"))).toBe(false);
  });
});
