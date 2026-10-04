import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Leases, classifyProcess, type ProcessInfo } from "../src/leases.ts";
import { Store, atomicWrite } from "../src/store.ts";

async function createTempStore(t: any): Promise<Store> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-leases-test-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });
  return new Store(tmpDir);
}

test("PID reused unrelated ignore", async t => {
  const store = await createTempStore(t);
  const unrelatedPid = 44444;

  // Write a lease with a PID that belongs to an unrelated process (e.g. Chrome)
  const instancesDir = path.join(store.dir, "instances");
  await fs.mkdir(instancesDir, { recursive: true });
  await atomicWrite(
    path.join(instancesDir, `${unrelatedPid}-test.json`),
    JSON.stringify({
      pid: unrelatedPid,
      sessionID: "ses_unrelated_chrome",
      at: Date.now() - 60000,
    })
  );

  const mockInspector = async (pids: number[]): Promise<Map<number, ProcessInfo>> => {
    const map = new Map<number, ProcessInfo>();
    for (const p of pids) {
      if (p === unrelatedPid) {
        map.set(p, {
          pid: p,
          alive: true,
          status: "alive",
          processName: "chrome",
          executable: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          commandLine: "chrome.exe --type=renderer",
          creationTime: Date.now() - 3600000,
        });
      }
    }
    return map;
  };

  const leases = new Leases(store, { inspectProcesses: mockInspector });
  const result = await leases.read();

  assert.equal(result.pids.has(unrelatedPid), false, "Unrelated recycled PID must NOT be counted in pids");
  assert.equal(result.active.has("ses_unrelated_chrome"), false, "Unrelated process sessionID must NOT be added to active");
});

test("matching start live", async t => {
  const store = await createTempStore(t);
  const livePid = 55555;
  const startTime = Date.now() - 120000;

  const instancesDir = path.join(store.dir, "instances");
  await fs.mkdir(instancesDir, { recursive: true });
  await atomicWrite(
    path.join(instancesDir, `${livePid}-test.json`),
    JSON.stringify({
      pid: livePid,
      sessionID: "ses_live_opencode",
      at: Date.now() - 5000,
      startedAt: startTime,
      exe: "C:\\opencode\\opencode.exe",
    })
  );

  const mockInspector = async (pids: number[]): Promise<Map<number, ProcessInfo>> => {
    const map = new Map<number, ProcessInfo>();
    for (const p of pids) {
      if (p === livePid) {
        map.set(p, {
          pid: p,
          alive: true,
          status: "alive",
          processName: "opencode",
          executable: "C:\\opencode\\opencode.exe",
          commandLine: "opencode.exe",
          creationTime: startTime,
        });
      }
    }
    return map;
  };

  const leases = new Leases(store, { inspectProcesses: mockInspector });
  const result = await leases.read();

  assert.equal(result.pids.has(livePid), true, "Live matching OpenCode process must be in pids");
  assert.equal(result.active.has("ses_live_opencode"), true, "Live matching OpenCode session must be active");
});

test("reused same binary creation changed not counted prior lease", async t => {
  const store = await createTempStore(t);
  const recycledPid = 66666;
  const priorStartTime = Date.now() - 3600000; // Lease was from 1 hour ago
  const newProcessStartTime = Date.now() - 60000; // New process with same binary started 1 min ago

  const instancesDir = path.join(store.dir, "instances");
  await fs.mkdir(instancesDir, { recursive: true });
  await atomicWrite(
    path.join(instancesDir, `${recycledPid}-test.json`),
    JSON.stringify({
      pid: recycledPid,
      sessionID: "ses_prior_dead_instance",
      at: Date.now() - 3500000,
      startedAt: priorStartTime,
      exe: "C:\\opencode\\opencode.exe",
    })
  );

  const mockInspector = async (pids: number[]): Promise<Map<number, ProcessInfo>> => {
    const map = new Map<number, ProcessInfo>();
    for (const p of pids) {
      if (p === recycledPid) {
        // Same binary, but creation time is DIFFERENT!
        map.set(p, {
          pid: p,
          alive: true,
          status: "alive",
          processName: "opencode",
          executable: "C:\\opencode\\opencode.exe",
          commandLine: "opencode.exe",
          creationTime: newProcessStartTime,
        });
      }
    }
    return map;
  };

  const leases = new Leases(store, { inspectProcesses: mockInspector });
  const result = await leases.read();

  assert.equal(result.pids.has(recycledPid), false, "Prior lease must NOT count if creation time changed");
  assert.equal(result.active.has("ses_prior_dead_instance"), false, "Prior lease session must NOT be active");
});

