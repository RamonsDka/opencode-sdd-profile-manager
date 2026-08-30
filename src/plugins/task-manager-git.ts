import * as child_process from "node:child_process";
import * as fs from "node:fs";
import { createLogger } from "../logger";
import { escapeIslandJson } from "./task-manager-lifecycle";
import {
  writeTaskManagerStateAtomically,
  withDashboardWriteLock,
} from "./task-manager-writer";
import type { TaskManagerProjectIdentity } from "./task-manager-root";

const log = createLogger("task-manager-git");

export interface TaskManagerGitCommit {
  hash: string;
  shortHash?: string;
  message: string;
  author?: string;
  date?: string;
}

export interface TaskManagerGitEvidence {
  branch: string;
  totalCount: number;
  limit: number;
  commits: TaskManagerGitCommit[];
  syncStatus?: string;
}

const STATE_ISLAND = /(<script\b[^>]*\bid=["']tm-state["'][^>]*>)([\s\S]*?)(<\/script>)/i;

/**
 * Safely collects host-side Git evidence from projectRoot using direct execFileSync without shell interpolation.
 * Returns null if the directory is not a Git repository or if collection fails.
 */
export function collectTaskManagerGitEvidence(
  directory: string,
  limit = 5
): TaskManagerGitEvidence | null {
  if (!directory || !fs.existsSync(directory)) {
    return null;
  }

  try {
    // 1. Verify directory is inside a git work tree
    const isGit = child_process
      .execFileSync("git", ["-C", directory, "rev-parse", "--is-inside-work-tree"], {
        encoding: "utf8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();

    if (isGit !== "true") {
      return null;
    }

    // 2. Resolve canonical branch name
    let branch = "main";
    try {
      const rawBranch = child_process
        .execFileSync("git", ["-C", directory, "rev-parse", "--abbrev-ref", "HEAD"], {
          encoding: "utf8",
          timeout: 3000,
          stdio: ["ignore", "pipe", "ignore"],
        })
        .trim();
      if (rawBranch && rawBranch !== "HEAD") {
        branch = rawBranch;
      }
    } catch {}

    // 3. Exact commit count (total commits in current history)
    let totalCount = 0;
    try {
      const countRaw = child_process
        .execFileSync("git", ["-C", directory, "rev-list", "--count", "HEAD"], {
          encoding: "utf8",
          timeout: 3000,
          stdio: ["ignore", "pipe", "ignore"],
        })
        .trim();
      const parsedCount = parseInt(countRaw, 10);
      if (!isNaN(parsedCount) && parsedCount >= 0) {
        totalCount = parsedCount;
      }
    } catch {}

    // 4. Bounded latest commits with delimiter-separated fields
    const commits: TaskManagerGitCommit[] = [];
    if (totalCount > 0) {
      try {
        const logOutput = child_process
          .execFileSync(
            "git",
            ["-C", directory, "log", `-n`, String(Math.max(1, limit)), "--format=%H%x1f%s%x1f%an%x1f%aI"],
            {
              encoding: "utf8",
              timeout: 3000,
              stdio: ["ignore", "pipe", "ignore"],
            }
          )
          .trim();

        if (logOutput) {
          const lines = logOutput.split("\n");
          for (const line of lines) {
            const parts = line.split("\x1f");
            if (parts.length >= 2) {
              const fullHash = parts[0]?.trim();
              const message = parts[1]?.trim() || "sin mensaje";
              const author = parts[2]?.trim();
              const date = parts[3]?.trim();
              if (fullHash) {
                commits.push({
                  hash: fullHash,
                  shortHash: fullHash.substring(0, 7),
                  message,
                  ...(author ? { author } : {}),
                  ...(date ? { date } : {}),
                });
              }
            }
          }
        }
      } catch (logErr) {
        log.warn(`collectTaskManagerGitEvidence: failed to fetch commit log for ${directory}`, logErr);
      }
    }

    return {
      branch,
      totalCount,
      limit,
      commits,
      syncStatus: "synced",
    };
  } catch {
    return null;
  }
}

export interface SyncTaskManagerGitOptions {
  project: TaskManagerProjectIdentity;
  dashboardPath: string;
  limit?: number;
  collector?: (directory: string, limit?: number) => TaskManagerGitEvidence | null;
}

/**
 * Synchronizes host Git evidence into the dashboard HTML file at dashboardPath.
 * Preserves tasks, phases, and existing user state while refreshing git telemetry.
 */
export async function syncTaskManagerGitEvidence(
  options: SyncTaskManagerGitOptions
): Promise<boolean> {
  const { project, dashboardPath, limit = 5, collector = collectTaskManagerGitEvidence } = options;

  if (!fs.existsSync(dashboardPath)) {
    return false;
  }

  const evidence = collector(project.canonicalRoot || project.root, limit);
  if (!evidence) {
    return false;
  }

  return withDashboardWriteLock(dashboardPath, async () => {
    try {
      if (!fs.existsSync(dashboardPath)) return false;
      const content = fs.readFileSync(dashboardPath, "utf8");
      const match = content.match(STATE_ISLAND);
      if (!match) {
        return false;
      }

      const state = JSON.parse(match[2]) as Record<string, any>;
      if (!state.meta || typeof state.meta !== "object") {
        state.meta = {};
      }

      // Set fresh host git evidence
      state.git = {
        ...state.git,
        branch: evidence.branch,
        totalCount: evidence.totalCount,
        limit: evidence.limit,
        commits: evidence.commits,
        syncStatus: evidence.syncStatus ?? "synced",
      };

      // Update metadata snapshot
      state.meta.branch = evidence.branch;
      if (evidence.commits.length > 0) {
        state.meta.commit = evidence.commits[0].hash;
      }

      const json = escapeIslandJson(state);
      const updatedHtml = content.replace(STATE_ISLAND, (_match, open, _current, close) => `${open}${json}${close}`);
      writeTaskManagerStateAtomically(dashboardPath, updatedHtml);
      return true;
    } catch (error) {
      log.warn(`syncTaskManagerGitEvidence: failed to write git state into ${dashboardPath}`, error);
      return false;
    }
  });
}
