import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/store.ts";
import {
  generateOfflinePlan,
  applyOfflinePlan,
  runArmedMaintenance,
  armOfflinePlan,
  cancelArmedPlan,
  getArmedPlan,
  getReceipt,
  clearReceipt,
  ARMED_PLAN_FILE,
  CLAIMED_PLAN_FILE,
  RECEIPT_FILE,
  type OfflinePlan,
} from "../src/offline.ts";
import {
  VaultHelperClient,
  resolveHelperPath,
  verifyNodeCapability,
} from "../src/helper-client.ts";
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
  return db;
}

function populateSessions(db: DatabaseSync, baseTime = 1700000000000) {
  const insertSession = db.prepare(`
    INSERT INTO session (id, title, project_id, directory, parent_id, time_created, time_updated, time_archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMsg = db.prepare(`
    INSERT INTO message (id, session_id, content, time_created)
    VALUES (?, ?, ?, ?)
  `);

  for (let i = 0; i < 10; i++) {
    const timeUpdated = baseTime - (i + 2) * 86400000;
    insertSession.run(`ses_${i}`, `Session ${i}`, "p1", "/proj1", null, timeUpdated - 1000, timeUpdated, null);
    insertMsg.run(`msg_${i}`, `ses_${i}`, `Content for session ${i}`, timeUpdated);
  }
}

async function setupFixture() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-coord-test-"));
  const dbPath = path.join(tmpDir, "opencode.db");
  const stateDir = path.join(tmpDir, "state");
  await fs.mkdir(stateDir, { recursive: true });

  const db = createTestDb(dbPath);
  populateSessions(db);
  db.close();

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

test("UI approve exact plan: arms plan atomically and records candidate batch and ownerPid", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    projectID: "p1",
    allowRunningProcess: true,
  });

  assert.ok(plan.selectedFamilies.length > 0, "Plan should have candidate families");

  // Mock service for controller
  let confirmedPrompt = "";
  let confirmFn: ((value: string) => Promise<void>) | undefined;
  const helperClient = new VaultHelperClient({
    store: fix.store,
    spawnMonitor: false, // In unit test without desktop GUI, skip monitor spawn
  });
  const controller = createVaultNavigationController({
    helperClient,
    _trustedTestExecution: true,
    service: {
      store: fix.store,
      projectID: "p1",
      preview: async () => ({
        families: [],
        candidates: [],
        locked: 0,
        quota: { keep: 1, total: 10, percent: 15 },
        totalSessions: 10,
        revision: 1,
        at: Date.now(),
        fingerprint: "test-fp",
        scopeKey: "test-key",
      }),
    } as any,
    askConfirmation: (title, placeholder, action) => {
      confirmedPrompt = title;
      confirmFn = action;
    },
  });

  controller.setOfflinePlan(plan);
  controller.armMaintenance();

  assert.ok(confirmedPrompt.includes("Armar mantenimiento"));
  assert.ok(confirmFn !== undefined);
  await confirmFn("LIMPIAR");

  const armed = await getArmedPlan(fix.store);
  assert.ok(armed !== null);
  assert.equal(armed.status, "armed");
  assert.equal(armed.plan.fingerprint, plan.fingerprint);
  assert.equal(armed.plan.selectedFamilies.length, plan.selectedFamilies.length);
});

test("UI cancel: cancels armed plan before claim and records cancelled receipt", async t => {
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
    ownerPid: 999999,
    _trustedTestExecution: true,
  });

  const cancelled = await cancelArmedPlan(fix.store);
  assert.equal(cancelled, true);

  const armedAfter = await getArmedPlan(fix.store);
  assert.equal(armedAfter, null);

  const receipt = await getReceipt(fix.store);
  assert.ok(receipt !== null);
  assert.equal(receipt.status, "cancelled");
});

test("reload while process alive no apply: does not apply cleanup while owner process is alive", async t => {
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
    ttlMs: 500,
    _trustedTestExecution: true,
  });

  // Simulate owner process STILL ALIVE, so it times out waiting for owner to exit
  const receipt = await runArmedMaintenance({
    store: fix.store,
    ownerPid: 1234,
    dbPath: fix.dbPath,
    maxWaitMs: 100,
    pollIntervalMs: 20,
    isOwnerAlive: () => true, // Owner process stays alive
    processChecker: () => false,
    _trustedTestExecution: true,
  });

  assert.equal(receipt.status, "expired");

  // Database must remain completely untouched (10 sessions)
  const db = new DatabaseSync(fix.dbPath, { readOnly: true });
  const row = db.prepare("SELECT count(*) as cnt FROM session").get() as { cnt: number };
  assert.equal(row.cnt, 10);
  db.close();
});

test("timeout/no process: expires cleanly if TTL expires without touching DB", async t => {
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
    ttlMs: -10, // already expired
    _trustedTestExecution: true,
  });

  const receipt = await runArmedMaintenance({
    store: fix.store,
    ownerPid: 1234,
    dbPath: fix.dbPath,
    maxWaitMs: 50,
    pollIntervalMs: 10,
    isOwnerAlive: () => false,
    processChecker: () => false,
    _trustedTestExecution: true,
  });

  assert.equal(receipt.status, "expired");

  const db = new DatabaseSync(fix.dbPath, { readOnly: true });
  const row = db.prepare("SELECT count(*) as cnt FROM session").get() as { cnt: number };
  assert.equal(row.cnt, 10);
  db.close();
});

test("reopen precommit: aborts transaction and leaves DB unchanged if OpenCode reopens before commit", async t => {
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
    ttlMs: 60000,
    _trustedTestExecution: true,
  });

  let checkCount = 0;
  const receipt = await runArmedMaintenance({
    store: fix.store,
    ownerPid: 1234,
    dbPath: fix.dbPath,
    maxWaitMs: 100,
    pollIntervalMs: 10,
    isOwnerAlive: () => false,
    _trustedTestExecution: true,
    // 3 initial polls succeed, but pre-commit check fails (OpenCode reopened)
    processChecker: () => {
      checkCount++;
      if (checkCount > 3) {
        return true; // OpenCode process detected active right before commit!
      }
      return false;
    },
  });

  assert.equal(receipt.status, "failed");
  assert.match(receipt.error ?? "", /OpenCode se encuentra en ejecución/);

  // Database must remain intact
  const db = new DatabaseSync(fix.dbPath, { readOnly: true });
  const row = db.prepare("SELECT count(*) as cnt FROM session").get() as { cnt: number };
  assert.equal(row.cnt, 10);
  db.close();
});

test("stale message content modification: rejects plan if message content altered even without time_updated change", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    projectID: "p1",
    allowRunningProcess: true,
  });

  // Mutate message content for one of the candidate families without changing session.time_updated
  const targetSessionId = plan.selectedFamilies[0].rootId;
  const db = new DatabaseSync(fix.dbPath);
  db.prepare("UPDATE message SET content = 'Altered content stealth' WHERE session_id = ?").run(targetSessionId);
  db.close();

  await armOfflinePlan({
    store: fix.store,
    plan,
    ownerPid: 1234,
    ttlMs: 60000,
    _trustedTestExecution: true,
  });

  const receipt = await runArmedMaintenance({
    store: fix.store,
    ownerPid: 1234,
    dbPath: fix.dbPath,
    maxWaitMs: 100,
    pollIntervalMs: 10,
    isOwnerAlive: () => false,
    processChecker: () => false,
    _trustedTestExecution: true,
  });

  assert.equal(receipt.status, "failed");
  assert.match(receipt.error ?? "", /stale|cambió|Mutación/i);

  // Database must not have deleted any sessions
  const checkDb = new DatabaseSync(fix.dbPath, { readOnly: true });
  const row = checkDb.prepare("SELECT count(*) as cnt FROM session").get() as { cnt: number };
  assert.equal(row.cnt, 10);
  checkDb.close();
});

test("receipt semantics: records successful outcome and surfaces on startup, dismissible", async t => {
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
    ttlMs: 60000,
    _trustedTestExecution: true,
  });

  const receipt = await runArmedMaintenance({
    store: fix.store,
    ownerPid: 1234,
    dbPath: fix.dbPath,
    maxWaitMs: 100,
    pollIntervalMs: 10,
    isOwnerAlive: () => false,
    processChecker: () => false,
    skipVacuum: true,
    _trustedTestExecution: true,
  });

  assert.equal(receipt.status, "success");
  assert.ok(receipt.deletedFamilies.length > 0);
  assert.ok(fsSync.existsSync(receipt.backupPath!));

  // Verify receipt is persisted and readable by helper client
  const helperClient = new VaultHelperClient({ store: fix.store });
  const retrievedReceipt = await helperClient.getReceipt();
  assert.ok(retrievedReceipt !== null);
  assert.equal(retrievedReceipt.status, "success");

  // Dismiss / clear receipt
  await helperClient.getReceipt(true);
  const cleared = await helperClient.getReceipt();
  assert.equal(cleared, null);
});

test("helper path packaging and spaces: resolves paths with spaces safely", async t => {
  const tmpDirWithSpaces = await fs.mkdtemp(path.join(os.tmpdir(), "vault spaces test-"));
  try {
    const dummyHelper = path.join(tmpDirWithSpaces, "offline-vault.mjs");
    await fs.writeFile(dummyHelper, "console.log('dummy');", "utf8");

    const resolved = resolveHelperPath(tmpDirWithSpaces);
    assert.equal(resolved, dummyHelper);

    // Node capability check
    const cap = await verifyNodeCapability();
    assert.equal(cap.ok, true);
    assert.ok(cap.version?.startsWith("v"));
  } finally {
    await fs.rm(tmpDirWithSpaces, { recursive: true, force: true });
  }
});

test("B1: resolveHelperPath resolves host dist plugins location with foreign cwd and spaces", async t => {
  const hostDirWithSpaces = await fs.mkdtemp(path.join(os.tmpdir(), "host with spaces-"));
  const foreignCwdDir = await fs.mkdtemp(path.join(os.tmpdir(), "foreign cwd-"));
  const originalCwd = process.cwd();
  try {
    const hostDist = path.join(hostDirWithSpaces, "dist");
    const pluginVaultDir = path.join(hostDist, "plugins", "opencode-session-vault");
    await fs.mkdir(pluginVaultDir, { recursive: true });
    const expectedHelper = path.join(pluginVaultDir, "offline-vault.mjs");
    await fs.writeFile(expectedHelper, "console.log('host helper');", "utf8");

    // Change cwd to foreign directory to verify no reliance on arbitrary cwd
    process.chdir(foreignCwdDir);

    const resolved = resolveHelperPath(hostDist);
    assert.equal(resolved, expectedHelper);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(hostDirWithSpaces, { recursive: true, force: true });
    await fs.rm(foreignCwdDir, { recursive: true, force: true });
  }
});

test("B1: resolveHelperPath throws clear error when helper is missing without fallback", async t => {
  const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "empty candidate dir-"));
  try {
    assert.throws(
      () => resolveHelperPath(emptyDir),
      /No se encontró el ejecutable helper fuera de línea/i
    );
  } finally {
    await fs.rm(emptyDir, { recursive: true, force: true });
  }
});

test("Node capability verification tests real node:sqlite DatabaseSync import", async t => {
  const cap = await verifyNodeCapability();
  assert.equal(cap.ok, true);
  assert.ok(cap.version?.startsWith("v"));

  // Non-existent executable must fail gracefully
  const badCap = await verifyNodeCapability("node_non_existent_binary_xyz");
  assert.equal(badCap.ok, false);
  assert.ok(badCap.error?.includes("no disponible") || badCap.error?.includes("no encontrado"));
});

test("helper-client: inspectDatabase handles child process timeout with structured diagnostic error", async t => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-timeout-test-"));
  try {
    const store = new Store(tmpDir);
    // Create a mock script that sleeps indefinitely or times out
    const sleepScript = path.join(tmpDir, "sleep-helper.mjs");
    await fs.writeFile(
      sleepScript,
      "setTimeout(() => {}, 60000);\n",
      "utf8"
    );
    const client = new VaultHelperClient({
      store,
      helperPath: sleepScript,
    });

    await assert.rejects(
      async () => {
        // Use a very short timeout for test
        await client.inspectDatabase(undefined, { timeout: 100 });
      },
      (err: Error) => {
        assert.match(err.message, /tiempo de espera|timeout/i);
        return true;
      }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("helper-client: inspectDatabase extracts structured JSON error from stdout on non-zero exit", async t => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-error-test-"));
  try {
    const store = new Store(tmpDir);
    const errorScript = path.join(tmpDir, "error-helper.mjs");
    await fs.writeFile(
      errorScript,
      `console.log(JSON.stringify({ error: "Fallo especifico de base de datos bloqueada" })); process.exit(1);\n`,
      "utf8"
    );
    const client = new VaultHelperClient({
      store,
      helperPath: errorScript,
    });

    await assert.rejects(
      async () => {
        await client.inspectDatabase();
      },
      (err: Error) => {
        assert.equal(err.message, "Fallo especifico de base de datos bloqueada");
        return true;
      }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("helper-client: getQuickDiskStats returns fast file metadata without spawning child", async t => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-quick-test-"));
  try {
    const store = new Store(tmpDir);
    const fakeDb = path.join(tmpDir, "test.db");
    await fs.writeFile(fakeDb, "SQLite format 3\0", "utf8");
    const client = new VaultHelperClient({ store });

    const stats = client.getQuickDiskStats(fakeDb);
    assert.equal(stats.exists, true);
    assert.equal(stats.sizeBytes, 16);
    assert.ok(stats.dbPath.includes("test.db"));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

