import type { AgentPermissions, CustomAgent } from "./types.ts";
import { validateAgentId, validateAgentMode, validateVariantId } from "./config.ts";
import { formatPermissionsYaml } from "./permission-profiles.mjs";

export { formatPermissionsYaml };

export function generateAgentMarkdown(agent: CustomAgent): string {
  validateAgentId(agent.id);
  if (!agent.model.includes("/") || !agent.prompt.trim()) throw new Error("Custom agent requires model and prompt");
  const mode = agent.mode === undefined ? "" : `mode: ${validateAgentMode(agent.mode)}\n`;
  const variant = agent.variant === undefined ? "" : `variant: ${validateVariantId(agent.variant)}\n`;
  const permission: AgentPermissions = {
    ...agent.permissions,
    ...(agent.skills.length ? { skill: agent.permissions.skill ?? "allow" } : {}),
  };
  const permissionYaml = formatPermissionsYaml(permission);
  const skillInstruction = agent.skills.length ? `\n\nUse the associated skills: ${agent.skills.join(", ")}. Follow their instructions explicitly.` : "";
  return `---\nname: ${agent.id}\ndescription: ${JSON.stringify(agent.description)}\n${mode}model: ${agent.model}\n${variant}permission:\n${permissionYaml}\n---\n\n${agent.prompt.trim()}${skillInstruction}\n`;
}
