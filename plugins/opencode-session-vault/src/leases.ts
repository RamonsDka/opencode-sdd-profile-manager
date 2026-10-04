import * as fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { atomicWrite, type Store } from "./store.ts";

export interface ProcessInfo {
  pid: number;
  alive: boolean;
  status: "alive" | "dead" | "unknown";
  creationTime?: number;
  executable?: string;
  commandLine?: string;
  processName?: string;
  error?: unknown;
}

export type ProcessBatchInspector = (pids: number[]) => Promise<Map<number, ProcessInfo>>;

export function classifyProcess(proc: {
  name?: string;
  executablePath?: string;
  commandLine?: string;
}): "opencode" | "unrelated" | "ambiguous" {
  const exe = (proc.executablePath || "").toLowerCase();
  const rawName = proc.name || (proc.executablePath ? path.basename(proc.executablePath) : "");
  const name = rawName.toLowerCase().replace(/\.exe$/, "");
  const cmd = (proc.commandLine || "").toLowerCase();

  // 1. Direct standalone opencode executable (Bun standalone or named opencode binary)
  if (name === "opencode" || exe.endsWith("\\opencode.exe") || exe.endsWith("/opencode") || exe.endsWith("\\opencode")) {
    return "opencode";
  }

  // 2. Node or Bun runtime executing OpenCode
  if (name === "node" || name === "bun") {
    if (cmd.includes("opencode") || cmd.includes("session-vault")) {
      return "opencode";
    }
    if (cmd && !cmd.includes("opencode") && !cmd.includes("session-vault")) {
      return "unrelated";
    }
    return "ambiguous";
  }

  // 3. Known definitively unrelated processes (browsers, terminals, common tools, OS services)
  const UNRELATED_NAMES = new Set([
    "chrome", "msedge", "firefox", "brave", "opera", "iexplore", "safari",
    "conhost", "openconsole", "cmd", "powershell", "pwsh", "bash", "zsh", "wt", "warp",
    "alacritty", "kitty", "wezterm", "hyper", "tmux",
    "kubectl", "docker", "containerd", "podman", "git", "ssh", "code", "devenv",
    "slack", "discord", "spotify", "cargo", "rustc", "python", "python3", "ruby", "go",
    "java", "dotnet", "svchost", "explorer", "services", "lsass", "csrss", "smss",
    "wininit", "winlogon", "spoolsv", "taskhostw", "runtimebroker", "searchindexer",
    "wsl", "wslhost", "vmcompute", "system"
  ]);

  if (UNRELATED_NAMES.has(name)) {
    return "unrelated";
  }

  // Any non-node, non-bun, non-opencode executable is definitively unrelated
  if (name && name !== "node" && name !== "bun" && name !== "opencode") {
    return "unrelated";
  }

  return "ambiguous";
}

