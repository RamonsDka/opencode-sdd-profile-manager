import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "./store.ts";
import { defaultDatabasePath } from "./db-path.ts";
import {
  type InspectResult,
  type OfflinePlan,
  type ArmedPlan,
  type MaintenanceReceipt,
  type ClaimedStateReport,
  type PidLiveness,
  armOfflinePlan,
  cancelArmedPlan,
  getArmedPlan,
  getClaimedPlan,
  inspectClaimedState,
  getReceipt,
  clearReceipt,
} from "./coordination.ts";

const execFileAsync = promisify(execFile);

export interface NodeCapability {
  ok: boolean;
  version?: string;
  executable: string;
  error?: string;
}

/**
 * Verifies that Node.js executable exists, is at least v22.6.0, and successfully imports node:sqlite DatabaseSync.
 */
export async function verifyNodeCapability(nodeExecutable = "node"): Promise<NodeCapability> {
  try {
    const { stdout } = await execFileAsync(
      nodeExecutable,
      [
        "--input-type=module",
        "-e",
        "import { DatabaseSync } from 'node:sqlite'; if (typeof DatabaseSync !== 'function') process.exit(1); console.log(process.version);",
      ],
      {
        windowsHide: true,
        timeout: 10000,
      }
    );
    const versionMatch = stdout.trim().match(/^v(\d+)\.(\d+)/);
    if (!versionMatch) {
      return {
        ok: false,
        executable: nodeExecutable,
        error: `No se pudo identificar la versión de Node.js (${stdout.trim()}).`,
      };
    }
    const major = parseInt(versionMatch[1], 10);
    const minor = parseInt(versionMatch[2], 10);
    if (major < 22 || (major === 22 && minor < 6)) {
      return {
        ok: false,
        version: stdout.trim(),
        executable: nodeExecutable,
        error: `Node.js ${stdout.trim()} detectado. Se requiere Node.js >= 22.6 para operaciones SQLite fuera de línea.`,
      };
    }
    return {
      ok: true,
      version: stdout.trim(),
      executable: nodeExecutable,
    };
  } catch (err) {
    return {
      ok: false,
      executable: nodeExecutable,
      error: `Node.js no disponible o no soporta node:sqlite DatabaseSync (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
}

/**
 * Resolves stable helper path across development, build distribution and packaged extensions.
 * Handles paths with spaces safely by returning exact absolute path without arbitrary cwd fallback.
 */
export function resolveHelperPath(baseDir?: string): string {
  if (process.env.OPENCODE_SESSION_VAULT_HELPER) {
    const override = path.resolve(process.env.OPENCODE_SESSION_VAULT_HELPER);
    if (fsSync.existsSync(override)) return override;
  }

  const currentDir =
    baseDir ??
    (() => {
      try {
        return path.dirname(fileURLToPath(import.meta.url));
      } catch {
        return path.resolve(".");
      }
    })();

  const candidates = [
    // 1. Packaged inside host distribution (e.g. host/dist/plugins/opencode-session-vault/offline-vault.mjs)
    path.join(currentDir, "plugins", "opencode-session-vault", "offline-vault.mjs"),
    path.join(currentDir, "plugins", "opencode-session-vault", "dist", "offline-vault.mjs"),
    // 2. From host root looking into dist or plugins
    path.join(currentDir, "dist", "plugins", "opencode-session-vault", "offline-vault.mjs"),
    path.join(currentDir, "..", "dist", "plugins", "opencode-session-vault", "offline-vault.mjs"),
    path.join(currentDir, "..", "plugins", "opencode-session-vault", "offline-vault.mjs"),
    path.join(currentDir, "..", "plugins", "opencode-session-vault", "dist", "offline-vault.mjs"),
    path.join(currentDir, "..", "..", "plugins", "opencode-session-vault", "offline-vault.mjs"),
    path.join(currentDir, "..", "..", "dist", "plugins", "opencode-session-vault", "offline-vault.mjs"),
    // 3. Directly alongside caller or in dist/ of own package
    path.join(currentDir, "offline-vault.mjs"),
    path.join(currentDir, "dist", "offline-vault.mjs"),
    path.join(currentDir, "..", "dist", "offline-vault.mjs"),
    path.join(currentDir, "..", "offline-vault.mjs"),
    // 4. In scripts/ in development
    path.join(currentDir, "..", "scripts", "offline-vault.ts"),
    path.join(currentDir, "scripts", "offline-vault.ts"),
    path.join(currentDir, "..", "plugins", "opencode-session-vault", "scripts", "offline-vault.ts"),
  ];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fsSync.existsSync(resolved)) {
      return resolved;
    }
  }

  throw new Error(
    `No se encontró el ejecutable helper fuera de línea ('offline-vault.mjs') en ninguna ruta candidata relativa a '${currentDir}'.`
  );
}

/**
 * Resolves stable monitor script path across development, build distribution and packaged extensions.
 * Handles paths with spaces safely by returning exact absolute path.
 */
export function resolveMonitorPath(baseDir?: string): string {
  if (process.env.OPENCODE_SESSION_VAULT_MONITOR) {
    const override = path.resolve(process.env.OPENCODE_SESSION_VAULT_MONITOR);
    if (fsSync.existsSync(override)) return override;
  }

  const currentDir =
    baseDir ??
    (() => {
      try {
        return path.dirname(fileURLToPath(import.meta.url));
      } catch {
        return path.resolve(".");
      }
    })();

  const candidates = [
    // 1. In scripts/ in development
    path.join(currentDir, "..", "scripts", "maintenance-monitor.ps1"),
    path.join(currentDir, "scripts", "maintenance-monitor.ps1"),
    path.join(currentDir, "..", "plugins", "opencode-session-vault", "scripts", "maintenance-monitor.ps1"),
    // 2. In dist/ or packaged alongside caller
    path.join(currentDir, "maintenance-monitor.ps1"),
    path.join(currentDir, "dist", "maintenance-monitor.ps1"),
    path.join(currentDir, "..", "dist", "maintenance-monitor.ps1"),
    path.join(currentDir, "..", "maintenance-monitor.ps1"),
    path.join(currentDir, "plugins", "opencode-session-vault", "maintenance-monitor.ps1"),
    path.join(currentDir, "plugins", "opencode-session-vault", "dist", "maintenance-monitor.ps1"),
    path.join(currentDir, "..", "plugins", "opencode-session-vault", "dist", "maintenance-monitor.ps1"),
    path.join(currentDir, "..", "plugins", "opencode-session-vault", "maintenance-monitor.ps1"),
  ];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fsSync.existsSync(resolved)) {
      return resolved;
    }
  }

  throw new Error(
    `No se encontró el script de monitor visible ('maintenance-monitor.ps1') en ninguna ruta candidata relativa a '${currentDir}'.`
  );
}

export interface HelperClientOptions {
  nodeExecutable?: string;
  helperPath?: string;
  store: Store;
  monitorScriptPath?: string;
  spawnMonitor?: boolean;
  customMonitorSpawn?: (cmd: string, args: string[], spawnOptions: any) => { pid?: number };
}

export class VaultHelperClient {
  nodeExecutable: string;
  helperPath: string;
  store: Store;
  monitorScriptPath?: string;
  spawnMonitorOption?: boolean;
  customMonitorSpawn?: (cmd: string, args: string[], spawnOptions: any) => { pid?: number };

  constructor(options: HelperClientOptions) {
    this.nodeExecutable = options.nodeExecutable ?? "node";
    this.helperPath = options.helperPath ?? resolveHelperPath();
    this.store = options.store;
    this.monitorScriptPath = options.monitorScriptPath;
    this.spawnMonitorOption = options.spawnMonitor;
    this.customMonitorSpawn = options.customMonitorSpawn;
  }

  async verifyCapability(): Promise<NodeCapability> {
    return verifyNodeCapability(this.nodeExecutable);
  }

  /**
   * Returns fast filesystem metadata for database (path, sizeBytes, exists, walSizeBytes) without starting SQLite or spawning child.
   */
  getQuickDiskStats(dbPath?: string): { dbPath: string; sizeBytes: number; exists: boolean; walSizeBytes?: number } {
    const targetPath = path.resolve(dbPath ? dbPath : defaultDatabasePath());
    try {
      if (fsSync.existsSync(targetPath)) {
        const stat = fsSync.statSync(targetPath);
        let walSizeBytes: number | undefined;
        try {
          const walPath = `${targetPath}-wal`;
          if (fsSync.existsSync(walPath)) {
            walSizeBytes = fsSync.statSync(walPath).size;
          }
        } catch {}
        return { dbPath: targetPath, sizeBytes: stat.size, exists: true, walSizeBytes };
      }
      return { dbPath: targetPath, sizeBytes: 0, exists: false };
    } catch {
      return { dbPath: targetPath, sizeBytes: 0, exists: false };
    }
  }

  /**
   * Executes inspect in read-only mode via helper. Safe while OpenCode is running.
   */
  async inspectDatabase(
    dbPath?: string,
    options?: { checkIntegrity?: boolean; timeout?: number }
  ): Promise<InspectResult> {
    const cap = await this.verifyCapability();
    if (!cap.ok) throw new Error(cap.error);

    const args = [this.helperPath, "inspect", "--json"];
    if (dbPath) args.push("--db", dbPath);
    if (options?.checkIntegrity) args.push("--check-integrity");

    const timeout = options?.timeout ?? 30000;
    let stdout = "";
    let stderr = "";
    try {
      const res = await execFileAsync(this.nodeExecutable, args, {
        windowsHide: true,
        timeout,
      });
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (err: any) {
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
      if (err.killed || err.code === "ETIMEDOUT" || err.timedOut || err.signal === "SIGTERM") {
        throw new Error(
          `El proceso helper excedió el tiempo de espera (${Math.round(timeout / 1000)}s) al inspeccionar la base de datos.`
        );
      }
      if (stdout) {
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) throw new Error(parsed.error);
        } catch (jsonErr) {
          if (!(jsonErr instanceof SyntaxError)) throw jsonErr;
        }
      }
      const cleanStderr = typeof stderr === "string" ? stderr.trim().split("\n").slice(0, 3).join(" ") : "";
      throw new Error(cleanStderr || err.message || String(err));
    }

    try {
      const parsed = JSON.parse(stdout);
      if (parsed.error) throw new Error(parsed.error);
      return parsed as InspectResult;
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`Salida de inspección no válida: ${stdout || stderr}`);
      }
      throw e;
    }
  }

  /**
   * Generates plan in read-only mode via helper with allowRunning. Safe while OpenCode is running.
   */
  async generatePlan(options: {
    dbPath?: string;
    projectID?: string;
    max?: number;
    timeout?: number;
  }): Promise<OfflinePlan> {
    const cap = await this.verifyCapability();
    if (!cap.ok) throw new Error(cap.error);

    const args = [
      this.helperPath,
      "plan",
      "--json",
      "--allow-running",
      "--state-dir",
      this.store.dir,
    ];
    if (options.dbPath) args.push("--db", options.dbPath);
    if (options.projectID) args.push("--project", options.projectID);
    if (options.max) args.push("--max", String(options.max));

    const timeout = options.timeout ?? 30000;
    let stdout = "";
    let stderr = "";
    try {
      const res = await execFileAsync(this.nodeExecutable, args, {
        windowsHide: true,
        timeout,
      });
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (err: any) {
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
      if (err.killed || err.code === "ETIMEDOUT" || err.timedOut || err.signal === "SIGTERM") {
        throw new Error(
          `El proceso helper excedió el tiempo de espera (${Math.round(timeout / 1000)}s) al generar el plan de mantenimiento.`
        );
      }
      if (stdout) {
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) throw new Error(parsed.error);
        } catch (jsonErr) {
          if (!(jsonErr instanceof SyntaxError)) throw jsonErr;
        }
      }
      const cleanStderr = typeof stderr === "string" ? stderr.trim().split("\n").slice(0, 3).join(" ") : "";
      throw new Error(cleanStderr || err.message || String(err));
    }

    try {
      const parsed = JSON.parse(stdout);
      if (parsed.error) throw new Error(parsed.error);
      return parsed as OfflinePlan;
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`Salida de plan no válida: ${stdout || stderr}`);
      }
      throw e;
    }
  }

  /**
   * Spawns visible monitor window on Windows and waits for readiness handshake before maintenance is armed.
   * Uses fixed encoded launcher directly without cmd.exe or untrusted shell interpolation.
   * If monitor fails to start or handshake times out, fails closed without arming.
   */
  async spawnMonitor(options: {
    stateDir: string;
    dbPath: string;
    ownerPid: number;
    armId: string;
    expiresAt: number;
    timeoutMs?: number;
    monitorScriptPath?: string;
    customSpawn?: (cmd: string, args: string[], spawnOptions: any) => { pid?: number };
    sleepFn?: (ms: number) => Promise<void>;
  }): Promise<{ monitorPid: number; handshakeFile: string }> {
    if (process.platform !== "win32" && !options.customSpawn) {
      throw new Error(
        "El monitor visible de mantenimiento requiere un entorno Windows compatible. No se programó la limpieza."
      );
    }

    if (!options.stateDir || !options.dbPath || !options.ownerPid || !options.armId || !options.expiresAt) {
      throw new Error("Parámetros requeridos ausentes o inválidos para spawnMonitor.");
    }

    const monitorPath = options.monitorScriptPath ?? resolveMonitorPath();
    const handshakeFile = path.join(options.stateDir, `monitor-ready-${options.armId}.json`);

    await fs.mkdir(options.stateDir, { recursive: true });
    await fs.rm(handshakeFile, { force: true });

    const monitorArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      monitorPath,
      "-StateDir",
      options.stateDir,
      "-DbPath",
      options.dbPath,
      "-OwnerPid",
      String(options.ownerPid),
      "-ArmId",
      options.armId,
      "-ExpiresAt",
      String(options.expiresAt),
      "-HandshakeFile",
      handshakeFile,
    ];

    try {
      if (options.customSpawn) {
        // Direct invocation for mock/custom test spawns
        const child = options.customSpawn("powershell.exe", monitorArgs, {
          windowsHide: false,
          stdio: "ignore",
          detached: true,
        });
        if (!child?.pid) {
          throw new Error("El sistema operativo no asignó un PID al monitor de mantenimiento.");
        }
      } else {
        // Production runtime: Fixed encoded launcher via Start-Process powershell.exe.
        // Completely removes cmd.exe /c start and avoids shell interpolation or % expansion issues.
        const innerScript = `& ${JSON.stringify(monitorPath)} -StateDir ${JSON.stringify(options.stateDir)} -DbPath ${JSON.stringify(options.dbPath)} -OwnerPid ${options.ownerPid} -ArmId ${JSON.stringify(options.armId)} -ExpiresAt ${options.expiresAt} -HandshakeFile ${JSON.stringify(handshakeFile)}`;
        const innerEncoded = Buffer.from(innerScript, "utf16le").toString("base64");
        const launcherScript = `Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${innerEncoded}"`;
        const launcherEncoded = Buffer.from(launcherScript, "utf16le").toString("base64");

        const child = spawn("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          launcherEncoded,
        ], {
          windowsHide: true,
          stdio: "ignore",
        });

        if (!child.pid) {
          throw new Error("El sistema operativo no asignó un PID al lanzador del monitor.");
        }
      }
    } catch (spawnErr) {
      throw new Error(
        `Fallo al lanzar el monitor visible de mantenimiento: ${
          spawnErr instanceof Error ? spawnErr.message : String(spawnErr)
        }. No se armó la limpieza.`
      );
    }

    // Await readiness handshake with bounded timeout
    const timeoutMs = options.timeoutMs ?? 5000;
    const deadline = Date.now() + timeoutMs;
    const sleep = options.sleepFn ?? (ms => new Promise(res => setTimeout(res, ms)));
    let handshake: { ready: boolean; monitorPid: number; armId: string } | null = null;

    while (Date.now() < deadline) {
      try {
        const raw = await fs.readFile(handshakeFile, "utf8");
        const cleaned = raw.replace(/^\uFEFF/, "").trim();
        const parsed = JSON.parse(cleaned);
        if (parsed.ready && parsed.armId === options.armId && typeof parsed.monitorPid === "number") {
          handshake = parsed;
          break;
        }
      } catch {}
      await sleep(50);
    }

    if (!handshake) {
      try {
        await fs.rm(handshakeFile, { force: true });
      } catch {}
      throw new Error(
        `No se pudo iniciar el monitor visible de mantenimiento: confirmación de inicialización (handshake) no recibida en ${Math.round(
          timeoutMs / 1000
        )}s. No se armó la limpieza.`
      );
    }

    return { monitorPid: handshake.monitorPid, handshakeFile };
  }

  /**
   * Arms a plan for maintenance and spawns helper in background to wait for OpenCode exit.
   * On Windows (or when spawnMonitor is enabled), ensures a visible monitor is launched and ready
   * BEFORE arming the plan. Reports blocking error and fails closed if monitor spawn or handshake fails.
   */
  async armAndSpawn(options: {
    plan: OfflinePlan;
    ownerPid: number;
    ttlMs?: number;
    skipVacuum?: boolean;
    spawnMonitor?: boolean;
    monitorPid?: number;
    armId?: string;
    monitorTimeoutMs?: number;
    monitorScriptPath?: string;
    customMonitorSpawn?: (cmd: string, args: string[], spawnOptions: any) => { pid?: number };
    sleepFn?: (ms: number) => Promise<void>;
    _trustedTestExecution?: boolean;
  }): Promise<{ armed: ArmedPlan; pid?: number; monitorPid?: number }> {
    // Incident containment gate: pending claim blocks new arm
    const pendingClaim = await getClaimedPlan(this.store);
    if (pendingClaim) {
      throw new Error(
        "Mantenimiento suspendido: operación interrumpida / exclusión no garantizada (se detectó un plan reclamado previo sin resolver)."
      );
    }

    // Production protective gate: centrally disallow production destructive arming
    // Rejects pre-spawn (neither visible monitor nor background helper process spawned).
    if (!options._trustedTestExecution) {
      throw new Error(
        "Mantenimiento suspendido: operación interrumpida / exclusión no garantizada (coordinación exclusiva de host no disponible en producción)."
      );
    }

    const cap = await this.verifyCapability();
    if (!cap.ok) throw new Error(cap.error);

    const armId = options.armId ?? randomUUID();
    const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    const expiresAt = Date.now() + ttlMs;

    let monitorPid = options.monitorPid;

    // Visible monitor gating: if enabled (default true on Windows), spawn monitor and await readiness handshake
    // BEFORE arming executable maintenance! Fail closed if monitor cannot be created or handshake fails.
    const shouldSpawnMonitor =
      options.spawnMonitor ??
      (this.spawnMonitorOption !== undefined ? this.spawnMonitorOption : process.platform === "win32");
    if (shouldSpawnMonitor && !monitorPid) {
      const monitorRes = await this.spawnMonitor({
        stateDir: this.store.dir,
        dbPath: options.plan.canonicalDbPath,
        ownerPid: options.ownerPid,
        armId,
        expiresAt,
        timeoutMs: options.monitorTimeoutMs,
        monitorScriptPath: options.monitorScriptPath ?? this.monitorScriptPath,
        customSpawn: options.customMonitorSpawn ?? this.customMonitorSpawn,
        sleepFn: options.sleepFn,
      });
      monitorPid = monitorRes.monitorPid;
    }

    const armed = await armOfflinePlan({
      store: this.store,
      plan: options.plan,
      ownerPid: options.ownerPid,
      ttlMs,
      armId,
      monitorPid,
      _trustedTestExecution: true,
    });

    const args = [
      this.helperPath,
      "run-armed",
      "--state-dir",
      this.store.dir,
      "--owner-pid",
      String(options.ownerPid),
    ];
    if (options.skipVacuum) args.push("--skip-vacuum");

    try {
      const child = spawn(this.nodeExecutable, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });

      if (!child.pid) {
        throw new Error("El sistema operativo no asignó un PID al proceso helper de mantenimiento.");
      }

      // Write worker PID file so monitor is explicitly tied to worker identity
      const workerPidFile = path.join(this.store.dir, `worker-pid-${armId}.json`);
      await fs.writeFile(
        workerPidFile,
        JSON.stringify({ armId, workerPid: child.pid, timestamp: Date.now() }, null, 2),
        "utf8"
      );

      child.unref();
      return { armed, pid: child.pid, monitorPid };
    } catch (err) {
      // Revert armed plan file and clean up on worker spawn failure
      try {
        await cancelArmedPlan(this.store);
        const workerPidFile = path.join(this.store.dir, `worker-pid-${armId}.json`);
        await fs.rm(workerPidFile, { force: true });
      } catch {}
      throw new Error(
        `Fallo al iniciar el proceso de mantenimiento fuera de línea: ${
          err instanceof Error ? err.message : String(err)
        }. No se armó la limpieza.`
      );
    }
  }

  async cancelArmed(): Promise<boolean> {
    try {
      return await cancelArmedPlan(this.store);
    } catch {
      // Fallback via helper process if direct file operation fails
      const args = [this.helperPath, "cancel-armed", "--state-dir", this.store.dir];
      const { stdout } = await execFileAsync(this.nodeExecutable, args, { windowsHide: true });
      const parsed = JSON.parse(stdout);
      return Boolean(parsed.cancelled);
    }
  }

  async getArmed(): Promise<ArmedPlan | null> {
    return await getArmedPlan(this.store);
  }

  async getClaimed(): Promise<ArmedPlan | null> {
    return await getClaimedPlan(this.store);
  }

  async inspectClaimed(options?: { isPidAlive?: (pid: number) => PidLiveness | boolean }): Promise<ClaimedStateReport | null> {
    return await inspectClaimedState(this.store, options);
  }

  async getReceipt(clear = false): Promise<MaintenanceReceipt | null> {
    const receipt = await getReceipt(this.store);
    if (clear && receipt) {
      await clearReceipt(this.store);
    }
    return receipt;
  }
}
