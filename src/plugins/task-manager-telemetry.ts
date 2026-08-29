import * as fs from "node:fs";
import * as path from "node:path";
import { createLogger } from "../logger";
import type { TaskManagerProjectIdentity } from "./task-manager-root";
import {
  replaceTaskManagerState,
  writeTaskManagerStateAtomically,
  withDashboardWriteLock,
} from "./task-manager-writer";

const log = createLogger("task-manager-telemetry");

export type TokenEvidence = "measured" | "derived" | "estimated" | "unavailable";

export interface AgentTokenCategories {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface AgentTokenUsageEntry {
  agent: string;
  model?: string;
  models?: string[];
  categories: AgentTokenCategories;
  total: number;
  cost?: number;
  sessions?: number;
  messages?: number;
  evidence: TokenEvidence;
  confidence: number;
}

export interface TokenUsageTotals {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost?: number;
}

export interface TaskManagerTokenUsage {
  schemaVersion: "1.0";
  updatedAt: string;
  source: string;
  scope: string;
  root: string;
  totals: TokenUsageTotals;
  byAgent: AgentTokenUsageEntry[];
}

/**
 * Deterministic estimation from message text length (chars / 4).
 * Strictly labeled as 'estimated' with confidence <= 0.4.
 */
export function estimateTokensFromText(text?: string | null): number {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

function canonicalizePath(p?: string): string {
  if (!p) return "";
  return path.win32.normalize(p).replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

export interface RawSession {
  id?: string;
  sessionID?: string;
  directory?: string;
  parentID?: string;
  title?: string;
  [key: string]: unknown;
}

export interface RawMessage {
  id?: string;
  role?: string;
  agent?: string;
  sender?: string;
  parentID?: string;
  model?: string | { providerID?: string; modelID?: string };
  tokens?: {
    input?: number;
    prompt?: number;
    output?: number;
    completion?: number;
    reasoning?: number;
    cache?: {
      read?: number;
      write?: number;
    };
    cacheRead?: number;
    cache_read?: number;
    read?: number;
    cacheWrite?: number;
    cache_write?: number;
    write?: number;
    total?: number;
  };
  cost?: number;
  parts?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  text?: string;
  content?: string;
  info?: {
    role?: string;
    agent?: string;
    parentID?: string;
    model?: string | { providerID?: string; modelID?: string };
    tokens?: RawMessage["tokens"];
    cost?: number;
    [key: string]: unknown;
  };
  data?: {
    role?: string;
    agent?: string;
    parentID?: string;
    model?: string | { providerID?: string; modelID?: string };
    tokens?: RawMessage["tokens"];
    cost?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface AgentAccumulator {
  agent: string;
  models: Set<string>;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
  hasCost: boolean;
  sessions: Set<string>;
  messageCount: number;
  measuredMessages: number;
  estimatedMessages: number;
}

export function isSessionInProject(
  sessionId: string,
  sessionMap: Map<string, { directory?: string; parentID?: string }>,
  projectCanon: string,
  visited = new Set<string>()
): boolean {
  if (!projectCanon) return true;
  if (!sessionId || visited.has(sessionId)) return false;
  visited.add(sessionId);

  const session = sessionMap.get(sessionId);
  if (!session) return false;

  const sessDir = canonicalizePath(session.directory);
  if (sessDir === projectCanon) return true;

  if (session.parentID) {
    return isSessionInProject(session.parentID, sessionMap, projectCanon, visited);
  }
  return false;
}

export function aggregateSessionMessages(
  sessionMessagesMap: Array<{ session: RawSession; messages: RawMessage[] }>,
  options: { projectDirectory?: string } = {}
): TaskManagerTokenUsage {
  const projectCanon = canonicalizePath(options.projectDirectory);
  const accumulators = new Map<string, AgentAccumulator>();
  const seenMessageKeys = new Set<string>();

  // Build session graph
  const sessionMap = new Map<string, { directory?: string; parentID?: string }>();
  for (const { session } of sessionMessagesMap) {
    const sId = session.id || session.sessionID;
    if (sId) {
      sessionMap.set(sId, { directory: session.directory, parentID: session.parentID });
    }
  }

  for (const { session, messages } of sessionMessagesMap) {
    const sessionID = session.id || session.sessionID || "unknown-session";

    // Strict project scoping with parent chain verification
    if (projectCanon && !isSessionInProject(sessionID, sessionMap, projectCanon)) {
      continue;
    }

    // Pass 1: Index User messages to map message ID -> Agent
    const userMessageAgentMap = new Map<string, string>();
    for (const msg of messages) {
      const role = msg.role || msg.info?.role || msg.data?.role;
      if (role === "user" && msg.id) {
        const userAgent = (msg.agent || msg.info?.agent || msg.data?.agent || msg.sender || "").trim();
        if (userAgent) {
          userMessageAgentMap.set(msg.id, userAgent);
        }
      }
    }

    // Pass 2: Aggregate Assistant messages
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = msg.role || msg.info?.role || msg.data?.role;
      if (role !== "assistant") continue;

      const msgKey = msg.id ? `${sessionID}:${msg.id}` : `${sessionID}:msg-${i}`;
      if (seenMessageKeys.has(msgKey)) continue;
      seenMessageKeys.add(msgKey);

      const parentID = msg.parentID || msg.info?.parentID || msg.data?.parentID;
      const parentUserAgent = parentID ? userMessageAgentMap.get(parentID) : undefined;
      const sessionAgent = typeof session.agent === "string" ? session.agent.trim() : undefined;

      const agent = (
        msg.agent ||
        msg.info?.agent ||
        msg.data?.agent ||
        parentUserAgent ||
        sessionAgent ||
        msg.sender ||
        "orchestrator"
      ).trim() || "orchestrator";

      let modelName: string | undefined;

      const rawModel = msg.model || msg.info?.model || msg.data?.model;
      if (typeof rawModel === "string") {
        modelName = rawModel;
      } else if (rawModel && typeof rawModel === "object") {
        modelName = rawModel.modelID || (rawModel.providerID ? `${rawModel.providerID}/${rawModel.modelID || ""}` : undefined);
      }

      const rawTokens = msg.tokens || msg.info?.tokens || msg.data?.tokens;
      const rawCost = msg.cost ?? msg.info?.cost ?? msg.data?.cost;

      let acc = accumulators.get(agent);
      if (!acc) {
        acc = {
          agent,
          models: new Set<string>(),
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
          cost: 0,
          hasCost: false,
          sessions: new Set<string>(),
          messageCount: 0,
          measuredMessages: 0,
          estimatedMessages: 0,
        };
        accumulators.set(agent, acc);
      }

      acc.sessions.add(sessionID);
      acc.messageCount += 1;
      if (modelName) acc.models.add(modelName);

      if (typeof rawCost === "number" && isFinite(rawCost) && rawCost >= 0) {
        acc.cost += rawCost;
        acc.hasCost = true;
      }

      if (rawTokens && typeof rawTokens === "object") {
        const inp = Math.max(0, Number(rawTokens.input ?? rawTokens.prompt ?? 0) || 0);
        const out = Math.max(0, Number(rawTokens.output ?? rawTokens.completion ?? 0) || 0);
        const rea = Math.max(0, Number(rawTokens.reasoning ?? 0) || 0);
        const cRd = Math.max(0, Number(rawTokens.cache?.read ?? rawTokens.cacheRead ?? rawTokens.cache_read ?? rawTokens.read ?? 0) || 0);
        const cWr = Math.max(0, Number(rawTokens.cache?.write ?? rawTokens.cacheWrite ?? rawTokens.cache_write ?? rawTokens.write ?? 0) || 0);
        const tot = Math.max(0, Number(rawTokens.total ?? (inp + out + rea + cRd + cWr)) || 0);

        if (tot > 0 || inp > 0 || out > 0 || cRd > 0 || cWr > 0) {
          acc.input += inp;
          acc.output += out;
          acc.reasoning += rea;
          acc.cacheRead += cRd;
          acc.cacheWrite += cWr;
          acc.total += tot;
          acc.measuredMessages += 1;
          continue;
        }
      }

      // If tokens absent, attempt deterministic text estimate
      let text = "";
      if (Array.isArray(msg.parts)) {
        text = msg.parts
          .filter((p) => p && typeof p.text === "string")
          .map((p) => p.text)
          .join(" ");
      } else if (typeof msg.text === "string") {
        text = msg.text;
      } else if (typeof msg.content === "string") {
        text = msg.content;
      }

      if (text.length > 0) {
        const estimatedOut = estimateTokensFromText(text);
        acc.output += estimatedOut;
        acc.total += estimatedOut;
        acc.estimatedMessages += 1;
      }
    }
  }

  const byAgent: AgentTokenUsageEntry[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let totalReasoning = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let grandTotal = 0;
  let totalCost = 0;
  let anyCostReported = false;

  for (const acc of accumulators.values()) {
    let evidence: TokenEvidence = "unavailable";
    let confidence = 0;

    if (acc.measuredMessages > 0 && acc.estimatedMessages === 0) {
      evidence = acc.sessions.size > 1 ? "derived" : "measured";
      confidence = 1.0;
    } else if (acc.measuredMessages > 0 && acc.estimatedMessages > 0) {
      evidence = "derived";
      confidence = 0.8;
    } else if (acc.estimatedMessages > 0) {
      evidence = "estimated";
      confidence = 0.35;
    }

    const modelsList = Array.from(acc.models);
    const entry: AgentTokenUsageEntry = {
      agent: acc.agent,
      model: modelsList[0] || undefined,
      models: modelsList.length > 0 ? modelsList : undefined,
      categories: {
        input: acc.input,
        output: acc.output,
        reasoning: acc.reasoning,
        cacheRead: acc.cacheRead,
        cacheWrite: acc.cacheWrite,
        total: acc.total,
      },
      total: acc.total,
      cost: acc.hasCost ? Number(acc.cost.toFixed(6)) : undefined,
      sessions: acc.sessions.size,
      messages: acc.messageCount,
      evidence,
      confidence,
    };

    byAgent.push(entry);

    totalInput += acc.input;
    totalOutput += acc.output;
    totalReasoning += acc.reasoning;
    totalCacheRead += acc.cacheRead;
    totalCacheWrite += acc.cacheWrite;
    grandTotal += acc.total;
    if (acc.hasCost) {
      totalCost += acc.cost;
      anyCostReported = true;
    }
  }

  // Sort descending by total tokens
  byAgent.sort((a, b) => b.total - a.total);

  return {
    schemaVersion: "1.0",
    updatedAt: new Date().toISOString(),
    source: "opencode-sdk",
    scope: options.projectDirectory || "",
    root: options.projectDirectory || "",
    totals: {
      input: totalInput,
      output: totalOutput,
      reasoning: totalReasoning,
      cacheRead: totalCacheRead,
      cacheWrite: totalCacheWrite,
      total: grandTotal,
      cost: anyCostReported ? Number(totalCost.toFixed(6)) : undefined,
    },
    byAgent,
  };
}

function findOpenCodeSqlitePath(customPath?: string): string | null {
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }
  const envPath = process.env.OPENCODE_DB_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }
  const userProfile = process.env.USERPROFILE || process.env.HOME || "";
  const candidates = [
    path.join(userProfile, ".local", "share", "opencode", "opencode.db"),
    path.join(process.env.APPDATA || "", "opencode", "opencode.db"),
    path.join(process.env.LOCALAPPDATA || "", "opencode", "opencode.db"),
    path.join(userProfile, ".config", "opencode", "opencode.db"),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function collectSqliteTokenTelemetry(options: {
  project: TaskManagerProjectIdentity;
  sqlitePath?: string;
}): Promise<TaskManagerTokenUsage | null> {
  const dbPath = findOpenCodeSqlitePath(options.sqlitePath);
  if (!dbPath) return null;

  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const projectCanon = canonicalizePath(options.project.canonicalRoot);
      const rows = db.prepare(
        "SELECT id, directory, parent_id, agent, model, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost FROM session"
      ).all() as Array<{
        id: string;
        directory?: string | null;
        parent_id?: string | null;
        agent?: string | null;
        model?: string | null;
        tokens_input?: number | null;
        tokens_output?: number | null;
        tokens_reasoning?: number | null;
        tokens_cache_read?: number | null;
        tokens_cache_write?: number | null;
        cost?: number | null;
      }>;

      // Build session map for ancestor resolution
      const sqliteSessionMap = new Map<string, { directory?: string; parentID?: string }>();
      for (const row of rows) {
        sqliteSessionMap.set(row.id, {
          directory: row.directory || undefined,
          parentID: row.parent_id || undefined,
        });
      }

      // Filter rows that belong to this project (directly or through parent hierarchy)
      const projectSessions = rows.filter((row) =>
        isSessionInProject(row.id, sqliteSessionMap, projectCanon)
      );

      if (projectSessions.length === 0) {
        return null;
      }

      const agentMap = new Map<string, {
        agent: string;
        models: Set<string>;
        input: number;
        output: number;
        reasoning: number;
        cacheRead: number;
        cacheWrite: number;
        total: number;
        cost: number;
        hasCost: boolean;
        sessions: number;
      }>();

      let totalInput = 0;
      let totalOutput = 0;
      let totalReasoning = 0;
      let totalCacheRead = 0;
      let totalCacheWrite = 0;
      let grandTotal = 0;
      let totalCost = 0;
      let anyCostReported = false;

      for (const s of projectSessions) {
        const agent = (s.agent || "orchestrator").trim() || "orchestrator";
        let modelName: string | undefined;
        if (typeof s.model === "string" && s.model.trim()) {
          try {
            const parsedModel = JSON.parse(s.model);
            modelName = parsedModel.id || parsedModel.modelID || (parsedModel.providerID ? `${parsedModel.providerID}/${parsedModel.modelID || ""}` : undefined);
          } catch {
            modelName = s.model;
          }
        }

        const inp = Math.max(0, Number(s.tokens_input) || 0);
        const out = Math.max(0, Number(s.tokens_output) || 0);
        const rea = Math.max(0, Number(s.tokens_reasoning) || 0);
        const cRd = Math.max(0, Number(s.tokens_cache_read) || 0);
        const cWr = Math.max(0, Number(s.tokens_cache_write) || 0);
        const tot = inp + out + rea + cRd + cWr;
        const cost = typeof s.cost === "number" && isFinite(s.cost) && s.cost >= 0 ? s.cost : 0;

        let entry = agentMap.get(agent);
        if (!entry) {
          entry = {
            agent,
            models: new Set<string>(),
            input: 0,
            output: 0,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
            cost: 0,
            hasCost: false,
            sessions: 0,
          };
          agentMap.set(agent, entry);
        }

        entry.sessions += 1;
        if (modelName) entry.models.add(modelName);
        entry.input += inp;
        entry.output += out;
        entry.reasoning += rea;
        entry.cacheRead += cRd;
        entry.cacheWrite += cWr;
        entry.total += tot;
        if (cost > 0) {
          entry.cost += cost;
          entry.hasCost = true;
        }

        totalInput += inp;
        totalOutput += out;
        totalReasoning += rea;
        totalCacheRead += cRd;
        totalCacheWrite += cWr;
        grandTotal += tot;
        if (cost > 0) {
          totalCost += cost;
          anyCostReported = true;
        }
      }

      const byAgent: AgentTokenUsageEntry[] = Array.from(agentMap.values()).map((entry) => {
        const modelsList = Array.from(entry.models);
        return {
          agent: entry.agent,
          model: modelsList[0] || undefined,
          models: modelsList.length > 0 ? modelsList : undefined,
          categories: {
            input: entry.input,
            output: entry.output,
            reasoning: entry.reasoning,
            cacheRead: entry.cacheRead,
            cacheWrite: entry.cacheWrite,
            total: entry.total,
          },
          total: entry.total,
          cost: entry.hasCost ? Number(entry.cost.toFixed(6)) : undefined,
          sessions: entry.sessions,
          evidence: "derived",
          confidence: 0.95,
        };
      });

      byAgent.sort((a, b) => b.total - a.total);

      return {
        schemaVersion: "1.0",
        updatedAt: new Date().toISOString(),
        source: "opencode-sqlite-readonly",
        scope: options.project.canonicalRoot,
        root: options.project.canonicalRoot,
        totals: {
          input: totalInput,
          output: totalOutput,
          reasoning: totalReasoning,
          cacheRead: totalCacheRead,
          cacheWrite: totalCacheWrite,
          total: grandTotal,
          cost: anyCostReported ? Number(totalCost.toFixed(6)) : undefined,
        },
        byAgent,
      };
    } finally {
      db.close();
    }
  } catch (err) {
    log.warn("collectSqliteTokenTelemetry: failed to read local sqlite DB", err);
    return null;
  }
}

export function deriveActivityTelemetryFromState(
  state: any,
  projectRoot: string
): TaskManagerTokenUsage | null {
  if (!state || typeof state !== "object") return null;

  const tasksList: Array<{ id?: string; owner?: string; status?: string; subtasks?: Array<{ done?: boolean }> }> = [];
  if (Array.isArray(state.phases)) {
    for (const phase of state.phases) {
      if (Array.isArray(phase.tasks)) {
        tasksList.push(...phase.tasks);
      }
    }
  }
  if (Array.isArray(state.tasks)) {
    tasksList.push(...state.tasks);
  }

  if (tasksList.length === 0) return null;

  const agentUnitsMap = new Map<string, { units: number; count: number }>();
  let grandTotalUnits = 0;

  for (const task of tasksList) {
    const owner = (task.owner || "orchestrator").trim() || "orchestrator";
    let weight = 2; // pending default
    const status = String(task.status || "").toLowerCase();
    if (status === "completed") weight = 10;
    else if (status === "in-progress" || status === "inprogress") weight = 5;
    else if (status === "blocked") weight = 3;

    if (Array.isArray(task.subtasks)) {
      for (const st of task.subtasks) {
        if (st && st.done) weight += 2;
      }
    }

    const current = agentUnitsMap.get(owner) ?? { units: 0, count: 0 };
    current.units += weight;
    current.count += 1;
    agentUnitsMap.set(owner, current);
    grandTotalUnits += weight;
  }

  if (grandTotalUnits === 0) return null;

  const byAgent: AgentTokenUsageEntry[] = Array.from(agentUnitsMap.entries()).map(([agent, { units, count }]) => ({
    agent,
    categories: {
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: units,
    },
    total: units,
    messages: count,
    sessions: 1,
    evidence: "estimated",
    confidence: 0.25,
  }));

  byAgent.sort((a, b) => b.total - a.total);

  return {
    schemaVersion: "1.0",
    updatedAt: new Date().toISOString(),
    source: "activity-estimation",
    scope: projectRoot,
    root: projectRoot,
    totals: {
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: grandTotalUnits,
      cost: undefined,
    },
    byAgent,
  };
}

export async function collectTaskManagerTokenTelemetry(options: {
  client?: any;
  project: TaskManagerProjectIdentity;
  sqlitePath?: string;
}): Promise<TaskManagerTokenUsage | null> {
  const { client, project, sqlitePath } = options;

  let sdkTelemetry: TaskManagerTokenUsage | null = null;

  if (client && typeof client.session?.list === "function") {
    try {
      let listRes: any;
      try {
        listRes = await client.session.list({ query: { directory: project.canonicalRoot } });
      } catch {
        listRes = await client.session.list({ directory: project.canonicalRoot });
      }

      if (!listRes && listRes !== 0) {
        listRes = await client.session.list({ directory: project.canonicalRoot });
      }

      const rawSessions: RawSession[] = Array.isArray(listRes) ? listRes : listRes?.data ?? [];

      const projectCanon = canonicalizePath(project.canonicalRoot);
      const sessionMap = new Map<string, { directory?: string; parentID?: string }>();
      for (const sess of rawSessions) {
        const sid = sess.id || sess.sessionID;
        if (sid) {
          sessionMap.set(sid, { directory: sess.directory, parentID: sess.parentID });
        }
      }

      const candidateSessions = rawSessions.filter((sess) => {
        const sid = sess.id || sess.sessionID;
        return sid ? isSessionInProject(sid, sessionMap, projectCanon) : false;
      });

      const sessionMessages: Array<{ session: RawSession; messages: RawMessage[] }> = [];

      for (const session of candidateSessions) {
        const sessionID = session.id || session.sessionID;
        if (!sessionID) continue;

        try {
          let msgRes: any;
          if (typeof client.session.messages === "function") {
            try {
              msgRes = await client.session.messages({ path: { id: sessionID }, query: { limit: 100 } });
            } catch {
              msgRes = await client.session.messages({ sessionID });
            }
            if (!msgRes && msgRes !== 0) {
              msgRes = await client.session.messages({ sessionID });
            }
          }
          const rawMsgs: RawMessage[] = Array.isArray(msgRes) ? msgRes : msgRes?.data ?? [];
          sessionMessages.push({ session, messages: rawMsgs });
        } catch (err) {
          log.warn(`Failed to retrieve messages for session ${sessionID}`, err);
        }
      }

      sdkTelemetry = aggregateSessionMessages(sessionMessages, { projectDirectory: project.canonicalRoot });
    } catch (error) {
      log.warn("collectTaskManagerTokenTelemetry: failed to query OpenCode SDK", error);
    }
  }

  // If SDK gave non-zero telemetry, return it immediately
  if (sdkTelemetry && sdkTelemetry.totals.total > 0) {
    return sdkTelemetry;
  }

  // Next, try local read-only SQLite fallback
  try {
    const sqliteTelemetry = await collectSqliteTokenTelemetry({ project, sqlitePath });
    if (sqliteTelemetry && sqliteTelemetry.totals.total > 0) {
      return sqliteTelemetry;
    }
  } catch (sqliteErr) {
    log.warn("collectTaskManagerTokenTelemetry: sqlite fallback failed", sqliteErr);
  }

  return sdkTelemetry;
}

export async function syncTaskManagerTokenTelemetry(options: {
  client?: any;
  project: TaskManagerProjectIdentity;
  dashboardPath: string;
  sqlitePath?: string;
}): Promise<boolean> {
  const { client, project, dashboardPath, sqlitePath } = options;
  if (!fs.existsSync(dashboardPath)) return false;

  return withDashboardWriteLock(dashboardPath, async () => {
    try {
      if (!fs.existsSync(dashboardPath)) return false;
      let telemetry = await collectTaskManagerTokenTelemetry({ client, project, sqlitePath });

      const html = fs.readFileSync(dashboardPath, "utf8");
      const match = html.match(/<script\b[^>]*\bid=["']tm-state["'][^>]*>([\s\S]*?)<\/script>/i);
      if (!match) return false;

      const state = JSON.parse(match[1]);

      // If neither SDK nor SQLite gave tokens, try Tier 3 activity fallback from state tasks
      if (!telemetry || telemetry.totals.total === 0) {
        const activityTelemetry = deriveActivityTelemetryFromState(state, project.canonicalRoot);
        if (activityTelemetry) {
          telemetry = activityTelemetry;
        }
      }

      if (!telemetry) return false;

      state.tokenUsage = telemetry;

      const updatedHtml = replaceTaskManagerState(html, state);
      writeTaskManagerStateAtomically(dashboardPath, updatedHtml);
      return true;
    } catch (error) {
      log.warn(`syncTaskManagerTokenTelemetry: failed to update ${dashboardPath}`, error);
      return false;
    }
  });
}
