import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";
import {
  buildArchiveFilesList,
  generateReleasePackage,
  validatePackageHygiene,
} from "../scripts/package.mjs";
import {
  checkPrerequisites,
  formatPermissionsYaml,
  generateTaskManagerMarkdown,
  getAgentPermissionProfile,
  installPlugin,
  isManagedTaskManagerMarkdown,
  parseArgs,
  promptPermissionsInteractive,
  promptReplaceAgentConfigInteractive,
  readJsonSafe,
  TASK_MANAGER_MANAGED_MARKER,
  TASK_MANAGER_PROMPT_PERMISSIONS,
  TASK_MANAGER_RECOMMENDED_PERMISSIONS,
  uninstallPlugin,
} from "../scripts/installer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

interface ArchiveFileEntry {
  relativePath: string;
  fullPath: string;
  mode: number;
  size: number;
}

describe("packaging and release distribution", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: projectRoot, shell: true, stdio: "pipe" });
  });

  it("builds a deterministic file list containing only release assets without root leakage", () => {
    const files = buildArchiveFilesList(projectRoot) as ArchiveFileEntry[];
    const relPaths = files.map((f: ArchiveFileEntry) => f.relativePath);

    expect(relPaths).toContain("dist/server.js");
    expect(relPaths).toContain("dist/tui.js");
    expect(relPaths).toContain("dist/core/index.js");
    expect(relPaths).toContain("scripts/installer.mjs");
    expect(relPaths).toContain("install.ps1");
    expect(relPaths).toContain("install.sh");
    expect(relPaths).toContain("package.json");
    expect(relPaths).toContain("package-lock.json");
    expect(relPaths).toContain("manifest.json");
    expect(relPaths).toContain("README.md");
    expect(relPaths).toContain("LICENSE");

    // Must not include development source trees or temporary directories
    expect(relPaths.some((p: string) => p.startsWith("src/"))).toBe(false);
    expect(relPaths.some((p: string) => p.startsWith("test/"))).toBe(false);
    expect(relPaths.some((p: string) => p.startsWith(".git"))).toBe(false);
    expect(relPaths.some((p: string) => p.startsWith("node_modules/"))).toBe(false);

    // List must be strictly sorted
    const sorted = [...relPaths].sort((a: string, b: string) => a.localeCompare(b));
    expect(relPaths).toEqual(sorted);
  });

  it("passes package hygiene validation with zero personal paths or tokens", () => {
    const files = buildArchiveFilesList(projectRoot) as ArchiveFileEntry[];
    expect(() => validatePackageHygiene(files)).not.toThrow();
  });

  it("generates valid .zip, .tar.gz, and SHA256SUMS.txt with matching checksums", () => {
    const tempReleaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suite-release-test-"));
    try {
      const result = generateReleasePackage(projectRoot, tempReleaseDir);

      expect(result.version).toBe("1.1.0");
      expect(result.filesCount).toBeGreaterThanOrEqual(10);
      expect(fs.existsSync(result.zip.path)).toBe(true);
      expect(fs.existsSync(result.tarGz.path)).toBe(true);
      expect(fs.existsSync(result.checksums.path)).toBe(true);

      expect(result.zip.size).toBeGreaterThan(1000);
      expect(result.tarGz.size).toBeGreaterThan(1000);

      // Verify SHA256 content
      const sumsContent = fs.readFileSync(result.checksums.path, "utf8");
      const lines = sumsContent.trim().split("\n");
      expect(lines).toHaveLength(2);

      const zipActualHash = crypto.createHash("sha256").update(fs.readFileSync(result.zip.path)).digest("hex");
      const tarGzActualHash = crypto.createHash("sha256").update(fs.readFileSync(result.tarGz.path)).digest("hex");

      expect(lines[0]).toBe(`${zipActualHash}  ${result.zip.name}`);
      expect(lines[1]).toBe(`${tarGzActualHash}  ${result.tarGz.name}`);
    } finally {
      fs.rmSync(tempReleaseDir, { recursive: true, force: true });
    }
  });

  it("manifest.json defines exactly the 7 canonical built-ins without personal agent seeds", () => {
    const manifestPath = path.join(projectRoot, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    expect(manifest.version).toBe("1.1.0");
    expect(manifest.builtInAgents).toEqual([
      "build",
      "compaction",
      "explore",
      "general",
      "plan",
      "summary",
      "title",
    ]);
    expect(manifest.builtInAgents).not.toContain("agent-github");
    expect(manifest.builtInAgents).not.toContain("agent-notebooklm");
  });
});

