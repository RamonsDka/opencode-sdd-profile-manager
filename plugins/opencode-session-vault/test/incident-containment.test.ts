import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/store.ts";
import {
  inspectClaimedState,
  getClaimedPlan,
  checkPidLiveness,
  armOfflinePlan,
  applyOfflinePlan,
  runArmedMaintenance,
  CLAIMED_PLAN_FILE,
  ARMED_PLAN_FILE,
  RECEIPT_FILE,
  type ArmedPlan,
  type OfflinePlan,
} from "../src/offline.ts";
import { VaultHelperClient } from "../src/helper-client.ts";
import { createVaultNavigationController } from "../src/ui-controller.ts";

const execFileAsync = promisify(execFile);

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
    INSERT INTO session VALUES ('real_ses_secret_123', 'Secret Session', 'p1', '/proj', NULL, 1000, 1000, NULL);
    INSERT INTO message VALUES ('msg_secret_1', 'real_ses_secret_123', 'Private payload', 1000);
  `);
  db.close();
}

function makeMockPlan(canonicalDbPath: string): OfflinePlan {
  return {
    version: 1,
    createdAt: Date.now(),
    expiresAt: Date.now() + 300000,
    canonicalDbPath,
    dbStat: { size: 4096, mtimeMs: Date.now() },
    stateRevision: 1,
    statePins: [],
    scope: "project",
    projectID: "p1",
    profile: "basic",
    totalSessions: 1,
    totalFamilies: 1,
    candidateFamiliesCount: 1,
    retainedFamiliesCount: 0,
    selectedFamilies: [
      {
        rootId: "real_ses_secret_123",
        memberIds: ["real_ses_secret_123"],
        updated: 1000,
        title: "Secret Session",
        members: [{ id: "real_ses_secret_123", timeUpdated: 1000 }],
      },
    ],
    quota: { signature: "sig", baseline: 1, keep: 0, at: Date.now() },
    snapshotHash: "hash-123",
    dataVersion: 1,
    fingerprint: "fp-123",
  };
}

async function setupIncidentFixture() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-incident-containment-"));
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

test("dead claimed no receipt reports interrupted retains artifacts", async t => {
  const fix = await setupIncidentFixture();
  t.after(fix.cleanup);

  const plan = makeMockPlan(fix.dbPath);
  const deadPid = 99999999;
  const claimedPlan: ArmedPlan = {
    version: 1,
    id: "incident-57-test",
    armedAt: Date.now() - 60000,
    expiresAt: Date.now() + 240000,
    ownerPid: 1111,
    workerPid: deadPid,
    plan,
    status: "claimed",
  };

  const claimedPath = path.join(fix.stateDir, CLAIMED_PLAN_FILE);
  await fs.writeFile(claimedPath, JSON.stringify(claimedPlan, null, 2), "utf8");

  const workerPidPath = path.join(fix.stateDir, `worker-pid-${claimedPlan.id}.json`);
  await fs.writeFile(
    workerPidPath,
    JSON.stringify({ armId: claimedPlan.id, workerPid: deadPid, timestamp: Date.now() }),
    "utf8"
  );

  // Inspect claimed state
  const report = await inspectClaimedState(fix.store, {
    // Custom checker confirming PID is dead
    isPidAlive: () => "dead",
  });

  assert.ok(report !== null);
  assert.equal(report.status, "interrupted");
  assert.equal(report.pidStatus, "dead");
  assert.equal(report.hasReceipt, false);
  assert.equal(report.incidentInfo.armId, "incident-57-test");
  assert.equal(report.incidentInfo.outcome, "uncertain");

  // Verify all artifacts are RETAINED on disk (no automatic deletion/rollback/synthesizing)
  assert.ok(fsSync.existsSync(claimedPath), "claimed-plan.json must be retained");
  assert.ok(fsSync.existsSync(workerPidPath), "worker-pid-*.json must be retained");
  assert.equal(
    fsSync.existsSync(path.join(fix.stateDir, RECEIPT_FILE)),
    false,
    "No receipt must be synthesized"
  );

  // Verify database is completely intact
  const db = new DatabaseSync(fix.dbPath, { readOnly: true });
  const row = db.prepare("SELECT count(*) as cnt FROM session").get() as { cnt: number };
  assert.equal(row.cnt, 1);
  db.close();
});

test("unknown/accessdenied not dead", async t => {
  const fix = await setupIncidentFixture();
  t.after(fix.cleanup);

  // Test checkPidLiveness with access denied simulated
  const checkAccessDenied = checkPidLiveness(12345, () => "unknown");
  assert.equal(checkAccessDenied.status, "unknown");

  const plan = makeMockPlan(fix.dbPath);
  const claimedPlan: ArmedPlan = {
    version: 1,
    id: "incident-accessdenied-test",
    armedAt: Date.now() - 10000,
    expiresAt: Date.now() + 290000,
    ownerPid: 1111,
    workerPid: 55555,
    plan,
    status: "claimed",
  };
  await fs.writeFile(path.join(fix.stateDir, CLAIMED_PLAN_FILE), JSON.stringify(claimedPlan), "utf8");

  // When check returns "unknown", inspectClaimedState must treat process as "unknown", NOT dead
  const report = await inspectClaimedState(fix.store, {
    isPidAlive: () => "unknown",
  });

  assert.ok(report !== null);
  assert.equal(report.pidStatus, "unknown");
  assert.equal(report.status, "unknown");
  assert.notEqual(report.status, "interrupted");
});

test("active state: worker PID alive reports active status", async t => {
  const fix = await setupIncidentFixture();
  t.after(fix.cleanup);

  const plan = makeMockPlan(fix.dbPath);
  const claimedPlan: ArmedPlan = {
    version: 1,
    id: "incident-active-test",
    armedAt: Date.now() - 5000,
    expiresAt: Date.now() + 295000,
    ownerPid: 1111,
    workerPid: process.pid, // Current process is alive
    plan,
    status: "claimed",
  };
  await fs.writeFile(path.join(fix.stateDir, CLAIMED_PLAN_FILE), JSON.stringify(claimedPlan), "utf8");

  const report = await inspectClaimedState(fix.store);
  assert.ok(report !== null);
  assert.equal(report.pidStatus, "alive");
  assert.equal(report.status, "active");
});

test("no mutation on inspect: multiple calls cause zero disk modifications", async t => {
  const fix = await setupIncidentFixture();
  t.after(fix.cleanup);

  const plan = makeMockPlan(fix.dbPath);
  const claimedPlan: ArmedPlan = {
    version: 1,
    id: "incident-read-only-test",
    armedAt: Date.now() - 10000,
    expiresAt: Date.now() + 290000,
    ownerPid: 1111,
    workerPid: 999999,
    plan,
    status: "claimed",
  };
  const claimedFile = path.join(fix.stateDir, CLAIMED_PLAN_FILE);
  await fs.writeFile(claimedFile, JSON.stringify(claimedPlan, null, 2), "utf8");

  const stateDirFilesBefore = (await fs.readdir(fix.stateDir)).sort();
  const dbStatBefore = fsSync.statSync(fix.dbPath);
  const claimStatBefore = fsSync.statSync(claimedFile);

  // Call inspectClaimedState multiple times
  for (let i = 0; i < 5; i++) {
    const report = await inspectClaimedState(fix.store, { isPidAlive: () => "dead" });
    assert.ok(report !== null);
    assert.equal(report.status, "interrupted");
  }

  const stateDirFilesAfter = (await fs.readdir(fix.stateDir)).sort();
  const dbStatAfter = fsSync.statSync(fix.dbPath);
  const claimStatAfter = fsSync.statSync(claimedFile);

  assert.deepEqual(stateDirFilesBefore, stateDirFilesAfter, "No files should be added or removed");
  assert.equal(dbStatBefore.mtimeMs, dbStatAfter.mtimeMs, "DB mtime must remain unchanged");
  assert.equal(claimStatBefore.size, claimStatAfter.size, "claimed-plan.json size must remain unchanged");
});

test("all public destructive entrypoints reject pre spawn/writable DB", async t => {
  const fix = await setupIncidentFixture();
  t.after(fix.cleanup);

  const plan = makeMockPlan(fix.dbPath);
  const dbStatBefore = fsSync.statSync(fix.dbPath);

  // 1. applyOfflinePlan without _trustedTestExecution
  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
      });
    },
    /Mantenimiento suspendido: operación interrumpida \/ exclusión no garantizada/
  );

  // DB must be untouched and no backup created
  assert.equal(fsSync.statSync(fix.dbPath).mtimeMs, dbStatBefore.mtimeMs);
  const filesAfter1 = await fs.readdir(fix.tmpDir);
  assert.equal(filesAfter1.filter(f => f.includes("before-cleanup")).length, 0);

  // 2. runArmedMaintenance without _trustedTestExecution
  await assert.rejects(
    async () => {
      await runArmedMaintenance({
        store: fix.store,
        ownerPid: 1234,
      });
    },
    /Mantenimiento suspendido: operación interrumpida \/ exclusión no garantizada/
  );

  // 3. helperClient.armAndSpawn without _trustedTestExecution
  const client = new VaultHelperClient({ store: fix.store, spawnMonitor: false });
  await assert.rejects(
    async () => {
      await client.armAndSpawn({
        plan,
        ownerPid: 1234,
      });
    },
    /Mantenimiento suspendido: operación interrumpida \/ exclusión no garantizada/
  );

  // 4. CLI apply command rejects
  const helperScript = path.resolve("scripts", "offline-vault.ts");
  const planFile = path.join(fix.tmpDir, "test-plan.json");
  await fs.writeFile(planFile, JSON.stringify(plan, null, 2), "utf8");

  await assert.rejects(
    async () => {
      await execFileAsync(
        process.execPath,
        ["--experimental-strip-types", helperScript, "apply", "--plan", planFile, "--confirm"],
        { windowsHide: true }
      );
    },
    (err: any) => {
      assert.match(err.stderr || err.stdout || err.message, /Mantenimiento suspendido: operación interrumpida/);
      return true;
    }
  );

  // 5. CLI run-armed command rejects
  await assert.rejects(
    async () => {
      await execFileAsync(
        process.execPath,
        ["--experimental-strip-types", helperScript, "run-armed", "--state-dir", fix.stateDir],
        { windowsHide: true }
      );
    },
    (err: any) => {
      assert.match(err.stderr || err.stdout || err.message, /Mantenimiento suspendido: operación interrumpida/);
      return true;
    }
  );

  // DB is completely untouched
  assert.equal(fsSync.statSync(fix.dbPath).mtimeMs, dbStatBefore.mtimeMs);
});

test("pending claim blocks new arm even if UI bypass, direct CLI apply prevented same protective gate", async t => {
  const fix = await setupIncidentFixture();
  t.after(fix.cleanup);

  const plan = makeMockPlan(fix.dbPath);
  const claimedPlan: ArmedPlan = {
    version: 1,
    id: "incident-blocking-claim",
    armedAt: Date.now() - 10000,
    expiresAt: Date.now() + 290000,
    ownerPid: 1111,
    workerPid: 999999,
    plan,
    status: "claimed",
  };
  await fs.writeFile(path.join(fix.stateDir, CLAIMED_PLAN_FILE), JSON.stringify(claimedPlan), "utf8");

  // 1. armOfflinePlan is blocked by pending claim even with _trustedTestExecution: true
  await assert.rejects(
    async () => {
      await armOfflinePlan({
        store: fix.store,
        plan,
        ownerPid: 1234,
        _trustedTestExecution: true,
      });
    },
    /plan reclamado previo sin resolver/
  );

  // 2. helperClient.armAndSpawn is blocked by pending claim
  const client = new VaultHelperClient({ store: fix.store, spawnMonitor: false });
  await assert.rejects(
    async () => {
      await client.armAndSpawn({
        plan,
        ownerPid: 1234,
        _trustedTestExecution: true,
      });
    },
    /plan reclamado previo sin resolver/
  );

  // 3. UI controller canArmMaintenance is false and armMaintenance warns
  const controller = createVaultNavigationController({
    service: {
      store: fix.store,
      projectID: "p1",
      preview: async () => ({
        families: [],
        candidates: [],
        locked: 0,
        quota: { keep: 1, total: 1, percent: 15 },
        totalSessions: 1,
        revision: 1,
        at: Date.now(),
        fingerprint: "test-fp",
        scopeKey: "test-key",
      }),
    } as any,
    helperClient: client,
    _trustedTestExecution: true,
  });

  await controller.loadMaintenance();
  assert.equal(controller.canArmMaintenance(), false, "canArmMaintenance must be false when claim is pending");

  controller.armMaintenance();
  assert.match(controller.message(), /Mantenimiento suspendido: operación interrumpida \/ exclusión no garantizada/);
});

test("Show durable current incident actionable preserve backup, known outcome uncertain until validated; no real IDs log", async t => {
  const fix = await setupIncidentFixture();
  t.after(fix.cleanup);

  const plan = makeMockPlan(fix.dbPath);
  const claimedPlan: ArmedPlan = {
    version: 1,
    id: "incident-privacy-audit",
    armedAt: Date.now() - 50000,
    expiresAt: Date.now() + 250000,
    ownerPid: 1111,
    workerPid: 88888,
    plan,
    status: "claimed",
  };
  await fs.writeFile(path.join(fix.stateDir, CLAIMED_PLAN_FILE), JSON.stringify(claimedPlan), "utf8");

  const report = await inspectClaimedState(fix.store, { isPidAlive: () => "dead" });
  assert.ok(report !== null);

  // Verify incidentInfo structure
  const info = report.incidentInfo;
  assert.equal(info.armId, "incident-privacy-audit");
  assert.equal(info.outcome, "uncertain");
  assert.equal(info.selectedFamilyCount, 1);
  assert.equal(info.totalSessionCount, 1);
  assert.match(info.actionableMessage, /Preservar respaldos/i);
  assert.match(info.actionableMessage, /incierto hasta validación manual/i);

  // PRIVACY AUDIT: Ensure no real session IDs or private strings appear in the report incident info
  const serializedInfo = JSON.stringify(info);
  assert.equal(
    serializedInfo.includes("real_ses_secret_123"),
    false,
    "Real session ID must NOT be logged or present in incidentInfo"
  );
  assert.equal(
    serializedInfo.includes("Private payload"),
    false,
    "Private session content must NOT be present in incidentInfo"
  );
});
