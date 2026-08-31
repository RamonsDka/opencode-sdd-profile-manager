import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { generateAgentMarkdown } from "../src/core/agent-markdown.ts";
import { createTaskManagerAgent } from "../src/core/built-in-agents.ts";
import { generateTaskManagerMarkdown, TASK_MANAGER_RECOMMENDED_PERMISSIONS } from "../src/core/permission-profiles.ts";

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

  it("serializes agent-task-manager with mode all, permissions, exact YAML order, and valid js-yaml parsing", () => {
    const agent = createTaskManagerAgent("anthropic/claude-3-7-sonnet");
    const markdown = generateAgentMarkdown(agent);

    expect(markdown).toContain("name: agent-task-manager");
    expect(markdown).toContain("mode: all");
    expect(markdown).toContain("model: anthropic/claude-3-7-sonnet");
    expect(markdown).toContain("read: allow");
    expect(markdown).toContain("glob: allow");
    expect(markdown).toContain("grep: allow");
    expect(markdown).toContain("list: allow");
    expect(markdown).toContain("skill: allow");
    expect(markdown).toContain("task: deny");
    expect(markdown).toContain("todowrite: allow");
    expect(markdown).toContain("question: allow");
    expect(markdown).toContain("external_directory: ask");

    // Catch-all '*' must be emitted FIRST for OpenCode last-match-wins semantics
    const bashSection = `  bash:\n    "*": ask\n    "git status*": allow\n    "git branch --show-current*": allow\n    "git log*": allow\n    "git rev-parse*": allow`;
    const editSection = `  edit:\n    "*": ask\n    "*Task-Manager-Portable.html*": allow\n    "*drop-in-task-manager.html*": allow`;

    expect(markdown).toContain(bashSection);
    expect(markdown).toContain(editSection);
    expect(markdown).not.toMatch(/^\s+write:/m);
    expect(markdown).not.toContain("[object Object]");
    expect(markdown).toContain("Task-Manager-Portable.html");
    expect(markdown).toContain("Use the associated skills: task-tracker-manager.");

    // Validate frontmatter strictly with js-yaml parser
    const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(frontmatterMatch).not.toBeNull();
    const parsed = yaml.load(frontmatterMatch![1]) as any;

    expect(parsed).toMatchObject({
      name: "agent-task-manager",
      mode: "all",
      model: "anthropic/claude-3-7-sonnet",
      permission: {
        read: "allow",
        glob: "allow",
        grep: "allow",
        list: "allow",
        skill: "allow",
        task: "deny",
        todowrite: "allow",
        question: "allow",
        external_directory: "ask",
      },
    });

    expect(Object.keys(parsed.permission.bash)).toEqual([
      "*",
      "git status*",
      "git branch --show-current*",
      "git log*",
      "git rev-parse*",
    ]);
    expect(Object.keys(parsed.permission.edit)).toEqual([
      "*",
      "*Task-Manager-Portable.html*",
      "*drop-in-task-manager.html*",
    ]);
  });

  it("validates generateTaskManagerMarkdown matches canonical structure and parser validation", () => {
    const markdown = generateTaskManagerMarkdown("recommended");
    expect(markdown).not.toBeNull();
    expect(markdown).toContain("<!-- opencode-agent-suite:managed:agent-task-manager:v1 -->");

    const frontmatterMatch = markdown!.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(frontmatterMatch).not.toBeNull();
    const parsed = yaml.load(frontmatterMatch![1]) as any;

    expect(parsed.name).toBe("agent-task-manager");
    expect(parsed.mode).toBe("all");
    expect(parsed.permission.bash["*"]).toBe("ask");
    expect(parsed.permission.bash["git status*"]).toBe("allow");
    expect(parsed.permission.edit["*"]).toBe("ask");
    expect(parsed.permission.edit["*Task-Manager-Portable.html*"]).toBe("allow");
  });

  it("serializes complex nested permissions deterministically with quote-safety without [object Object]", () => {
    const markdown = generateAgentMarkdown({
      id: "specialist",
      description: "Specialist",
      model: "openai/gpt-5",
      prompt: "Execute safely.",
      skills: [],
      permissions: {
        read: "allow",
        bash: {
          "npm test*": "allow",
          "rm -rf *": "deny",
          "*": "ask",
        },
        edit: {
          "src/**/*.ts": "allow",
          "*": "ask",
        },
      },
    });

    expect(markdown).not.toContain("[object Object]");
    expect(markdown).toContain("permission:\n");
    // Ensure catchall '*' is hoisted first
    expect(markdown).toContain("  bash:\n    \"*\": ask\n    \"npm test*\": allow\n    \"rm -rf *\": deny\n");
    expect(markdown).toContain("  edit:\n    \"*\": ask\n    \"src/**/*.ts\": allow\n");
    expect(markdown).toContain("  read: allow\n");

    const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const parsed = yaml.load(frontmatterMatch![1]) as any;
    expect(Object.keys(parsed.permission.bash)).toEqual(["*", "npm test*", "rm -rf *"]);
    expect(Object.keys(parsed.permission.edit)).toEqual(["*", "src/**/*.ts"]);
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
