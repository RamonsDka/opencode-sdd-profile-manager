import { describe, expect, it } from "vitest";
import {
  buildTaskManagerConsentNotice,
  buildTaskManagerProjectKey,
  canonicalizeTaskManagerPath,
  createTaskManagerConsentStore,
  resolveTaskManagerRoot,
} from "./task-manager-root";
import { canonicalizeTelemetryPath } from "./task-manager-telemetry";
import { canonicalizeWriterKey } from "./task-manager-writer";

describe("Task Manager root and consent", () => {
  it("prefers a canonical Git root over a nested manifest directory without confirmation", () => {
    const identity = resolveTaskManagerRoot({
      cwd: "C:\\\\work\\\\app\\\\packages\\\\web",
      gitRoot: "C:\\\\work\\\\app",
      manifestRoot: "C:\\\\work\\\\app\\\\packages\\\\web",
    });

    expect(identity.root).toBe("C:/work/app");
    expect(identity.canonicalRoot).toBe("C:/work/app");
    expect(identity.confirmed).toBe(true);
  });

  it("canonicalizes cross-platform paths respecting Windows case-insensitivity and POSIX case-sensitivity", () => {
    // Windows semantics: backslashes normalized, forward slashes used, keys lowercased
    const winPath = "C:\\\\Work\\\\App\\\\SubDir\\\\";
    expect(canonicalizeTaskManagerPath(winPath, "win32")).toBe("C:/Work/App/SubDir");
    expect(buildTaskManagerProjectKey(winPath, "win32")).toBe("c:/work/app/subdir");
    expect(canonicalizeTelemetryPath(winPath, "win32")).toBe("c:/work/app/subdir");
    expect(canonicalizeWriterKey(winPath, "win32")).toBe("c:/work/app/subdir");

    // POSIX semantics: case is strictly preserved in keys and paths
    const posixPath = "/home/User/Projects/App/SubDir/";
    expect(canonicalizeTaskManagerPath(posixPath, "linux")).toBe("/home/User/Projects/App/SubDir");
    expect(buildTaskManagerProjectKey(posixPath, "linux")).toBe("/home/User/Projects/App/SubDir");
    expect(canonicalizeTelemetryPath(posixPath, "linux")).toBe("/home/User/Projects/App/SubDir");
    expect(canonicalizeWriterKey(posixPath, "linux")).toBe("/home/User/Projects/App/SubDir");

    const posixCaseA = "/var/log/App";
    const posixCaseB = "/var/log/app";
    expect(buildTaskManagerProjectKey(posixCaseA, "linux")).not.toBe(buildTaskManagerProjectKey(posixCaseB, "linux"));
  });

  it("requires explicit confirmation for an unmarked directory and keys consent by canonical identity", async () => {
    const identity = resolveTaskManagerRoot({ cwd: "C:\\\\work\\\\scratch\\\\..\\\\scratch" });
    const consent = createTaskManagerConsentStore();

    expect(identity.confirmed).toBe(false);
    expect(buildTaskManagerConsentNotice(identity)).toContain("C:/work/scratch");
    expect(buildTaskManagerConsentNotice(identity)).toContain("actualización asíncrona");
    expect(await consent.get(identity)).toBeUndefined();

    await consent.accept({ ...identity, confirmed: true });

    expect(await consent.get({ ...identity, root: "C:/work/scratch/", canonicalRoot: "C:/work/scratch", confirmed: true })).toEqual({ consent: true, enabled: true });
  });

  it("discloses consent, background enrichment, and the browser path before activation", () => {
    const identity = resolveTaskManagerRoot({ cwd: "C:\\\\work\\\\scratch" });

    expect(buildTaskManagerConsentNotice(identity)).toContain("consentimiento");
    expect(buildTaskManagerConsentNotice(identity)).toContain("actualización asíncrona");
    expect(buildTaskManagerConsentNotice(identity)).toContain("navegador");
  });
});
