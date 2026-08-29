import { describe, expect, it } from "vitest";
import { generateAgentMarkdown } from "../src/core/agent-markdown.ts";
import { createTaskManagerAgent } from "../src/core/built-in-agents.ts";

describe("custom agent markdown", () => {
  it("materializes skill permission and explicit instructions in prompt", () => {
    const markdown = generateAgentMarkdown({ id: "researcher", description: "Research", model: "openai/x", prompt: "Be precise.", skills: ["web-search", "code-review"], permissions: { read: "allow", edit: "deny" } });
    expect(markdown).toContain("name: researcher");
    expect(markdown).toContain("permission:");
    expect(markdown).toContain("skill: allow");
    expect(markdown).toContain("Use the associated skills: web-search, code-review.");
    expect(markdown).not.toMatch(/skills:\s*\[/);
  });

  it("emits a selected native variant and omits it for default behavior", () => {
    const selected = generateAgentMarkdown({ id: "researcher", description: "Research", model: "openai/x", variant: "high", prompt: "Be precise.", skills: [], permissions: {} });
    const defaultVariant = generateAgentMarkdown({ id: "researcher", description: "Research", model: "openai/x", prompt: "Be precise.", skills: [], permissions: {} });

    expect(selected).toContain("variant: high");
    expect(defaultVariant).not.toContain("variant:");
  });

  it("serializes agent-task-manager with mode all, permissions, and skill instructions", () => {
    const agent = createTaskManagerAgent("anthropic/claude-3-7-sonnet");
    const markdown = generateAgentMarkdown(agent);

    expect(markdown).toContain("name: agent-task-manager");
    expect(markdown).toContain("mode: all");
    expect(markdown).toContain("model: anthropic/claude-3-7-sonnet");
    expect(markdown).toContain("read: allow");
    expect(markdown).toContain("edit: allow");
    expect(markdown).toContain("skill: allow");
    expect(markdown).toContain("bash: ask");
    expect(markdown).toContain("task: deny");
    expect(markdown).toContain("write: ask");
    expect(markdown).toContain("Task-Manager-Portable.html");
    expect(markdown).toContain("Use the associated skills: task-tracker-manager.");
  });

  it("rejects invalid agent mode or frontmatter injection in mode", () => {
    expect(() => generateAgentMarkdown({
      id: "safe-agent",
      description: "Safe",
      model: "openai/x",
      mode: "invalid-mode" as never,
      prompt: "Do work.",
      permissions: {},
      skills: [],
    })).toThrow(/invalid agent mode/i);

    expect(() => generateAgentMarkdown({
      id: "safe-agent",
      description: "Safe",
      model: "openai/x",
      mode: "all\nadmin: true" as never,
      prompt: "Do work.",
      permissions: {},
      skills: [],
    })).toThrow(/invalid agent mode/i);
  });
});