export async function defaultInspectProcessesWin32(pids: number[]): Promise<Map<number, ProcessInfo>> {
  const result = new Map<number, ProcessInfo>();
  if (pids.length === 0) return result;
  const validPids = pids.filter(p => Number.isInteger(p) && p > 0);
  if (validPids.length === 0) return result;

  const filter = validPids.map(p => `ProcessId = ${p}`).join(" OR ");
  const psCommand = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId, Name, ExecutablePath, CommandLine, @{N="CreationDate"; E={$_.CreationDate.ToString("o")}} | ConvertTo-Json -Compress`;

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCommand], { timeout: 6000, encoding: "utf8" }, (err, out) => {
        if (err) reject(err);
        else resolve(out);
      });
    });

    const trimmed = stdout.trim();
    if (trimmed) {
      const parsed = JSON.parse(trimmed);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const pid = Number(item.ProcessId);
        if (Number.isInteger(pid)) {
          let creationTime: number | undefined;
          if (item.CreationDate) {
            const parsedDate = Date.parse(item.CreationDate);
            if (Number.isFinite(parsedDate)) creationTime = parsedDate;
          }
          result.set(pid, {
            pid,
            alive: true,
            status: "alive",
            processName: item.Name ?? undefined,
            executable: item.ExecutablePath ?? undefined,
            commandLine: item.CommandLine ?? undefined,
            creationTime,
          });
        }
      }
    }
  } catch (err) {
    for (const pid of validPids) {
      if (!result.has(pid)) {
        result.set(pid, { pid, alive: true, status: "unknown", error: err });
      }
    }
    return result;
  }

  for (const pid of validPids) {
    if (!result.has(pid)) {
      result.set(pid, { pid, alive: false, status: "dead" });
    }
  }
  return result;
}

export async function defaultInspectProcessesLinux(pids: number[]): Promise<Map<number, ProcessInfo>> {
  const result = new Map<number, ProcessInfo>();
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      const [cmdline, exe, dirStat] = await Promise.all([
        fs.readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => null),
        fs.readlink(`/proc/${pid}/exe`).catch(() => null),
        fs.stat(`/proc/${pid}`).catch(() => null),
      ]);
      if (!dirStat) {
        result.set(pid, { pid, alive: false, status: "dead" });
        continue;
      }
      const creationTime = dirStat ? Math.round(dirStat.mtimeMs) : undefined;
      const cmd = cmdline ? cmdline.replace(/\0/g, " ").trim() : undefined;
      const name = exe ? path.basename(exe) : undefined;
      result.set(pid, {
        pid,
        alive: true,
        status: "alive",
        processName: name,
        executable: exe ?? undefined,
        commandLine: cmd,
        creationTime,
      });
    } catch {
      result.set(pid, { pid, alive: true, status: "unknown" });
    }
  }
  return result;
}

export async function defaultInspectProcessesUnix(pids: number[]): Promise<Map<number, ProcessInfo>> {
  const result = new Map<number, ProcessInfo>();
  if (pids.length === 0) return result;
  const validPids = pids.filter(p => Number.isInteger(p) && p > 0);
  if (validPids.length === 0) return result;

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile("ps", ["-o", "pid=,lstart=,comm=,args=", "-p", validPids.join(",")], { timeout: 4000 }, (err, out) => {
        if (err && (err as any).code !== 1) reject(err);
        else resolve(out || "");
      });
    });
    const lines = stdout.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/\s+/);
      const pid = Number(parts[0]);
      if (Number.isInteger(pid)) {
        result.set(pid, { pid, alive: true, status: "alive" });
      }
    }
  } catch {
    for (const pid of validPids) {
      result.set(pid, { pid, alive: true, status: "unknown" });
    }
  }
  return result;
}

export async function defaultInspectProcesses(pids: number[]): Promise<Map<number, ProcessInfo>> {
  if (process.platform === "win32") {
    return defaultInspectProcessesWin32(pids);
  }
  if (process.platform === "linux") {
    return defaultInspectProcessesLinux(pids);
  }
  return defaultInspectProcessesUnix(pids);
}

export async function resolveCurrentProcessStartTime(
  inspector?: ProcessBatchInspector
): Promise<number> {
  const pid = process.pid;
  try {
    const fn = inspector ?? defaultInspectProcesses;
    const map = await fn([pid]);
    const info = map.get(pid);
    if (info && typeof info.creationTime === "number") {
      return info.creationTime;
    }
  } catch {}
  return Date.now() - Math.round(process.uptime() * 1000);
}

export interface LeasesOptions {
  ownStartTime?: number;
  inspectProcesses?: ProcessBatchInspector;
  isPidAlive?: (pid: number) => boolean | "alive" | "dead" | "unknown";
}

// Sessions selected by participating TUIs remain protected, even when idle.
export class Leases {
  store: Store;
  file: string;
  ownStartTime?: number;
  inspectProcesses?: ProcessBatchInspector;
  isPidAlive?: (pid: number) => boolean | "alive" | "dead" | "unknown";

  constructor(store: Store, options?: LeasesOptions) {
    this.store = store;
    this.file = path.join(store.dir, "instances", `${process.pid}-${randomUUID()}.json`);
    this.ownStartTime = options?.ownStartTime;
    this.inspectProcesses = options?.inspectProcesses;
    this.isPidAlive = options?.isPidAlive;
  }

  checkLiveness(pid: number): { alive: boolean; status: "alive" | "dead" | "unknown" } {
    if (this.isPidAlive) {
      const res = this.isPidAlive(pid);
      if (res === "dead" || res === false) return { alive: false, status: "dead" };
      if (res === "unknown") return { alive: true, status: "unknown" };
      return { alive: true, status: "alive" };
    }
    if (this.inspectProcesses) {
      return { alive: true, status: "alive" };
    }
    try {
      process.kill(pid, 0);
      return { alive: true, status: "alive" };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        return { alive: false, status: "dead" };
      }
      if (code === "EPERM" || code === "EACCES") {
        return { alive: true, status: "unknown" };
      }
      return { alive: true, status: "unknown" };
    }
  }

  async heartbeat(sessionID?: string) {
    if (this.ownStartTime === undefined) {
      this.ownStartTime = await resolveCurrentProcessStartTime(this.inspectProcesses);
    }
    await atomicWrite(
      this.file,
      JSON.stringify({
        pid: process.pid,
        sessionID,
        at: Date.now(),
        startedAt: this.ownStartTime,
        exe: process.execPath,
      })
    );
  }

  async read(): Promise<{
    active: Set<string>;
    pids: Set<number>;
    unknownPids: Set<number>;
  }> {
    const active = new Set<string>();
    const pids = new Set<number>();
    const unknownPids = new Set<number>();

    let files: string[];
    try {
      files = await fs.readdir(path.dirname(this.file));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { active, pids, unknownPids };
      }
      throw e;
    }

    const leasesByPid = new Map<number, Array<{
      sessionID?: string;
      at: number;
      startedAt?: number;
      exe?: string;
      file: string;
    }>>();

    for (const name of files.filter(f => f.endsWith(".json"))) {
      let value: any;
      try {
        value = JSON.parse(await fs.readFile(path.join(path.dirname(this.file), name), "utf8"));
      } catch {
        continue;
      }
      if (!Number.isInteger(value.pid) || value.pid <= 0) {
        throw new Error("Registro de instancia inválido.");
      }
      const list = leasesByPid.get(value.pid) ?? [];
      list.push({
        sessionID: typeof value.sessionID === "string" ? value.sessionID : undefined,
        at: typeof value.at === "number" ? value.at : 0,
        startedAt: typeof value.startedAt === "number" ? value.startedAt : undefined,
        exe: typeof value.exe === "string" ? value.exe : undefined,
        file: name,
      });
      leasesByPid.set(value.pid, list);
    }

    if (leasesByPid.size === 0) {
      return { active, pids, unknownPids };
    }

    // Step 1: Preliminary signal check with checkLiveness
    const alivePids: number[] = [];
    for (const pid of leasesByPid.keys()) {
      const liveness = this.checkLiveness(pid);
      if (liveness.status === "dead") {
        continue;
      }
      if (liveness.status === "unknown") {
        unknownPids.add(pid);
        for (const l of leasesByPid.get(pid) ?? []) {
          if (l.sessionID) active.add(l.sessionID);
        }
        continue;
      }
      alivePids.push(pid);
    }

    if (alivePids.length === 0) {
      return { active, pids, unknownPids };
    }

    // Step 2: Bounded batch query of OS process identity
    const inspector = this.inspectProcesses ?? defaultInspectProcesses;
    let procMap: Map<number, ProcessInfo>;
    try {
      procMap = await inspector(alivePids);
    } catch {
      for (const pid of alivePids) {
        unknownPids.add(pid);
        for (const l of leasesByPid.get(pid) ?? []) {
          if (l.sessionID) active.add(l.sessionID);
        }
      }
      return { active, pids, unknownPids };
    }

    // Step 3: Process classification & PID reuse detection
    for (const pid of alivePids) {
      const info = procMap.get(pid);
      const leases = leasesByPid.get(pid) ?? [];

      if (!info || info.status === "dead" || !info.alive) {
        continue;
      }

      if (info.status === "unknown") {
        unknownPids.add(pid);
        for (const l of leases) {
          if (l.sessionID) active.add(l.sessionID);
        }
        continue;
      }

      const classification = classifyProcess({
        name: info.processName,
        executablePath: info.executable,
        commandLine: info.commandLine,
      });

      if (classification === "unrelated") {
        // PID reused by definitively unrelated process (e.g. Chrome, conhost, OpenConsole, kubectl)
        continue;
      }

      let hasValidMatchingLease = false;
      const validSessionIDs: string[] = [];

      for (const lease of leases) {
        if (lease.startedAt !== undefined) {
          // Modern lease: verify process creation time
          if (info.creationTime !== undefined) {
            if (Math.abs(info.creationTime - lease.startedAt) <= 2000) {
              hasValidMatchingLease = true;
              if (lease.sessionID) validSessionIDs.push(lease.sessionID);
            } else {
              // Reused same binary creation changed: not counted for prior lease
            }
          } else {
            unknownPids.add(pid);
            if (lease.sessionID) active.add(lease.sessionID);
          }
        } else {
          // Legacy lease: process is alive and opencode/ambiguous
          // Conservative protection: time alone is not proof of death
          hasValidMatchingLease = true;
          if (lease.sessionID) validSessionIDs.push(lease.sessionID);
        }
      }

      if (hasValidMatchingLease) {
        // Dedup by PID: pids is a Set so it counts as 1 process
        pids.add(pid);
        // Merge active sessions
        for (const sid of validSessionIDs) {
          active.add(sid);
        }
      }
    }

    return { active, pids, unknownPids };
  }

  async close() {
    await fs.rm(this.file, { force: true });
  }
}

