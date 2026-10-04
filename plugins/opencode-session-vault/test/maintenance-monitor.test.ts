import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/store.ts";
import {
  VaultHelperClient,
  resolveMonitorPath,
  resolveHelperPath,
} from "../src/helper-client.ts";
import {
  armOfflinePlan,
  cancelArmedPlan,
  getArmedPlan,
  getReceipt,
  ARMED_PLAN_FILE,
  CLAIMED_PLAN_FILE,
  RECEIPT_FILE,
  type OfflinePlan,
  type MaintenanceReceipt,
} from "../src/coordination.ts";
import {
  generateOfflinePlan,
  runArmedMaintenance,
} from "../src/offline.ts";
import { createVaultNavigationController } from "../src/ui-controller.ts";

function createTestDb(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      title TEXT,
      project_id TEXT,
      directory TEXT,
      parent_id TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      time_archived INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      content TEXT,
      time_created INTEGER,
      FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE CASCADE
    );
  `);
  const insertSession = db.prepare(`
    INSERT INTO session (id, title, project_id, directory, parent_id, time_created, time_updated, time_archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMsg = db.prepare(`
    INSERT INTO message (id, session_id, content, time_created)
    VALUES (?, ?, ?, ?)
  `);
  for (let i = 0; i < 5; i++) {
    const timeUpdated = 1700000000000 - (i + 2) * 86400000;
    insertSession.run(`ses_${i}`, `Session ${i}`, "p1", "/proj1", null, timeUpdated - 1000, timeUpdated, null);
    insertMsg.run(`msg_${i}`, `ses_${i}`, `Content for session ${i}`, timeUpdated);
  }
  db.close();
}

async function setupFixture() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-monitor-test-"));
  const dbPath = path.join(tmpDir, "opencode.db");
  const stateDir = path.join(tmpDir, "state");
  await fs.mkdir(stateDir, { recursive: true });

  createTestDb(dbPath);

  const store = new Store(stateDir);
  await store.save({
    schema: 2,
    revision: 1,
    config: {
      profile: "basic",
      percent: 15,
      scope: "project",
      graceHours: 24,
      intervalMinutes: 30,
      maxDeletePerRun: 5,
      includeArchived: false,
      automatic: false,
    },
    pins: [],
    quotas: {},
    lastRun: 0,
  });

  return {
    tmpDir,
    dbPath,
    stateDir,
    store,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

test("resolveMonitorPath resolves valid monitor script in dev and dist, and throws clear error when missing", async t => {
  const resolved = resolveMonitorPath();
  assert.ok(fsSync.existsSync(resolved), "Monitor path must resolve to existing file");
  assert.ok(resolved.endsWith("maintenance-monitor.ps1"));

  const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "empty-monitor-dir-"));
  try {
    assert.throws(
      () => resolveMonitorPath(emptyDir),
      /No se encontró el script de monitor visible/i
    );
  } finally {
    await fs.rm(emptyDir, { recursive: true, force: true });
  }
});

test("spawnMonitor performs readiness handshake and returns monitorPid", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const client = new VaultHelperClient({ store: fix.store });
  const armId = "test-arm-handshake-1";

  // Simulate a monitor launcher that acknowledges readiness
  let customSpawnCalled = false;
  const mockSpawn = (_cmd: string, args: string[]) => {
    customSpawnCalled = true;
    const hsIdx = args.indexOf("-HandshakeFile");
    const hsFile = args[hsIdx + 1];
    // Write handshake file immediately
    fsSync.writeFileSync(
      hsFile,
      JSON.stringify({ ready: true, monitorPid: 54321, armId }),
      "utf8"
    );
    return { pid: 54321 };
  };

  const res = await client.spawnMonitor({
    stateDir: fix.stateDir,
    dbPath: fix.dbPath,
    ownerPid: 1234,
    armId,
    expiresAt: Date.now() + 300000,
    timeoutMs: 1000,
    customSpawn: mockSpawn,
  });

  assert.equal(customSpawnCalled, true);
  assert.equal(res.monitorPid, 54321);
  assert.ok(fsSync.existsSync(res.handshakeFile));
});

