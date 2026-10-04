import { describe, expect, it, vi } from "vitest";
import { OpenCode, type SessionMessageAssistant, type SessionInfo, type SessionPromptInput } from "@opencode/client";
import { defaultTaskManagerAgentRunner } from "./task-manager-dispatcher";
import { collectTaskManagerTokenTelemetry } from "./task-manager-telemetry";

const project = { root: "C:/work/app", canonicalRoot: "C:/work/app", key: "c:/work/app", confirmed: true };

describe("native V2 task-manager bridge", () => {
  it("selects the agent and location at session creation, then sends text, not legacy parts", async () => {
    const create = vi.fn(async () => ({ id: "background" }));
    const prompt = vi.fn(async (input: SessionPromptInput) => {
      if (typeof input.text !== "string" || "parts" in input) throw new Error("Invalid V2 prompt");
    });
    const result = await defaultTaskManagerAgentRunner({ project, prompt: "refresh dashboard", mode: "refresh",
      dashboardPath: "missing-fixture.html", client: { session: { create, prompt }, message: { list: vi.fn() } },
      verifyDashboard: async () => true });
    expect(result).toEqual({ success: true });
    expect(create).toHaveBeenCalledWith({ title: "[Task Manager] C:/work/app", agent: "agent-task-manager", location: { directory: project.canonicalRoot } });
    expect(prompt).toHaveBeenCalledWith({ sessionID: "background", text: "refresh dashboard" });
  });

  it("paginates native sessions/messages and measures assistant usage without losing agent/model attribution", async () => {
    const session: SessionInfo = { id: "s", projectID: "p", agent: "general", location: { directory: project.root },
      cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, updated: 1 } };
    const assistant: SessionMessageAssistant = { id: "a", type: "assistant", agent: "sdd-verify", model: { providerID: "openai", id: "model" },
      time: { created: 1, completed: 2 }, content: [], cost: 0.5, tokens: { input: 10, output: 3, reasoning: 2, cache: { read: 4, write: 1 } } };
    const list = vi.fn(async (input: { cursor?: string }) => ({ data: input.cursor ? [] : [session], cursor: { next: input.cursor ? null : "sessions-next" } }));
    const messages = vi.fn(async (input: { cursor?: string }) => ({ data: input.cursor ? [assistant] : [], cursor: { next: input.cursor ? null : "messages-next" } }));
    const result = await collectTaskManagerTokenTelemetry({ project, client: { session: { list }, message: { list: messages } } });
    expect(list).toHaveBeenCalledWith({ directory: project.canonicalRoot, cursor: "sessions-next" });
    expect(messages).toHaveBeenCalledWith({ sessionID: "s", limit: 100, order: "asc", cursor: "messages-next" });
    expect(result?.totals.total).toBe(20);
    expect(result?.byAgent[0]).toMatchObject({ agent: "sdd-verify", model: "openai/model", total: 20, cost: 0.5, evidence: "measured" });
  });

  it("dispatches through the installed HTTP client using an isolated fetch stub", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const client = OpenCode.make({ baseUrl: "http://isolated.invalid", fetch: (async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });
      if ("text" in body && ("parts" in body || typeof body.text !== "string")) throw new Error("legacy prompt");
      return Response.json({ data: url.endsWith("/prompt") ? { id: "inbox" } : { id: "native-session" } });
    }) as typeof fetch });
    const result = await defaultTaskManagerAgentRunner({ project, prompt: "isolated refresh", mode: "refresh",
      dashboardPath: "missing-fixture.html", client, verifyDashboard: async () => false });
    expect(result).toEqual({ success: true, prolonged: true });
    expect(requests).toHaveLength(2);
    expect(requests[0].body).toMatchObject({ agent: "agent-task-manager", location: { directory: project.root } });
    expect(requests[1].body).toEqual({ text: "isolated refresh" });
  });
});
