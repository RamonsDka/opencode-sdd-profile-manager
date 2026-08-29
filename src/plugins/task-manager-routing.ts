export type TaskManagerRoute = { mode: "background" | "foreground"; provenance: string };

export function resolveTaskManagerEnrichmentRoute(capabilities: { isolatedPrompt: boolean }): TaskManagerRoute {
  return capabilities.isolatedPrompt
    ? { mode: "background", provenance: "modo aislado background" }
    : { mode: "foreground", provenance: "modo compatible foreground" };
}

export function shouldEnqueueTaskManagerMilestone(event: string): boolean {
  return event === "sdd-tasks" || event === "sdd-verify" || event === "sdd-archive" || event === "verified-significant";
}

export interface TaskManagerMilestoneHandlerOptions {
  projectDirectory?: string;
  client?: any;
  dispatcher?: typeof import("./task-manager-dispatcher").dispatchTaskManagerSync;
}

/**
 * Handles incoming server milestone events, verifies milestone validity,
 * resolves the canonical project identity and dashboard path, and dispatches
 * the background Task Manager refresh.
 */
export async function handleTaskManagerMilestoneEvent(
  milestone: string,
  sessionID: string,
  options: TaskManagerMilestoneHandlerOptions = {}
): Promise<{ dispatched: boolean; reason?: string }> {
  if (!shouldEnqueueTaskManagerMilestone(milestone)) {
    return { dispatched: false, reason: `unsupported milestone '${milestone}'` };
  }

  const { resolveTaskManagerRoot, buildTaskManagerRootCandidates } = await import("./task-manager-root");
  const { dispatchTaskManagerSync } = await import("./task-manager-dispatcher");
  const path = await import("node:path");

  const cwd = options.projectDirectory ?? process.cwd();
  const candidates = buildTaskManagerRootCandidates(cwd);
  const project = resolveTaskManagerRoot(candidates);
  const dashboardPath = path.join(project.root, "Task-Manager-Portable.html");

  const dispatch = options.dispatcher ?? dispatchTaskManagerSync;

  const result = await dispatch({
    project,
    dashboardPath,
    reason: "milestone",
    milestone,
    client: options.client,
  });

  return { dispatched: result.success, reason: result.reason };
}