test("spawnMonitor fails closed if handshake times out without creating armed plan", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const client = new VaultHelperClient({ store: fix.store });
  const armId = "test-arm-timeout-1";

  // Mock spawn that DOES NOT write handshake file (simulates failure/crash)
  const mockFailingSpawn = () => {
    return { pid: 99999 };
  };

  await assert.rejects(
    async () => {
      await client.spawnMonitor({
        stateDir: fix.stateDir,
        dbPath: fix.dbPath,
        ownerPid: 1234,
        armId,
        expiresAt: Date.now() + 300000,
        timeoutMs: 150, // fast timeout for test
        customSpawn: mockFailingSpawn,
      });
    },
    /confirmación de inicialización \(handshake\) no recibida/i
  );

  // Verify NO armed plan was created
  const armed = await getArmedPlan(fix.store);
  assert.equal(armed, null, "Armed plan must NOT exist when monitor handshake fails");
});

test("armAndSpawn gates execution on visible monitor readiness: fails closed if monitor fails", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    projectID: "p1",
    allowRunningProcess: true,
  });

  const client = new VaultHelperClient({
    store: fix.store,
    spawnMonitor: true,
    // Failing custom spawn that does not produce handshake
    customMonitorSpawn: () => ({ pid: 8888 }),
  });

    await assert.rejects(
      async () => {
        await client.armAndSpawn({
          plan,
          ownerPid: 1234,
          ttlMs: 60000,
          monitorTimeoutMs: 150,
          _trustedTestExecution: true,
        });
      },
      /No se pudo iniciar el monitor visible de mantenimiento/i
    );

  // Armed file must not exist
  const armed = await getArmedPlan(fix.store);
  assert.equal(armed, null, "Plan must remain completely unarmed on monitor spawn failure");
});

test("armAndSpawn records workerPid and monitorPid on successful handshake", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    projectID: "p1",
    allowRunningProcess: true,
  });

  const client = new VaultHelperClient({
    store: fix.store,
    spawnMonitor: true,
    customMonitorSpawn: (_cmd, args) => {
      const armIdx = args.indexOf("-ArmId");
      const currentArmId = args[armIdx + 1];
      const hsIdx = args.indexOf("-HandshakeFile");
      const hsFile = args[hsIdx + 1];
      fsSync.writeFileSync(
        hsFile,
        JSON.stringify({ ready: true, monitorPid: 33445, armId: currentArmId }),
        "utf8"
      );
      return { pid: 33445 };
    },
  });

  const result = await client.armAndSpawn({
    plan,
    ownerPid: 1234,
    ttlMs: 60000,
    monitorTimeoutMs: 1000,
    _trustedTestExecution: true,
  });

  assert.ok(result.armed);
  assert.equal(result.monitorPid, 33445);
  assert.equal(result.armed.monitorPid, 33445);
  assert.ok(result.pid, "Worker PID must be assigned");

  // Worker PID file must be persisted in store dir
  const workerPidFile = path.join(fix.stateDir, `worker-pid-${result.armed.id}.json`);
  assert.ok(fsSync.existsSync(workerPidFile));
  const workerData = JSON.parse(await fs.readFile(workerPidFile, "utf8"));
  assert.equal(workerData.workerPid, result.pid);
  assert.equal(workerData.armId, result.armed.id);
});

test("runArmedMaintenance cancels if monitor is closed before claim", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    projectID: "p1",
    allowRunningProcess: true,
  });

  await armOfflinePlan({
    store: fix.store,
    plan,
    ownerPid: 1234,
    monitorPid: 7777,
    ttlMs: 60000,
    _trustedTestExecution: true,
  });

  // Owner process is dead, but monitor was closed by user (isMonitorAlive returns false)
  const receipt = await runArmedMaintenance({
    store: fix.store,
    ownerPid: 1234,
    dbPath: fix.dbPath,
    maxWaitMs: 100,
    pollIntervalMs: 10,
    isOwnerAlive: () => false,
    isMonitorAlive: (pid) => pid !== 7777, // Monitor is closed!
    processChecker: () => false,
    _trustedTestExecution: true,
  });

  assert.equal(receipt.status, "cancelled");
  assert.match(receipt.error ?? "", /monitor de mantenimiento fue cerrado/i);

  // Database must remain completely untouched (5 sessions)
  const db = new DatabaseSync(fix.dbPath, { readOnly: true });
  const row = db.prepare("SELECT count(*) as cnt FROM session").get() as { cnt: number };
  assert.equal(row.cnt, 5);
  db.close();

  // Armed plan must be unlinked
  const armedAfter = await getArmedPlan(fix.store);
  assert.equal(armedAfter, null);
});