test("legacy ambiguous", async t => {
  const store = await createTempStore(t);
  const ambiguousPid = 77777;

  // Legacy lease without startedAt
  const instancesDir = path.join(store.dir, "instances");
  await fs.mkdir(instancesDir, { recursive: true });
  await atomicWrite(
    path.join(instancesDir, `${ambiguousPid}-legacy.json`),
    JSON.stringify({
      pid: ambiguousPid,
      sessionID: "ses_legacy_ambiguous",
      at: Date.now() - 60000,
    })
  );

  const mockInspector = async (pids: number[]): Promise<Map<number, ProcessInfo>> => {
    const map = new Map<number, ProcessInfo>();
    for (const p of pids) {
      if (p === ambiguousPid) {
        // Node process without clear command line -> ambiguous
        map.set(p, {
          pid: p,
          alive: true,
          status: "alive",
          processName: "node",
          executable: "C:\\Program Files\\nodejs\\node.exe",
          commandLine: undefined,
          creationTime: Date.now() - 120000,
        });
      }
    }
    return map;
  };

  const leases = new Leases(store, { inspectProcesses: mockInspector });
  const result = await leases.read();

  assert.equal(result.pids.has(ambiguousPid), true, "Legacy ambiguous process must be conservatively protected in pids");
  assert.equal(result.active.has("ses_legacy_ambiguous"), true, "Legacy ambiguous session must be active");
});

test("process lookup denied unknown blocks delete doesn't break preview", async t => {
  const store = await createTempStore(t);
  const deniedPid = 88888;

  const instancesDir = path.join(store.dir, "instances");
  await fs.mkdir(instancesDir, { recursive: true });
  await atomicWrite(
    path.join(instancesDir, `${deniedPid}-test.json`),
    JSON.stringify({
      pid: deniedPid,
      sessionID: "ses_denied",
      at: Date.now() - 10000,
    })
  );

  const mockInspector = async (pids: number[]): Promise<Map<number, ProcessInfo>> => {
    const map = new Map<number, ProcessInfo>();
    for (const p of pids) {
      if (p === deniedPid) {
        map.set(p, {
          pid: p,
          alive: true,
          status: "unknown",
          error: new Error("EPERM: operation not permitted"),
        });
      }
    }
    return map;
  };

  const leases = new Leases(store, { inspectProcesses: mockInspector, isPidAlive: () => "unknown" });
  // Preview / read does NOT throw
  const result = await leases.read();
  assert.equal(result.unknownPids.has(deniedPid), true, "Denied process must be recorded in unknownPids");
  assert.equal(result.active.has("ses_denied"), true, "Denied process session is conservatively protected");

  // But destructive delete (allowed gate) MUST block
  const allowedCheck = async () => {
    const other = await leases.read();
    if (other.unknownPids && other.unknownPids.size > 0) {
      throw new Error("Estado de proceso desconocido o acceso denegado. Limpieza suspendida por seguridad.");
    }
    if (other.pids.size > 1) {
      throw new Error("Cierra las otras instancias de OpenCode antes de limpiar.");
    }
  };

  await assert.rejects(
    allowedCheck,
    /desconocido o acceso denegado/,
    "Unknown process status must block destructive delete"
  );
});

test("two genuine owners blocks", async t => {
  const store = await createTempStore(t);
  const pid1 = 11111;
  const pid2 = 22222;
  const now = Date.now();

  const instancesDir = path.join(store.dir, "instances");
  await fs.mkdir(instancesDir, { recursive: true });
  await atomicWrite(
    path.join(instancesDir, `${pid1}-test.json`),
    JSON.stringify({
      pid: pid1,
      sessionID: "ses_owner_1",
      at: now,
      startedAt: now - 50000,
      exe: "opencode",
    })
  );
  await atomicWrite(
    path.join(instancesDir, `${pid2}-test.json`),
    JSON.stringify({
      pid: pid2,
      sessionID: "ses_owner_2",
      at: now,
      startedAt: now - 40000,
      exe: "opencode",
    })
  );

  const mockInspector = async (pids: number[]): Promise<Map<number, ProcessInfo>> => {
    const map = new Map<number, ProcessInfo>();
    for (const p of pids) {
      map.set(p, {
        pid: p,
        alive: true,
        status: "alive",
        processName: "opencode",
        executable: "C:\\opencode\\opencode.exe",
        creationTime: p === pid1 ? now - 50000 : now - 40000,
      });
    }
    return map;
  };

  const leases = new Leases(store, { inspectProcesses: mockInspector });
  const result = await leases.read();

  assert.equal(result.pids.size, 2, "Both genuine OpenCode processes must be recognized");

  const allowedCheck = async () => {
    const other = await leases.read();
    if (other.unknownPids && other.unknownPids.size > 0) {
      throw new Error("Estado de proceso desconocido o acceso denegado.");
    }
    if (other.pids.size > 1) {
      throw new Error("Cierra las otras instancias de OpenCode antes de limpiar. Puedes seguir revisando y poniendo candados.");
    }
  };

  await assert.rejects(
    allowedCheck,
    /Cierra las otras instancias de OpenCode antes de limpiar/,
    "Two genuine owners must block cleanup"
  );
});