describe("portable installer", () => {
  it("parses CLI arguments correctly including --agent-permissions, --replace-agent-config, and flags", () => {
    const args = parseArgs([
      "--dry-run",
      "--target-dir",
      "/custom/plugins/suite",
      "--config-dir=/custom/config",
      "--agent-permissions",
      "recommended",
      "--replace-agent-config",
      "--uninstall",
    ]);
    expect(args.dryRun).toBe(true);
    expect(args.uninstall).toBe(true);
    expect(args.replaceAgentConfig).toBe(true);
    expect(args.targetDir).toBe("/custom/plugins/suite");
    expect(args.configDir).toBe("/custom/config");
    expect(args.agentPermissions).toBe("recommended");

    const shortArgs = parseArgs(["-r", "-p", "prompt", "-d", "-u"]);
    expect(shortArgs.replaceAgentConfig).toBe(true);
    expect(shortArgs.agentPermissions).toBe("prompt");
    expect(shortArgs.dryRun).toBe(true);
    expect(shortArgs.uninstall).toBe(true);

    expect(() => parseArgs(["--agent-permissions", "unlimited"])).toThrow(/Invalid --agent-permissions/i);
    expect(() => parseArgs(["--agent-permissions=invalid-profile"])).toThrow(/Invalid --agent-permissions/i);
  });

  it("provides centralized, immutable permission profiles and markers for task manager", () => {
    expect(TASK_MANAGER_RECOMMENDED_PERMISSIONS).toEqual({
      read: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      skill: "allow",
      task: "deny",
      todowrite: "allow",
      question: "allow",
      external_directory: "ask",
      bash: {
        "*": "ask",
        "git status*": "allow",
        "git branch --show-current*": "allow",
        "git log*": "allow",
        "git rev-parse*": "allow",
      },
      edit: {
        "*": "ask",
        "*Task-Manager-Portable.html*": "allow",
        "*drop-in-task-manager.html*": "allow",
      },
    });

    expect(TASK_MANAGER_PROMPT_PERMISSIONS).toEqual({
      read: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      skill: "allow",
      task: "deny",
      todowrite: "allow",
      question: "allow",
      edit: "ask",
      bash: "ask",
      external_directory: "ask",
    });

    expect(getAgentPermissionProfile("agent-task-manager", "recommended")).toEqual(TASK_MANAGER_RECOMMENDED_PERMISSIONS);
    expect(getAgentPermissionProfile("agent-task-manager", "prompt")).toEqual(TASK_MANAGER_PROMPT_PERMISSIONS);
    expect(getAgentPermissionProfile("agent-task-manager", "none")).toBeNull();
    expect(getAgentPermissionProfile("unknown-agent", "recommended")).toBeNull();

    expect(TASK_MANAGER_MANAGED_MARKER).toBe("<!-- opencode-agent-suite:managed:agent-task-manager:v1 -->");
    expect(isManagedTaskManagerMarkdown(`---\nname: agent-task-manager\n---\n${TASK_MANAGER_MANAGED_MARKER}\nInstructions`)).toBe(true);
    expect(isManagedTaskManagerMarkdown("---\nname: agent-task-manager\n---\nUser custom instructions.")).toBe(false);
  });

  it("handles interactive TTY permission selection prompt", async () => {
    const mockRl1: any = {
      question: (_prompt: string, cb: (ans: string) => void) => cb("1"),
    };
    await expect(promptPermissionsInteractive(mockRl1)).resolves.toBe("recommended");

    const mockRl2: any = {
      question: (_prompt: string, cb: (ans: string) => void) => cb("prompt"),
    };
    await expect(promptPermissionsInteractive(mockRl2)).resolves.toBe("prompt");

    const mockRl3: any = {
      question: (_prompt: string, cb: (ans: string) => void) => cb("3"),
    };
    await expect(promptPermissionsInteractive(mockRl3)).resolves.toBe("none");

    const mockRlEmpty: any = {
      question: (_prompt: string, cb: (ans: string) => void) => cb(""),
    };
    await expect(promptPermissionsInteractive(mockRlEmpty)).resolves.toBe("recommended");
  });

  it("handles interactive replace agent config prompt", async () => {
    const mockRlYes: any = {
      question: (_prompt: string, cb: (ans: string) => void) => cb("y"),
    };
    await expect(promptReplaceAgentConfigInteractive("agent-task-manager.md", mockRlYes)).resolves.toBe(true);

    const mockRlNo: any = {
      question: (_prompt: string, cb: (ans: string) => void) => cb("n"),
    };
    await expect(promptReplaceAgentConfigInteractive("agent-task-manager.md", mockRlNo)).resolves.toBe(false);
  });

  it("checks Node and npm prerequisites", () => {
    const prereqs = checkPrerequisites();
    expect(prereqs.nodeVersion).toBeDefined();
    expect(prereqs.npmOk).toBe(true);
  });

  it("performs dry run reporting planned create/update/conflict actions without mutating filesystem", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suite-dryrun-"));
    const configDir = path.join(tempDir, "config");
    const targetDir = path.join(tempDir, "target");

    try {
      // 1. Dry run on fresh directory -> create
      const resCreate = installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: true,
        skipNpm: true,
        agentPermissions: "recommended",
      }) as any;

      expect(resCreate.dryRun).toBe(true);
      expect(resCreate.status).toBe("dry-run");
      expect(resCreate.planned.agentAction).toBe("create");
      expect(resCreate.agentReceipt.action).toBe("create");
      expect(resCreate.planned.materializedAgents).toContain(path.join(configDir, "agent", "agent-task-manager.md"));
      expect(fs.existsSync(configDir)).toBe(false);
      expect(fs.existsSync(targetDir)).toBe(false);

      // 2. Setup unmanaged custom file on disk and dry run without replace -> conflict
      const agentDir = path.join(configDir, "agent");
      fs.mkdirSync(agentDir, { recursive: true });
      const agentFile = path.join(agentDir, "agent-task-manager.md");
      fs.writeFileSync(agentFile, "---\nname: agent-task-manager\n---\nCustom unmanaged prompt.", "utf8");

      const resConflict = installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: true,
        skipNpm: true,
        agentPermissions: "recommended",
        replaceAgentConfig: false,
      }) as any;

      expect(resConflict.agentReceipt.action).toBe("conflict");
      expect(resConflict.agentReceipt.reason).toBe("unmanaged_custom_agent_exists");
      expect(resConflict.planned.materializedAgents).toHaveLength(0);

      // 3. Dry run with --replace-agent-config -> update
      const resReplace = installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: true,
        skipNpm: true,
        agentPermissions: "recommended",
        replaceAgentConfig: true,
      }) as any;

      expect(resReplace.agentReceipt.action).toBe("update");
      expect(resReplace.planned.materializedAgents).toHaveLength(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("installs with default agentPermissions=none without creating agent files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suite-none-"));
    const configDir = path.join(tempDir, "config");
    const targetDir = path.join(tempDir, "target");

    try {
      const res = installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: false,
        skipNpm: true,
        agentPermissions: "none",
      });

      expect(res.status).toBe("installed");
      expect(res.materializedAgents).toHaveLength(0);
      expect(res.agentReceipt.action).toBe("skipped");
      expect(fs.existsSync(path.join(configDir, "agent", "agent-task-manager.md"))).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("installs with agentPermissions=recommended: creates agent-task-manager.md with marker, exact YAML ordering, and valid schema", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suite-recommended-"));
    const configDir = path.join(tempDir, "config");
    const targetDir = path.join(tempDir, "target");

    try {
      const res = installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: false,
        skipNpm: true,
        agentPermissions: "recommended",
      });

      expect(res.status).toBe("installed");
      expect(res.agentPermissions).toBe("recommended");
      expect(res.agentReceipt.action).toBe("created");
      expect(res.agentReceipt.managed).toBe(true);

      const agentFile = path.join(configDir, "agent", "agent-task-manager.md");
      expect(fs.existsSync(agentFile)).toBe(true);

      const content = fs.readFileSync(agentFile, "utf8");
      expect(content).toContain(TASK_MANAGER_MANAGED_MARKER);
      expect(content).toContain("name: agent-task-manager");
      expect(content).toContain("mode: all");
      expect(content).not.toContain("[object Object]");

      // Validate YAML structure using js-yaml parser
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      expect(match).not.toBeNull();
      const parsed = yaml.load(match![1]) as any;

      expect(parsed.name).toBe("agent-task-manager");
      expect(parsed.permission.read).toBe("allow");
      expect(parsed.permission.task).toBe("deny");

      // Verify '*' is first in bash and edit maps
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
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles conflict on unmanaged custom agent and requires --replace-agent-config to overwrite", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suite-conflict-"));
    const configDir = path.join(tempDir, "config");
    const targetDir = path.join(tempDir, "target");

    const agentDir = path.join(configDir, "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    const customAgentFile = path.join(agentDir, "agent-task-manager.md");
    const customContent = "---\nname: agent-task-manager\n---\nCustom unmanaged user instructions.";
    fs.writeFileSync(customAgentFile, customContent, "utf8");

    try {
      // 1. Without --replace-agent-config: must NOT overwrite, must return conflict
      const resConflict = installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: false,
        skipNpm: true,
        agentPermissions: "recommended",
        replaceAgentConfig: false,
      });

      expect(resConflict.status).toBe("conflict");
      expect(resConflict.agentReceipt.action).toBe("conflict");
      expect(resConflict.agentReceipt.reason).toBe("unmanaged_custom_agent_exists");
      expect(fs.readFileSync(customAgentFile, "utf8")).toBe(customContent);

      // 2. With --replace-agent-config: overwrites and creates custom backup
      const resReplace = installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: false,
        skipNpm: true,
        agentPermissions: "recommended",
        replaceAgentConfig: true,
      });

      expect(resReplace.status).toBe("installed");
      expect(resReplace.agentReceipt.action).toBe("updated");
      expect(fs.existsSync(path.join(agentDir, "agent-task-manager.md.custom.bak"))).toBe(true);
      expect(fs.readFileSync(path.join(agentDir, "agent-task-manager.md.custom.bak"), "utf8")).toBe(customContent);

      const overwrittenContent = fs.readFileSync(customAgentFile, "utf8");
      expect(overwrittenContent).toContain(TASK_MANAGER_MANAGED_MARKER);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("is strictly idempotent: same profile generates zero duplicate backups or disk writes", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suite-idempotent-"));
    const configDir = path.join(tempDir, "config");
    const targetDir = path.join(tempDir, "target");

    try {
      const res1 = installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: false,
        skipNpm: true,
        agentPermissions: "recommended",
      });
      expect(res1.agentReceipt.action).toBe("created");

      const agentDir = path.join(configDir, "agent");
      const initialBaks = fs.readdirSync(agentDir).filter((f) => f.includes(".bak"));
      expect(initialBaks).toHaveLength(0);

      // 2nd run with same options
      const res2 = installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: false,
        skipNpm: true,
        agentPermissions: "recommended",
      });
      expect(res2.agentReceipt.action).toBe("unchanged");

      const secondBaks = fs.readdirSync(agentDir).filter((f) => f.includes(".bak"));
      expect(secondBaks).toHaveLength(0);

      // 3rd run
      const res3 = installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: false,
        skipNpm: true,
        agentPermissions: "recommended",
      });
      expect(res3.agentReceipt.action).toBe("unchanged");

      const thirdBaks = fs.readdirSync(agentDir).filter((f) => f.includes(".bak"));
      expect(thirdBaks).toHaveLength(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("updates managed agent profile with backup when changing profile from recommended to prompt", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suite-profile-update-"));
    const configDir = path.join(tempDir, "config");
    const targetDir = path.join(tempDir, "target");

    try {
      installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: false,
        skipNpm: true,
        agentPermissions: "recommended",
      });

      const resUpdate = installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: false,
        skipNpm: true,
        agentPermissions: "prompt",
      });

      expect(resUpdate.agentReceipt.action).toBe("updated");
      expect(resUpdate.agentPermissions).toBe("prompt");

      const agentFile = path.join(configDir, "agent", "agent-task-manager.md");
      const content = fs.readFileSync(agentFile, "utf8");
      expect(content).toContain("bash: ask");
      expect(content).toContain("edit: ask");

      // Verify backup was created on profile change
      const baks = fs.readdirSync(path.join(configDir, "agent")).filter((f) => f.startsWith("agent-task-manager.md.bak"));
      expect(baks.length).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uninstalls safely: removes managed agent, preserves foreign agent, and restores replaced custom agent", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suite-uninstall-safe-"));
    const configDir = path.join(tempDir, "config");
    const targetDir = path.join(tempDir, "target");

    try {
      // Scenario A: Standard managed install -> uninstall removes it
      installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: false,
        skipNpm: true,
        agentPermissions: "recommended",
      });

      const resUninstallManaged = uninstallPlugin({
        configDir,
        targetDir,
        dryRun: false,
      });

      expect(resUninstallManaged.status).toBe("uninstalled");
      expect(resUninstallManaged.removedAgents).toContain(path.join(configDir, "agent", "agent-task-manager.md"));
      expect(fs.existsSync(path.join(configDir, "agent", "agent-task-manager.md"))).toBe(false);

      // Scenario B: Foreign custom agent exists -> uninstall PRESERVES it
      const foreignCustomContent = "---\nname: agent-task-manager\n---\nMy completely custom agent.";
      const agentFile = path.join(configDir, "agent", "agent-task-manager.md");
      fs.writeFileSync(agentFile, foreignCustomContent, "utf8");

      const resUninstallForeign = uninstallPlugin({
        configDir,
        targetDir,
        dryRun: false,
      });

      expect(resUninstallForeign.preservedAgents).toContain(agentFile);
      expect(resUninstallForeign.removedAgents).toHaveLength(0);
      expect(fs.existsSync(agentFile)).toBe(true);
      expect(fs.readFileSync(agentFile, "utf8")).toBe(foreignCustomContent);

      // Scenario C: Custom agent replaced with --replace-agent-config -> uninstall RESTORES it
      installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: false,
        skipNpm: true,
        agentPermissions: "recommended",
        replaceAgentConfig: true,
      });

      expect(fs.readFileSync(agentFile, "utf8")).toContain(TASK_MANAGER_MANAGED_MARKER);

      const resUninstallRestore = uninstallPlugin({
        configDir,
        targetDir,
        dryRun: false,
      });

      expect(resUninstallRestore.restoredAgents).toContain(agentFile);
      expect(fs.existsSync(agentFile)).toBe(true);
      expect(fs.readFileSync(agentFile, "utf8")).toBe(foreignCustomContent);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles Windows-like and POSIX paths correctly without path traversal", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suite-paths-"));
    const configDir = path.join(tempDir, "custom-cfg");
    const targetDir = path.join(tempDir, "custom-tgt");

    try {
      const res = installPlugin({
        sourceDir: projectRoot,
        configDir,
        targetDir,
        dryRun: false,
        skipNpm: true,
        agentPermissions: "recommended",
      });

      expect(res.serverPluginPath).toContain("/dist/server.js");
      expect(res.tuiPluginPath).toContain("/dist/tui.js");
      expect(res.serverPluginPath).not.toContain("\\");
      expect(res.tuiPluginPath).not.toContain("\\");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("validates bash install.sh and PowerShell install.ps1 wrapper syntax", () => {
    const shPath = path.join(projectRoot, "install.sh");
    expect(fs.existsSync(shPath)).toBe(true);
    const shContent = fs.readFileSync(shPath, "utf8");
    expect(shContent.startsWith("#!/usr/bin/env sh")).toBe(true);
    expect(shContent).toContain("INSTALLER_SCRIPT");
    expect(shContent).toContain("--replace-agent-config");

    const ps1Path = path.join(projectRoot, "install.ps1");
    expect(fs.existsSync(ps1Path)).toBe(true);
    const ps1Content = fs.readFileSync(ps1Path, "utf8");
    expect(ps1Content).toContain("[switch]$ReplaceAgentConfig");
    expect(ps1Content).toContain("--replace-agent-config");
  });

  it("smokes dynamic import of compiled dist entries in clean environment", async () => {
    const serverUrl = pathToFileURL(path.join(projectRoot, "dist", "server.js")).href;
    const coreUrl = pathToFileURL(path.join(projectRoot, "dist", "core", "index.js")).href;

    const distServer = await import(serverUrl);
    const distCore = await import(coreUrl);

    expect(distServer.default).toMatchObject({ id: "agent-suite" });
    expect(distCore.CANONICAL_BUILT_IN_AGENTS).toHaveLength(7);
    expect(distCore.CANONICAL_BUILT_IN_AGENT_IDS).toEqual([
      "general",
      "build",
      "plan",
      "explore",
      "compaction",
      "title",
      "summary",
    ]);
  });

  it("executes the installer from a staged release package without src directory or MODULE_NOT_FOUND errors", () => {
    const tempStagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-suite-staged-pkg-"));
    const stagedPkgDir = path.join(tempStagingRoot, "package");
    const tempConfigDir = path.join(tempStagingRoot, "config");
    const tempTargetDir = path.join(tempStagingRoot, "target");

    try {
      const files = buildArchiveFilesList(projectRoot) as ArchiveFileEntry[];
      for (const file of files) {
        const dest = path.join(stagedPkgDir, file.relativePath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(file.fullPath, dest);
      }

      expect(fs.existsSync(path.join(stagedPkgDir, "src"))).toBe(false);
      expect(fs.existsSync(path.join(stagedPkgDir, "test"))).toBe(false);
      expect(fs.existsSync(path.join(stagedPkgDir, "dist", "core", "index.js"))).toBe(true);
      expect(fs.existsSync(path.join(stagedPkgDir, "scripts", "installer.mjs"))).toBe(true);

      const helpOutput = execFileSync(
        process.execPath,
        ["scripts/installer.mjs", "--help"],
        {
          cwd: stagedPkgDir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      expect(helpOutput).toContain("Usage: node scripts/installer.mjs");
      expect(helpOutput).toContain("--agent-permissions");

      const dryRunOutput = execFileSync(
        process.execPath,
        [
          "scripts/installer.mjs",
          "--dry-run",
          "--agent-permissions",
          "recommended",
          "--config-dir",
          tempConfigDir,
          "--target-dir",
          tempTargetDir,
          "--source-dir",
          stagedPkgDir,
        ],
        {
          cwd: stagedPkgDir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      expect(dryRunOutput).toMatch(/\[dry-run\]/i);

      const installOutput = execFileSync(
        process.execPath,
        [
          "scripts/installer.mjs",
          "--agent-permissions",
          "recommended",
          "--replace-agent-config",
          "--config-dir",
          tempConfigDir,
          "--target-dir",
          tempTargetDir,
          "--source-dir",
          stagedPkgDir,
          "--skip-npm",
        ],
        {
          cwd: stagedPkgDir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      expect(installOutput).toContain("Installed plugin files to");
      expect(installOutput).toContain("Suite de Agentes is ready!");
      const agentFile = path.join(tempConfigDir, "agent", "agent-task-manager.md");
      expect(fs.existsSync(agentFile)).toBe(true);
      expect(fs.readFileSync(agentFile, "utf8")).toContain(TASK_MANAGER_MANAGED_MARKER);
    } finally {
      fs.rmSync(tempStagingRoot, { recursive: true, force: true });
    }
  });
});