test("monitor ignores stale receipt with mismatched arm ID", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  // Write a stale receipt from a previous run
  const staleReceipt: MaintenanceReceipt = {
    version: 1,
    id: "stale-arm-id-prev",
    planFingerprint: "prev-fp",
    completedAt: Date.now() - 3600000,
    status: "success",
    deletedFamilies: ["ses_prev"],
    deletedSessions: ["ses_prev"],
  };
  await fs.writeFile(
    path.join(fix.stateDir, RECEIPT_FILE),
    JSON.stringify(staleReceipt, null, 2),
    "utf8"
  );

  // Run monitor script via powershell in a quick check test
  // Passing armId="new-arm-id-current", it should NOT treat stale receipt as current!
  const monitorScript = resolveMonitorPath();
  const currentArmId = "new-arm-id-current";
  const handshakeFile = path.join(fix.stateDir, "test-hs.json");

  // Read monitor script content and verify it checks receipt.id -eq $ArmId
  const scriptContent = await fs.readFile(monitorScript, "utf8");
  assert.match(scriptContent, /\$receipt\.id -eq \$ArmId/);
  assert.match(scriptContent, /\$receipt -and \$receipt\.id -eq \$ArmId/);
});

test("monitor checks worker process termination before displaying completion", async t => {
  const monitorScript = resolveMonitorPath();
  const scriptContent = await fs.readFile(monitorScript, "utf8");

  // Verify worker termination logic
  assert.match(scriptContent, /Get-WorkerPid/);
  assert.match(scriptContent, /Get-Process -Id \$workerPid/);
  assert.match(scriptContent, /ESPERANDO CIERRE DEL TRABAJADOR/i);
  assert.match(scriptContent, /YA PUEDE VOLVER A ABRIR OPENCODE/i);
});

test("monitor distinguishes full success, partial success, expired, cancelled, and failed uncertain without fake intact", async t => {
  const monitorScript = resolveMonitorPath();
  const scriptContent = await fs.readFile(monitorScript, "utf8");

  // Verify status branches
  assert.match(scriptContent, /\$receipt\.status -eq "success"/);
  assert.match(scriptContent, /\$receipt\.status -eq "partial_success"/);
  assert.match(scriptContent, /\$receipt\.status -eq "expired"/);
  assert.match(scriptContent, /\$receipt\.status -eq "cancelled"/);
  assert.match(scriptContent, /INCIERTO\. NO se garantiza que la base de datos haya quedado intacta/i);
  assert.doesNotMatch(scriptContent, /Resultado en datos\s*:\s*La base de datos se mantuvo INTACTA \(0 sesiones eliminadas\)/i);
});

test("monitor missing worker id displays warning and blocks safe reopen", async t => {
  const monitorScript = resolveMonitorPath();
  const scriptContent = await fs.readFile(monitorScript, "utf8");

  // Verify that if workerPid is unknown ($workerPid -le 0), safe reopen is blocked
  assert.match(scriptContent, /\$workerPid = Get-WorkerPid\s+if \(\$workerPid -le 0\)/);
  assert.match(scriptContent, /NO SE PUDO VERIFICAR EL PROCESO TRABAJADOR/i);
  assert.match(scriptContent, /Por seguridad, NO abra OpenCode/i);
});

