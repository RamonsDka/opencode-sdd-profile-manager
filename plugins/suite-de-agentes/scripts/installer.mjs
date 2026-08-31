import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const coreModule = await (async () => {
  const distUrl = new URL("../dist/core/index.js", import.meta.url);
  if (fs.existsSync(distUrl)) {
    return import(distUrl.href);
  }
  const srcUrl = new URL("../src/core/permission-profiles.mjs", import.meta.url);
  if (fs.existsSync(srcUrl)) {
    return import(srcUrl.href);
  }
  return import(distUrl.href);
})();

const {
  TASK_MANAGER_MANAGED_MARKER,
  TASK_MANAGER_PROMPT_PERMISSIONS,
  TASK_MANAGER_RECOMMENDED_PERMISSIONS,
  formatPermissionsYaml,
  generateTaskManagerMarkdown,
  getAgentPermissionProfile,
  isManagedTaskManagerMarkdown,
} = coreModule;

export {
  TASK_MANAGER_MANAGED_MARKER,
  TASK_MANAGER_PROMPT_PERMISSIONS,
  TASK_MANAGER_RECOMMENDED_PERMISSIONS,
  formatPermissionsYaml,
  generateTaskManagerMarkdown,
  getAgentPermissionProfile,
  isManagedTaskManagerMarkdown,
};

export function getDefaultHome() {
  return process.env.HOME || process.env.USERPROFILE || ".";
}

export function getDefaultConfigDir(home = getDefaultHome()) {
  return path.join(home, ".config", "opencode");
}

export function getDefaultTargetDir(configDir = getDefaultConfigDir()) {
  return path.join(configDir, "plugins", "suite-de-agentes");
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    dryRun: false,
    uninstall: false,
    help: false,
    skipNpm: false,
    replaceAgentConfig: false,
    targetDir: "",
    configDir: "",
    sourceDir: "",
    agentPermissions: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "-d") {
      options.dryRun = true;
    } else if (arg === "--uninstall" || arg === "-u") {
      options.uninstall = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--skip-npm") {
      options.skipNpm = true;
    } else if (arg === "--replace-agent-config" || arg === "-r") {
      options.replaceAgentConfig = true;
    } else if (arg === "--target-dir") {
      options.targetDir = argv[++i] ?? "";
    } else if (arg.startsWith("--target-dir=")) {
      options.targetDir = arg.slice("--target-dir=".length);
    } else if (arg === "--config-dir") {
      options.configDir = argv[++i] ?? "";
    } else if (arg.startsWith("--config-dir=")) {
      options.configDir = arg.slice("--config-dir=".length);
    } else if (arg === "--source-dir") {
      options.sourceDir = argv[++i] ?? "";
    } else if (arg.startsWith("--source-dir=")) {
      options.sourceDir = arg.slice("--source-dir=".length);
    } else if (arg === "--agent-permissions" || arg === "-p") {
      options.agentPermissions = argv[++i] ?? "";
    } else if (arg.startsWith("--agent-permissions=")) {
      options.agentPermissions = arg.slice("--agent-permissions=".length);
    }
  }

  if (options.agentPermissions && !["recommended", "prompt", "none"].includes(options.agentPermissions)) {
    throw new Error(`Invalid --agent-permissions value '${options.agentPermissions}'. Allowed values: recommended, prompt, none.`);
  }

  return options;
}

export function checkPrerequisites() {
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (isNaN(major) || major < 22) {
    throw new Error(`Node.js version >= 22 required (found ${nodeVersion}). Please update Node.js.`);
  }

  let npmOk = false;
  try {
    const npmVersion = execFileSync("npm", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: true,
    }).trim();
    if (npmVersion) npmOk = true;
  } catch {
    npmOk = false;
  }

  return { nodeVersion, npmOk };
}

