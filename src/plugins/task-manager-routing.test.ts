import { describe, expect, it, vi } from "vitest";
import {
  handleTaskManagerMilestoneEvent,
  resolveTaskManagerEnrichmentRoute,
  shouldEnqueueTaskManagerMilestone,
} from "./task-manager-routing";

describe("Task Manager background routing and milestones", () => {
  it("uses isolated background work when the host exposes it", () => {
    expect(resolveTaskManagerEnrichmentRoute({ isolatedPrompt: true })).toEqual({ mode: "background", provenance: "modo aislado background" });
    expect(shouldEnqueueTaskManagerMilestone("sdd-verify")).toBe(true);
    expect(shouldEnqueueTaskManagerMilestone("chat-message")).toBe(false);
  });

  it("keeps the foreground compatibility fallback visible and only accepts SDD milestones", () => {
    expect(resolveTaskManagerEnrichmentRoute({ isolatedPrompt: false })).toEqual({ mode: "foreground", provenance: "modo compatible foreground" });
    expect(["sdd-tasks", "sdd-verify", "sdd-archive"].every(shouldEnqueueTaskManagerMilestone)).toBe(true);
    expect(shouldEnqueueTaskManagerMilestone("significant")).toBe(false);
  });

  it("queues the bounded post-verification sync for significant non-SDD work", () => {
    expect(shouldEnqueueTaskManagerMilestone("verified-significant")).toBe(true);
    expect(shouldEnqueueTaskManagerMilestone("file-change")).toBe(false);
  });

  describe("handleTaskManagerMilestoneEvent", () => {
    it("ignores unsupported milestone events", async () => {
      const dispatcherMock = vi.fn();
      const result = await handleTaskManagerMilestoneEvent("unsupported-event", "sess-1", {
        dispatcher: dispatcherMock,
      });

      expect(result.dispatched).toBe(false);
      expect(result.reason).toContain("unsupported milestone");
      expect(dispatcherMock).not.toHaveBeenCalled();
    });

    it("dispatches supported milestones to the dispatcher with project identity", async () => {
      const dispatcherMock = vi.fn().mockResolvedValue({ success: true });
      const result = await handleTaskManagerMilestoneEvent("sdd-verify", "sess-1", {
        projectDirectory: "C:/work/app",
        dispatcher: dispatcherMock,
      });

      expect(result.dispatched).toBe(true);
      expect(dispatcherMock).toHaveBeenCalledTimes(1);
      const callArgs = dispatcherMock.mock.calls[0][0];
      expect(callArgs.reason).toBe("milestone");
      expect(callArgs.milestone).toBe("sdd-verify");
      expect(callArgs.project.canonicalRoot).toBeDefined();
      expect(callArgs.dashboardPath).toContain("Task-Manager-Portable.html");
    });
  });
});