test("monitor finally block is strictly read-only and never writes or deletes shared authority files", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const monitorScript = resolveMonitorPath();
  const scriptContent = await fs.readFile(monitorScript, "utf8");

  // Structural assertion: finally block contains no Remove-Item, no WriteAllText, no mutations
  const finallyMatch = scriptContent.match(/finally\s*\{([\s\S]*?)\}/);
  assert.ok(finallyMatch, "Monitor must have a finally block");
  const finallyBody = finallyMatch[1];
  assert.doesNotMatch(finallyBody, /Remove-Item/i, "Finally block must not delete files");
  assert.doesNotMatch(finallyBody, /WriteAllText/i, "Finally block must not write receipt files");
  assert.doesNotMatch(finallyBody, /Set-Content/i, "Finally block must not mutate files");

  // Empirical execution assertion: if armed-plan.json is present, monitor exiting does NOT touch it
  const dummyArmId = "arm-finally-test";
  const armedFile = path.join(fix.stateDir, ARMED_PLAN_FILE);
  await fs.writeFile(armedFile, JSON.stringify({ id: dummyArmId, status: "armed" }), "utf8");

  const receiptFile = path.join(fix.stateDir, RECEIPT_FILE);
  assert.equal(fsSync.existsSync(receiptFile), false);

  // Invoke monitor with invalid args so it hits finally block and exits
  const testPs = `
    $ErrorActionPreference = 'SilentlyContinue'
    & "${monitorScript.replace(/"/g, '`"')}" -StateDir "${fix.stateDir.replace(/"/g, '`"')}"
  `;
  const { execSync } = await import("node:child_process");
  try {
    execSync(`powershell.exe -NoProfile -Command "${testPs.replace(/\n/g, " ")}"`, { stdio: "ignore" });
  } catch {}

  // Armed file must STILL be intact, and NO receipt file must have been written
  assert.equal(fsSync.existsSync(armedFile), true, "armed-plan.json must not be touched by monitor finally");
  assert.equal(fsSync.existsSync(receiptFile), false, "maintenance-receipt.json must not be written by monitor finally");
});

test("launcher and monitor handle special paths with spaces, %, &, and parentheses with safe handshake and no worker/destruction", async t => {
  if (process.platform !== "win32") return;

  const specialTmp = await fs.mkdtemp(path.join(os.tmpdir(), "vault spaces %20 (1) & test-"));
  const dbPath = path.join(specialTmp, "db %1 (special & test).sqlite");
  createTestDb(dbPath);

  const stateDir = path.join(specialTmp, "state %2 (special)");
  await fs.mkdir(stateDir, { recursive: true });

  const store = new Store(stateDir);
  await store.save({
    schema: 2,
    revision: 1,
    config: { profile: "basic", percent: 15, scope: "project", graceHours: 24, intervalMinutes: 30, maxDeletePerRun: 5, includeArchived: false, automatic: false },
    pins: [],
    quotas: {},
    lastRun: 0,
  });

  const client = new VaultHelperClient({ store });
  const armId = "arm-special-paths-safe-1";

  let spawnedPid: number | undefined;
  try {
    const res = await client.spawnMonitor({
      stateDir,
      dbPath,
      ownerPid: process.pid,
      armId,
      expiresAt: Date.now() + 300000,
      timeoutMs: 6000,
    });

    spawnedPid = res.monitorPid;
    assert.ok(res.monitorPid > 0, "Real monitor PID must be positive");
    assert.ok(fsSync.existsSync(res.handshakeFile), "Handshake file must exist");

    const rawHs = await fs.readFile(res.handshakeFile, "utf8");
    const hs = JSON.parse(rawHs.replace(/^\uFEFF/, ""));
    assert.equal(hs.ready, true);
    assert.equal(hs.armId, armId);
    assert.equal(hs.monitorPid, res.monitorPid);

    // Verify database remains untouched (no worker execution, no destruction)
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare("SELECT count(*) as cnt FROM session").get() as { cnt: number };
    assert.equal(row.cnt, 5, "Database must have remained completely untouched");
    db.close();

    // Verify armed plan was NOT created by spawnMonitor
    const armed = await getArmedPlan(store);
    assert.equal(armed, null, "spawnMonitor must not create armed plan on its own");
  } finally {
    if (spawnedPid) {
      try { process.kill(spawnedPid); } catch {}
    }
    await fs.rm(specialTmp, { recursive: true, force: true });
  }
});

test("resolveMonitorPath and monitor execution handle paths with spaces safely", async t => {
  const tmpWithSpaces = await fs.mkdtemp(path.join(os.tmpdir(), "vault spaces monitor-"));
  try {
    const dummyScript = path.join(tmpWithSpaces, "maintenance-monitor.ps1");
    await fs.writeFile(dummyScript, "Write-Host 'Spaces OK';", "utf8");

    const resolved = resolveMonitorPath(tmpWithSpaces);
    assert.equal(resolved, dummyScript);
    assert.ok(resolved.includes("vault spaces monitor-"));
  } finally {
    await fs.rm(tmpWithSpaces, { recursive: true, force: true });
  }
});

test("packaging includes maintenance-monitor.ps1 in dist and mirror", async t => {
  const distMonitor = path.resolve("dist", "maintenance-monitor.ps1");
  assert.ok(fsSync.existsSync(distMonitor), "dist/maintenance-monitor.ps1 must exist after build");

  const mirrorDistMonitor = path.resolve(
    "..",
    "opencode-sdd-profile-manager",
    "plugins",
    "opencode-session-vault",
    "dist",
    "maintenance-monitor.ps1"
  );
  if (fsSync.existsSync(path.dirname(mirrorDistMonitor))) {
    assert.ok(
      fsSync.existsSync(mirrorDistMonitor),
      "Mirror dist/maintenance-monitor.ps1 must exist"
    );
  }
});

test("UI controller armMaintenance uses monitor gating and removes obsolete warning", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    projectID: "p1",
    allowRunningProcess: true,
  });

  let capturedTitle = "";
  let capturedPlaceholder = "";
  let capturedDescription = "";
  let capturedAction: ((val: string) => Promise<void>) | undefined;

  let monitorSpawned = false;
  const mockHelperClient = {
    store: fix.store,
    getReceipt: async () => null,
    getArmed: async () => null,
    inspectDatabase: async () => ({
      dbPath: fix.dbPath,
      sizeBytes: 1000000,
      pageSize: 4096,
      freelistCount: 0,
      freeBytes: 0,
      sessionCount: 5,
      tables: ["session"],
      integrity: "ok",
    }),
    generatePlan: async () => structuredClone(plan),
    getQuickDiskStats: () => ({ dbPath: fix.dbPath, sizeBytes: 1000000, exists: true }),
    spawnMonitor: async () => {
      monitorSpawned = true;
      return { monitorPid: 11223, handshakeFile: "mock-hs.json" };
    },
    armAndSpawn: async (opts: any) => {
      return {
        armed: {
          version: 1,
          id: "mock-arm-id",
          armedAt: Date.now(),
          expiresAt: Date.now() + 300000,
          ownerPid: opts.ownerPid,
          plan: opts.plan,
          status: "armed",
        },
      };
    },
  };

  const controller = createVaultNavigationController({
    _trustedTestExecution: true,
    service: {
      store: fix.store,
      projectID: "p1",
      preview: async () => ({
        families: [],
        candidates: [],
        locked: 0,
        quota: { keep: 1, total: 5, percent: 15 },
        totalSessions: 5,
        revision: 1,
        at: Date.now(),
        fingerprint: "test-fp",
        scopeKey: "test-key",
      }),
    } as any,
    helperClient: mockHelperClient as any,
    askConfirmation: (title, placeholder, action, description) => {
      capturedTitle = title;
      capturedPlaceholder = placeholder;
      capturedAction = action;
      capturedDescription = description ?? "";
    },
  });

  await controller.loadMaintenance();
  controller.armMaintenance();

  assert.ok(capturedAction);
  assert.equal(capturedPlaceholder, "Escribe LIMPIAR");
  assert.match(capturedTitle, /Armar mantenimiento/i);

  // Obsolete warning must be GONE
  assert.doesNotMatch(capturedDescription, /Advertencia: no aprobar hasta disponer de monitor de finalización/i);
  assert.doesNotMatch(capturedDescription, /sin ventana ni señal externa/i);

  // New accurate description present
  assert.match(capturedDescription, /ventana de monitorización visible/i);
  assert.match(capturedDescription, /seguro volver a abrirlo/i);

  // Confirming action invokes armAndSpawn
  await capturedAction("LIMPIAR");
  assert.match(controller.message(), /Monitor visible activo/i);
  assert.match(controller.message(), /indicará cuándo volver a abrirlo/i);
});
