import { describe, expect, it } from "vitest";
import {
  CANONICAL_BUILT_IN_AGENTS,
  createTaskManagerAgent,
  CURATED_BUILT_IN_AGENTS,
  CURATED_SPECIALIST_DEFINITIONS,
  discoverBuiltInAgents,
  getBuiltInDefinition,
  isCanonicalBuiltInAgent,
  isDiscoverableBuiltInAgent,
  TASK_MANAGER_AGENT_ID,
} from "../src/core/built-in-agents.ts";

describe("built-in agent registry", () => {
  it("defines exactly seven canonical agents with lowercase runtime IDs, Spanish metadata, and zero personal agent seeds", () => {
    expect(CANONICAL_BUILT_IN_AGENTS.map((agent) => agent.id)).toEqual([
      "general",
      "build",
      "plan",
      "explore",
      "compaction",
      "title",
      "summary",
    ]);

    expect(CANONICAL_BUILT_IN_AGENTS).toHaveLength(7);
    expect(CANONICAL_BUILT_IN_AGENTS.map((agent) => agent.id)).not.toContain("agent-github");
    expect(CANONICAL_BUILT_IN_AGENTS.map((agent) => agent.id)).not.toContain("agent-notebooklm");
    expect(CANONICAL_BUILT_IN_AGENTS.map((agent) => agent.id)).not.toContain("agent-especialit-github");

    expect(CANONICAL_BUILT_IN_AGENTS.find((agent) => agent.id === "plan")).toMatchObject({
      displayName: "Plan",
      classification: "public",
      curation: "curated",
      baseline: {
        description: expect.stringMatching(/[áéíóúñ]/i),
        model: expect.any(String),
        effort: expect.any(String),
        operations: expect.any(String),
        skills: expect.any(Array),
      },
    });
    expect(CANONICAL_BUILT_IN_AGENTS.filter((agent) => agent.classification === "internal").map((agent) => agent.id)).toEqual([
      "compaction",
      "title",
      "summary",
    ]);

    for (const id of ["build", "plan", "general", "explore", "compaction", "title", "summary"]) {
      const found = CANONICAL_BUILT_IN_AGENTS.find((a) => a.id === id);
      expect(found, `Built-in agent '${id}' must exist`).toBeDefined();
      expect(found!.baseline.description.length).toBeGreaterThan(0);
      expect(found!.baseline.operations.length).toBeGreaterThan(0);
    }
  });

  it("keeps curated baselines immutable when consumers attempt to modify a definition", () => {
    const plan = CANONICAL_BUILT_IN_AGENTS.find((agent) => agent.id === "plan");
    if (!plan) throw new Error("Missing plan built-in");

    const originalDescription = plan.baseline.description;
    expect(Object.isFrozen(plan.baseline)).toBe(true);
    expect(Object.isFrozen(plan.baseline.skills)).toBe(true);
    expect(() => (plan.baseline.skills as string[]).push("unsafe-skill")).toThrow();
    expect(plan.baseline.description).toBe(originalDescription);
    expect(plan.baseline.skills).not.toContain("unsafe-skill");
  });

  it("provides curated definition and discovery behavior for agent-task-manager without pending-curation warnings", () => {
    const def = getBuiltInDefinition(TASK_MANAGER_AGENT_ID);
    expect(def).toBeDefined();
    expect(def).toMatchObject({
      id: "agent-task-manager",
      displayName: "Agent Task Manager",
      classification: "public",
      curation: "curated",
      baseline: {
        description: expect.stringMatching(/Task-Manager-Portable\.html/i),
        operations: expect.stringMatching(/schemaVersion 1\.0/i),
        skills: ["task-tracker-manager"],
        mode: "all",
      },
    });

    expect(isCanonicalBuiltInAgent(TASK_MANAGER_AGENT_ID)).toBe(true);
    expect(CURATED_SPECIALIST_DEFINITIONS).toHaveLength(1);
    expect(CURATED_BUILT_IN_AGENTS).toHaveLength(8);

    expect(isDiscoverableBuiltInAgent(TASK_MANAGER_AGENT_ID)).toBe(false);

    const discovered = discoverBuiltInAgents({
      "agent-task-manager": { model: "openai/gpt-5" },
    });

    expect(discovered).toEqual([]);
  });

  it("creates agent-task-manager with mode all, safe permissions, and target path prompt", () => {
    const agent = createTaskManagerAgent("openai/gpt-5", "high");
    expect(agent.id).toBe("agent-task-manager");
    expect(agent.mode).toBe("all");
    expect(agent.model).toBe("openai/gpt-5");
    expect(agent.variant).toBe("high");
    expect(agent.permissions).toEqual({
      read: "allow",
      edit: "allow",
      skill: "allow",
      bash: "ask",
      task: "deny",
      write: "ask",
    });
    expect(agent.skills).toEqual(["task-tracker-manager"]);
    expect(agent.prompt).toContain("Task-Manager-Portable.html");
    expect(agent.prompt).toContain("tm-state");
  });

  it("discovers only unclassified runtime built-ins as pending curation with generic Spanish warnings", () => {
    const discovered = discoverBuiltInAgents({
      indexer: { model: "opencode/indexer" },
      "gentle-orchestrator": { model: "openai/orchestrator" },
      "sdd-builder": { model: "openai/sdd" },
      "review-risk": { model: "openai/review" },
      "jd-judge": { model: "openai/jd" },
      "build-fallback": { model: "openai/fallback" },
      "local-helper": { model: "openai/custom" },
    }, ["local-helper"]);

    expect(discovered).toEqual([
      expect.objectContaining({
        id: "indexer",
        displayName: "Indexer",
        classification: "public",
        curation: "pending-curation",
        baseline: expect.objectContaining({
          description: expect.stringMatching(/[áéíóúñ]/i),
        }),
        warnings: expect.arrayContaining([expect.stringMatching(/pendiente/i)]),
      }),
    ]);
  });
});