test("samePIDmultiplelease dedup conservatively merge active", async t => {
  const store = await createTempStore(t);
  const pid = 33333;
  const startTime = Date.now() - 90000;

  const instancesDir = path.join(store.dir, "instances");
  await fs.mkdir(instancesDir, { recursive: true });

  // Same PID has 3 lease files with different active sessions
  await atomicWrite(
    path.join(instancesDir, `${pid}-window1.json`),
    JSON.stringify({
      pid,
      sessionID: "ses_alpha",
      at: Date.now() - 1000,
      startedAt: startTime,
      exe: "opencode",
    })
  );
  await atomicWrite(
    path.join(instancesDir, `${pid}-window2.json`),
    JSON.stringify({
      pid,
      sessionID: "ses_beta",
      at: Date.now() - 500,
      startedAt: startTime,
      exe: "opencode",
    })
  );
  await atomicWrite(
    path.join(instancesDir, `${pid}-window3.json`),
    JSON.stringify({
      pid,
      at: Date.now() - 200,
      startedAt: startTime,
      exe: "opencode",
    })
  );

  const mockInspector = async (pids: number[]): Promise<Map<number, ProcessInfo>> => {
    const map = new Map<number, ProcessInfo>();
    for (const p of pids) {
      if (p === pid) {
        map.set(p, {
          pid: p,
          alive: true,
          status: "alive",
          processName: "opencode",
          executable: "C:\\opencode\\opencode.exe",
          creationTime: startTime,
        });
      }
    }
    return map;
  };

  const leases = new Leases(store, { inspectProcesses: mockInspector });
  const result = await leases.read();

  assert.equal(result.pids.size, 1, "Multiple leases with same PID must be deduplicated to 1 process");
  assert.equal(result.pids.has(pid), true);
  assert.equal(result.active.has("ses_alpha"), true, "Session alpha must be merged into active");
  assert.equal(result.active.has("ses_beta"), true, "Session beta must be merged into active");
});

test("stalled real process stays protected", async t => {
  const store = await createTempStore(t);
  const stalledPid = 99999;
  const startTime = Date.now() - 7200000; // 2 hours ago
  const stalledHeartbeat = Date.now() - 3600000; // Heartbeat stalled 1 hour ago

  const instancesDir = path.join(store.dir, "instances");
  await fs.mkdir(instancesDir, { recursive: true });
  await atomicWrite(
    path.join(instancesDir, `${stalledPid}-stalled.json`),
    JSON.stringify({
      pid: stalledPid,
      sessionID: "ses_stalled_real_process",
      at: stalledHeartbeat,
      startedAt: startTime,
      exe: "opencode",
    })
  );

  const mockInspector = async (pids: number[]): Promise<Map<number, ProcessInfo>> => {
    const map = new Map<number, ProcessInfo>();
    for (const p of pids) {
      if (p === stalledPid) {
        map.set(p, {
          pid: p,
          alive: true,
          status: "alive",
          processName: "opencode",
          executable: "C:\\opencode\\opencode.exe",
          creationTime: startTime,
        });
      }
    }
    return map;
  };

  const leases = new Leases(store, { inspectProcesses: mockInspector });
  const result = await leases.read();

  assert.equal(result.pids.has(stalledPid), true, "Live but stalled real process must remain protected");
  assert.equal(result.active.has("ses_stalled_real_process"), true, "Stalled process session must remain active");
});

test("Side effect read no unlink leases: preserves all files on disk", async t => {
  const store = await createTempStore(t);
  const instancesDir = path.join(store.dir, "instances");
  await fs.mkdir(instancesDir, { recursive: true });

  // Write 3 lease files (dead, unrelated, live)
  await atomicWrite(path.join(instancesDir, "1111-dead.json"), JSON.stringify({ pid: 1111, at: 1000 }));
  await atomicWrite(path.join(instancesDir, "2222-chrome.json"), JSON.stringify({ pid: 2222, at: 2000 }));
  await atomicWrite(path.join(instancesDir, "3333-live.json"), JSON.stringify({ pid: 3333, at: 3000 }));

  const mockInspector = async (pids: number[]): Promise<Map<number, ProcessInfo>> => {
    const map = new Map<number, ProcessInfo>();
    map.set(2222, { pid: 2222, alive: true, status: "alive", processName: "chrome" });
    map.set(3333, { pid: 3333, alive: true, status: "alive", processName: "opencode" });
    return map;
  };

  const leases = new Leases(store, { inspectProcesses: mockInspector });
  await leases.read();

  const filesAfter = await fs.readdir(instancesDir);
  assert.equal(filesAfter.length, 3, "leases.read() must NEVER unlink or delete lease files; preserves all artifacts");
});
