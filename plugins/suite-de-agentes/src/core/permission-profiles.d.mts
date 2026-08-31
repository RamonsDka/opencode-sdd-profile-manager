import type { AgentPermissions } from "./types.ts";

export const TASK_MANAGER_MANAGED_MARKER: string;
export const TASK_MANAGER_RECOMMENDED_PERMISSIONS: AgentPermissions;
export const TASK_MANAGER_PROMPT_PERMISSIONS: AgentPermissions;
export function getAgentPermissionProfile(agentId: string, profile?: string): AgentPermissions | null;
export function isManagedTaskManagerMarkdown(content: string): boolean;
export function formatPermissionsYaml(permissions: AgentPermissions | Record<string, unknown>): string;
export function generateTaskManagerMarkdown(profile?: string, targetPath?: string): string | null;