export function readJsonSafe(filePath, defaultContent = {}) {
  if (!fs.existsSync(filePath)) return defaultContent;
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return defaultContent;
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON configuration file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeJsonSafe(filePath, data, dryRun = false) {
  const formatted = JSON.stringify(data, null, 2) + "\n";
  if (dryRun) return;

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Idempotency check: avoid rewrites and duplicate backups if content is unchanged
  if (fs.existsSync(filePath)) {
    try {
      const existing = fs.readFileSync(filePath, "utf8");
      if (existing === formatted) {
        return;
      }
    } catch {
      // If reading fails, proceed to backup and write
    }

    const timestamp = Date.now();
    const backupPath = `${filePath}.bak-${timestamp}`;
    const primaryBak = `${filePath}.bak`;
    fs.copyFileSync(filePath, backupPath);
    if (!fs.existsSync(primaryBak)) {
      fs.copyFileSync(filePath, primaryBak);
    }
  }

  // Write atomically
  const tempPath = `${filePath}.tmp-${Date.now()}`;
  fs.writeFileSync(tempPath, formatted, "utf8");
  fs.renameSync(tempPath, filePath);
}

export function writeFileSafe(filePath, content, dryRun = false, isReplacingCustom = false) {
  if (dryRun) return;

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Idempotency check: avoid rewrites and duplicate backups if content is unchanged
  if (fs.existsSync(filePath)) {
    try {
      const existing = fs.readFileSync(filePath, "utf8");
      if (existing === content) {
        return;
      }
    } catch {
      // If reading fails, proceed to backup and write
    }

    const timestamp = Date.now();
    const backupPath = `${filePath}.bak-${timestamp}`;
    const primaryBak = `${filePath}.bak`;
    const customBak = `${filePath}.custom.bak`;
    fs.copyFileSync(filePath, backupPath);
    if (!fs.existsSync(primaryBak)) {
      fs.copyFileSync(filePath, primaryBak);
    }
    if (isReplacingCustom && !fs.existsSync(customBak)) {
      fs.copyFileSync(filePath, customBak);
    }
  }

  // Write atomically
  const tempPath = `${filePath}.tmp-${Date.now()}`;
  fs.writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function copyDirectoryRecursive(source, target, dryRun = false) {
  if (!fs.existsSync(source)) return;
  if (!dryRun && !fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const dstPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, dstPath, dryRun);
    } else if (entry.isFile()) {
      if (!dryRun) {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }
}

export async function promptPermissionsInteractive(rlInterface = null) {
  if (rlInterface) {
    return new Promise((resolve) => {
      rlInterface.question("Select agent permissions profile [1=recommended, 2=prompt, 3=none] (default: 1): ", (ans) => {
        const trimmed = (ans || "").trim().toLowerCase();
        if (!trimmed || trimmed === "1" || trimmed === "recommended") resolve("recommended");
        else if (trimmed === "2" || trimmed === "prompt") resolve("prompt");
        else if (trimmed === "3" || trimmed === "none") resolve("none");
        else resolve("recommended");
      });
    });
  }

  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n--- OpenCode Agent Permissions Configuration ---");
  console.log("Suite de Agentes includes specialized background agents (e.g., 'agent-task-manager').");
  console.log("You can grant scoped functional permissions now to avoid subsequent prompts/denials:\n");
  console.log("  1) recommended (Default) — Grant scoped background sync (git read-only bash, edit restricted to Task Manager dashboards, full read/skills, no task delegations).");
  console.log("  2) prompt               — Require interactive user confirmation for every edit/bash execution.");
  console.log("  3) none                 — Do not configure or materialize agent permissions during installation.\n");

  return new Promise((resolve) => {
    rl.question("Select option [1-3] (default: 1): ", (answer) => {
      rl.close();
      const val = answer.trim().toLowerCase();
      if (!val || val === "1" || val === "recommended") {
        resolve("recommended");
      } else if (val === "2" || val === "prompt") {
        resolve("prompt");
      } else if (val === "3" || val === "none") {
        resolve("none");
      } else {
        console.log("Unrecognized choice, using default: recommended");
        resolve("recommended");
      }
    });
  });
}

export async function promptReplaceAgentConfigInteractive(filePath, rlInterface = null) {
  if (rlInterface) {
    return new Promise((resolve) => {
      rlInterface.question(`An unmanaged custom configuration exists at '${filePath}'. Replace with managed profile? [y/N]: `, (ans) => {
        const trimmed = (ans || "").trim().toLowerCase();
        resolve(trimmed === "y" || trimmed === "yes");
      });
    });
  }

  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`\n⚠️  An unmanaged custom configuration exists at '${filePath}'.\nReplace with managed Suite de Agentes profile? (Your original file will be backed up) [y/N]: `, (ans) => {
      rl.close();
      const trimmed = (ans || "").trim().toLowerCase();
      resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}

export function installPlugin(options = {}) {
  const home = getDefaultHome();
  const configDir = path.resolve(options.configDir || getDefaultConfigDir(home));
  const targetDir = path.resolve(options.targetDir || getDefaultTargetDir(configDir));
  const sourceDir = path.resolve(options.sourceDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const dryRun = Boolean(options.dryRun);
  const skipNpm = Boolean(options.skipNpm);
  const replaceAgentConfig = Boolean(options.replaceAgentConfig);
  const agentPermissions = options.agentPermissions || "none";

  if (!["recommended", "prompt", "none"].includes(agentPermissions)) {
    throw new Error(`Invalid agentPermissions option '${agentPermissions}'. Allowed values: recommended, prompt, none.`);
  }

  const serverPluginPath = path.join(targetDir, "dist", "server.js").replace(/\\/g, "/");
  const tuiPluginPath = path.join(targetDir, "dist", "tui.js").replace(/\\/g, "/");
  const agentMarkdownPath = path.join(configDir, "agent", "agent-task-manager.md");

  // Determine agent configuration action and safe ownership
  let agentAction = "skipped";
  let isManaged = false;
  let conflictReason;
  let targetContent = null;

  if (agentPermissions !== "none") {
    targetContent = generateTaskManagerMarkdown(agentPermissions);
    if (!fs.existsSync(agentMarkdownPath)) {
      agentAction = dryRun ? "create" : "created";
      isManaged = true;
    } else {
      const existingContent = fs.readFileSync(agentMarkdownPath, "utf8");
      isManaged = isManagedTaskManagerMarkdown(existingContent);
      if (isManaged) {
        if (existingContent === targetContent) {
          agentAction = "unchanged";
        } else {
          agentAction = dryRun ? "update" : "updated";
        }
      } else {
        // Unmanaged / foreign agent configuration
        if (replaceAgentConfig) {
          agentAction = dryRun ? "update" : "updated";
        } else {
          agentAction = "conflict";
          conflictReason = "unmanaged_custom_agent_exists";
        }
      }
    }
  } else {
    agentAction = "skipped";
  }

  const planned = {
    sourceDir,
    targetDir,
    configDir,
    serverPluginPath,
    tuiPluginPath,
    opencodeConfig: path.join(configDir, "opencode.json"),
    tuiConfig: path.join(configDir, "tui.json"),
    agentPermissions,
    replaceAgentConfig,
    agentAction,
    materializedAgents: (agentAction === "create" || agentAction === "created" || agentAction === "update" || agentAction === "updated")
      ? [agentMarkdownPath]
      : [],
    copiedItems: ["dist", "package.json", "package-lock.json", "manifest.json", "README.md", "LICENSE", "scripts", "install.ps1", "install.sh"],
  };

  const agentReceipt = {
    path: agentMarkdownPath,
    action: agentAction,
    managed: isManaged,
    ...(conflictReason ? { reason: conflictReason } : {}),
  };

  if (dryRun) {
    return {
      status: "dry-run",
      dryRun: true,
      planned,
      agentReceipt,
    };
  }

  // 1. Copy files to target directory
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  for (const item of planned.copiedItems) {
    const src = path.join(sourceDir, item);
    const dst = path.join(targetDir, item);
    if (fs.existsSync(src)) {
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        copyDirectoryRecursive(src, dst, false);
      } else {
        fs.copyFileSync(src, dst);
      }
    }
  }

  // 2. Run npm install --omit=dev in target directory if needed
  if (!skipNpm && fs.existsSync(path.join(targetDir, "package.json"))) {
    try {
      execFileSync(
        "npm",
        ["install", "--omit=dev", "--no-audit", "--no-fund"],
        {
          cwd: targetDir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          shell: true,
        }
      );
    } catch {
      // In self-contained package where node_modules are already present, npm install failure may be non-fatal
    }
  }

  // 3. Register server plugin in opencode.json
  const opencodeJsonPath = path.join(configDir, "opencode.json");
  const opencodeData = readJsonSafe(opencodeJsonPath, {
    $schema: "https://opencode.ai/config.json",
    plugin: [],
  });

  if (!Array.isArray(opencodeData.plugin)) {
    opencodeData.plugin = [];
  }

  const existingServerIdx = opencodeData.plugin.findIndex((p) => {
    if (typeof p !== "string") return false;
    const normalized = p.replace(/\\/g, "/");
    return normalized === serverPluginPath || (normalized.endsWith("/dist/server.js") && normalized.includes("suite-de-agentes"));
  });

  if (existingServerIdx >= 0) {
    opencodeData.plugin[existingServerIdx] = serverPluginPath;
  } else {
    opencodeData.plugin.push(serverPluginPath);
  }

  writeJsonSafe(opencodeJsonPath, opencodeData, false);

  // 4. Register TUI plugin in tui.json
  const tuiJsonPath = path.join(configDir, "tui.json");
  const tuiData = readJsonSafe(tuiJsonPath, {
    $schema: "https://opencode.ai/tui.json",
    plugin: [],
  });

  if (!Array.isArray(tuiData.plugin)) {
    tuiData.plugin = [];
  }

  const existingTuiIdx = tuiData.plugin.findIndex((p) => {
    if (typeof p !== "string") return false;
    const normalized = p.replace(/\\/g, "/");
    return normalized === tuiPluginPath || (normalized.endsWith("/dist/tui.js") && normalized.includes("suite-de-agentes"));
  });

  if (existingTuiIdx >= 0) {
    tuiData.plugin[existingTuiIdx] = tuiPluginPath;
  } else {
    tuiData.plugin.push(tuiPluginPath);
  }

  writeJsonSafe(tuiJsonPath, tuiData, false);

  // 5. Materialize agent markdown if action allows
  const materialized = [];
  if ((agentAction === "created" || agentAction === "updated") && targetContent) {
    const isReplacingCustom = !isManaged;
    writeFileSafe(agentMarkdownPath, targetContent, false, isReplacingCustom);
    materialized.push(agentMarkdownPath);
    agentReceipt.managed = true;
  }

  return {
    status: agentAction === "conflict" ? "conflict" : "installed",
    targetDir,
    configDir,
    serverPluginPath,
    tuiPluginPath,
    agentPermissions,
    materializedAgents: materialized,
    agentReceipt,
  };
}

export function uninstallPlugin(options = {}) {
  const home = getDefaultHome();
  const configDir = path.resolve(options.configDir || getDefaultConfigDir(home));
  const targetDir = path.resolve(options.targetDir || getDefaultTargetDir(configDir));
  const dryRun = Boolean(options.dryRun);

  const serverPluginPath = path.join(targetDir, "dist", "server.js").replace(/\\/g, "/");
  const tuiPluginPath = path.join(targetDir, "dist", "tui.js").replace(/\\/g, "/");
  const agentMarkdownPath = path.join(configDir, "agent", "agent-task-manager.md");

  const opencodeJsonPath = path.join(configDir, "opencode.json");
  const tuiJsonPath = path.join(configDir, "tui.json");

  let isManaged = false;
  let customBakExists = false;
  if (fs.existsSync(agentMarkdownPath)) {
    const content = fs.readFileSync(agentMarkdownPath, "utf8");
    isManaged = isManagedTaskManagerMarkdown(content);
    const customBak = `${agentMarkdownPath}.custom.bak`;
    const primaryBak = `${agentMarkdownPath}.bak`;
    if (fs.existsSync(customBak) || fs.existsSync(primaryBak)) {
      customBakExists = true;
    }
  }

  if (dryRun) {
    return {
      status: "dry-run",
      dryRun: true,
      action: "uninstall",
      opencodeConfig: opencodeJsonPath,
      tuiConfig: tuiJsonPath,
      agentAction: isManaged ? "remove" : (fs.existsSync(agentMarkdownPath) ? "preserve" : "none"),
      managedAgents: isManaged ? [agentMarkdownPath] : [],
      preservedAgents: (fs.existsSync(agentMarkdownPath) && !isManaged) ? [agentMarkdownPath] : [],
    };
  }

  if (fs.existsSync(opencodeJsonPath)) {
    const opencodeData = readJsonSafe(opencodeJsonPath, {});
    if (Array.isArray(opencodeData.plugin)) {
      const filtered = opencodeData.plugin.filter((p) => {
        if (typeof p !== "string") return true;
        const normalized = p.replace(/\\/g, "/");
        return normalized !== serverPluginPath && !(normalized.endsWith("/dist/server.js") && normalized.includes("suite-de-agentes"));
      });
      if (filtered.length !== opencodeData.plugin.length) {
        opencodeData.plugin = filtered;
        writeJsonSafe(opencodeJsonPath, opencodeData, false);
      }
    }
  }

  if (fs.existsSync(tuiJsonPath)) {
    const tuiData = readJsonSafe(tuiJsonPath, {});
    if (Array.isArray(tuiData.plugin)) {
      const filtered = tuiData.plugin.filter((p) => {
        if (typeof p !== "string") return true;
        const normalized = p.replace(/\\/g, "/");
        return normalized !== tuiPluginPath && !(normalized.endsWith("/dist/tui.js") && normalized.includes("suite-de-agentes"));
      });
      if (filtered.length !== tuiData.plugin.length) {
        tuiData.plugin = filtered;
        writeJsonSafe(tuiJsonPath, tuiData, false);
      }
    }
  }

  const removedAgents = [];
  const preservedAgents = [];
  const restoredAgents = [];

  if (fs.existsSync(agentMarkdownPath)) {
    const content = fs.readFileSync(agentMarkdownPath, "utf8");
    if (isManagedTaskManagerMarkdown(content)) {
      // Managed file: safe to remove or restore previous custom backup
      const customBak = `${agentMarkdownPath}.custom.bak`;
      const primaryBak = `${agentMarkdownPath}.bak`;
      let restored = false;

      if (fs.existsSync(customBak)) {
        try {
          const bakContent = fs.readFileSync(customBak, "utf8");
          if (!isManagedTaskManagerMarkdown(bakContent)) {
            fs.copyFileSync(customBak, agentMarkdownPath);
            fs.unlinkSync(customBak);
            restored = true;
            restoredAgents.push(agentMarkdownPath);
          }
        } catch {
          // Non-fatal
        }
      }

      if (!restored && fs.existsSync(primaryBak)) {
        try {
          const bakContent = fs.readFileSync(primaryBak, "utf8");
          if (!isManagedTaskManagerMarkdown(bakContent)) {
            fs.copyFileSync(primaryBak, agentMarkdownPath);
            fs.unlinkSync(primaryBak);
            restored = true;
            restoredAgents.push(agentMarkdownPath);
          }
        } catch {
          // Non-fatal
        }
      }

      if (!restored) {
        try {
          fs.unlinkSync(agentMarkdownPath);
          removedAgents.push(agentMarkdownPath);
        } catch {
          // Ignore removal failure if locked
        }
      }
    } else {
      // Foreign / custom agent: NEVER delete
      preservedAgents.push(agentMarkdownPath);
    }
  }

  return {
    status: "uninstalled",
    configDir,
    targetDir,
    removedAgents,
    preservedAgents,
    restoredAgents,
  };
}

// CLI execution entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    try {
      const options = parseArgs(process.argv.slice(2));
      if (options.help) {
        console.log("Suite de Agentes Installer (v1.1.0)");
        console.log("Usage: node scripts/installer.mjs [--dry-run] [--uninstall] [--agent-permissions recommended|prompt|none] [--replace-agent-config] [--target-dir <path>] [--config-dir <path>]");
        process.exit(0);
      }

      const { nodeVersion, npmOk } = checkPrerequisites();
      console.log(`OpenCode Suite de Agentes Installer`);
      console.log(`Environment: Node ${nodeVersion}, npm: ${npmOk ? "ok" : "not found in PATH"}`);

      if (options.uninstall) {
        const res = uninstallPlugin(options);
        if (options.dryRun) {
          console.log(`[DRY-RUN] Would uninstall Suite de Agentes from ${res.opencodeConfig} and ${res.tuiConfig}`);
        } else {
          console.log(`✓ Successfully uninstalled Suite de Agentes from ${res.configDir}`);
          if (res.preservedAgents && res.preservedAgents.length > 0) {
            console.log(`ℹ Preserved custom unmanaged agent files: ${res.preservedAgents.join(", ")}`);
          }
          if (res.restoredAgents && res.restoredAgents.length > 0) {
            console.log(`✓ Restored original custom agent files: ${res.restoredAgents.join(", ")}`);
          }
        }
      } else {
        let agentPermissions = options.agentPermissions;
        const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

        if (!agentPermissions && !options.dryRun) {
          if (isInteractive) {
            agentPermissions = await promptPermissionsInteractive();
          } else {
            agentPermissions = "none";
          }
        } else if (!agentPermissions) {
          agentPermissions = "none";
        }

        let replaceAgentConfig = options.replaceAgentConfig;
        const configDir = path.resolve(options.configDir || getDefaultConfigDir());
        const agentMarkdownPath = path.join(configDir, "agent", "agent-task-manager.md");

        if (agentPermissions !== "none" && fs.existsSync(agentMarkdownPath) && !replaceAgentConfig && isInteractive && !options.dryRun) {
          const existing = fs.readFileSync(agentMarkdownPath, "utf8");
          if (!isManagedTaskManagerMarkdown(existing)) {
            replaceAgentConfig = await promptReplaceAgentConfigInteractive(agentMarkdownPath);
          }
        }

        const installOpts = { ...options, agentPermissions, replaceAgentConfig };
        const res = installPlugin(installOpts);
        if (options.dryRun) {
          console.log(`[DRY-RUN] Target Directory: ${res.planned.targetDir}`);
          console.log(`[DRY-RUN] Server Plugin Path: ${res.planned.serverPluginPath}`);
          console.log(`[DRY-RUN] TUI Plugin Path: ${res.planned.tuiPluginPath}`);
          console.log(`[DRY-RUN] Agent Permissions Profile: ${res.planned.agentPermissions}`);
          console.log(`[DRY-RUN] Agent Action: ${res.agentReceipt.action}`);
          if (res.planned.materializedAgents.length > 0) {
            console.log(`[DRY-RUN] Would materialize agents: ${res.planned.materializedAgents.join(", ")}`);
          }
          console.log(`[DRY-RUN] Would register in ${res.planned.opencodeConfig} and ${res.planned.tuiConfig}`);
        } else {
          console.log(`✓ Installed plugin files to ${res.targetDir}`);
          console.log(`✓ Registered server plugin: ${res.serverPluginPath}`);
          console.log(`✓ Registered TUI plugin: ${res.tuiPluginPath}`);
          if (res.agentReceipt.action === "conflict") {
            console.log(`⚠️ Skipped materializing '${agentMarkdownPath}': An unmanaged custom file exists.`);
            console.log(`   To overwrite it with a backup, pass --replace-agent-config.`);
          } else if (res.agentReceipt.action === "unchanged") {
            console.log(`ℹ Agent configuration is up to date: ${agentMarkdownPath}`);
          } else if (res.materializedAgents && res.materializedAgents.length > 0) {
            console.log(`✓ Materialized agent configuration (${res.agentPermissions}): ${res.materializedAgents.join(", ")}`);
          }
          console.log(`\nSuite de Agentes is ready! Restart OpenCode and press Alt+S or type /agent-suite to launch.`);
        }
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  })();
}
