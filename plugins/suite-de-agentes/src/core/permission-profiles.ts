import type { AgentPermissions } from "./types.ts";
import { TASK_MANAGER_AGENT_ID } from "./built-in-agents.ts";
import {
  TASK_MANAGER_MANAGED_MARKER,
  TASK_MANAGER_PROMPT_PERMISSIONS as RAW_PROMPT_PERMISSIONS,
  TASK_MANAGER_RECOMMENDED_PERMISSIONS as RAW_RECOMMENDED_PERMISSIONS,
  formatPermissionsYaml,
  generateTaskManagerMarkdown,
  getAgentPermissionProfile as rawGetAgentPermissionProfile,
  isManagedTaskManagerMarkdown,
} from "./permission-profiles.mjs";

export type AgentPermissionProfile = "recommended" | "prompt" | "none";

export const TASK_MANAGER_RECOMMENDED_PERMISSIONS: AgentPermissions = RAW_RECOMMENDED_PERMISSIONS as AgentPermissions;
export const TASK_MANAGER_PROMPT_PERMISSIONS: AgentPermissions = RAW_PROMPT_PERMISSIONS as AgentPermissions;

export {
  TASK_MANAGER_MANAGED_MARKER,
  formatPermissionsYaml,
  generateTaskManagerMarkdown,
  isManagedTaskManagerMarkdown,
};

export function getAgentPermissionProfile(
  agentId: string,
  profile: AgentPermissionProfile | string,
): AgentPermissions | null {
  if (profile === "none") return null;
  const res = rawGetAgentPermissionProfile(agentId, profile);
  return res ? (res as AgentPermissions) : null;
}
