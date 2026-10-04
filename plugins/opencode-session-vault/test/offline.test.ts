import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/store.ts";
import {
  inspectDatabase,
  generateOfflinePlan,
  applyOfflinePlan,
  checkOpenCodeProcessRunning,
  type OfflinePlan,
} from "../src/offline.ts";

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

  // 14 sessions: 0 to 13
  // Family 13 has a child (ses_13child)
  for (let i = 0; i < 14; i++) {
    const timeUpdated = baseTime - (i + 2) * 86400000;
    insertSession.run(`ses_${i}`, `Session ${i}`, "p1", "/proj1", null, timeUpdated - 1000, timeUpdated, null);
    insertMsg.run(`msg_${i}`, `ses_${i}`, `Msg for ${i}`, timeUpdated);
  }
  // Child of ses_13
  insertSession.run("ses_13child", "Child of 13", "p1", "/proj1", "ses_13", baseTime - 15 * 86400000, baseTime - 15 * 86400000, null);
  insertMsg.run("msg_13_child", "ses_13child", "Child payload", baseTime - 15 * 86400000);
}

async function setupFixture() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-offline-test-"));
  const dbPath = path.join(tmpDir, "opencode.db");
  const vaultDir = path.join(tmpDir, "vault");
  await fs.mkdir(vaultDir, { recursive: true });
  const store = new Store(vaultDir);

  const db = createTestDb(dbPath);
  populateSessions(db);
  db.close();

  return {
    tmpDir,
    dbPath,
    vaultDir,
    store,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

test("inspectDatabase: inspects sqlite without modifying file", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const mtimeBefore = fsSync.statSync(fix.dbPath).mtimeMs;
  const info = await inspectDatabase(fix.dbPath);
  assert.equal(info.sessionCount, 15);
  assert.equal(info.tables.includes("session"), true);
  assert.equal(info.tables.includes("message"), true);
  assert.equal(info.integrity, "pending", "Integrity must be explicitly pending when not requested");
  const mtimeAfter = fsSync.statSync(fix.dbPath).mtimeMs;
  assert.equal(mtimeBefore, mtimeAfter, "Inspection must be purely read-only");

  // Explicit integrity check requested
  const checkedInfo = await inspectDatabase(fix.dbPath, { checkIntegrity: true });
  assert.equal(checkedInfo.integrity, "ok", "Integrity must be ok when explicitly verified");
});

test("plan creation: respects profiles, pins, quota and complete families without mutating DB", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  // Pin ses_12 in store
  await fix.store.update(s => {
    s.pins = ["ses_12"];
    s.config.profile = "ten";
    s.config.maxDeletePerRun = 10;
  });

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false, // OpenCode not running
  });

  assert.equal(plan.totalSessions, 15);
  assert.equal(plan.totalFamilies, 14);
  // ses_12 is pinned -> retained
  // ten profile keeps 10 unpinned families -> out of 13 unpinned families, 10 kept, 3 candidates
  assert.equal(plan.candidateFamiliesCount, 3);
  assert.equal(plan.selectedFamilies.length, 3);

  // ses_13 has child ses_13child -> both must be in memberIds
  const fam13 = plan.selectedFamilies.find(f => f.rootId === "ses_13");
  assert.ok(fam13, "ses_13 should be among oldest candidates");
  assert.equal(fam13.memberIds.length, 2);
  assert.ok(fam13.memberIds.includes("ses_13"));
  assert.ok(fam13.memberIds.includes("ses_13child"));

  // Verify DB was NOT mutated by planning
  const db = new DatabaseSync(fix.dbPath);
  const count = db.prepare("SELECT count(*) as cnt FROM session").get() as { cnt: number };
  assert.equal(count.cnt, 15);
  db.close();
});

test("stale modification: rejects plan if a candidate session was modified before apply", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  // Modify one of the selected sessions in SQLite
  const candidateId = plan.selectedFamilies[0].rootId;
  const db = new DatabaseSync(fix.dbPath);
  db.prepare("UPDATE session SET time_updated = ? WHERE id = ?").run(Date.now(), candidateId);
  db.close();

  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
        _trustedTestExecution: true,
        processChecker: () => false,
      });
    },
    /sesiones fueron modificadas|stale/i
  );
});

test("new child detected: rejects plan if a new child session was added to a target family", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  const famWithRoot = plan.selectedFamilies.find(f => f.rootId === "ses_13");
  assert.ok(famWithRoot);

  // Add new child to ses_13
  const db = new DatabaseSync(fix.dbPath);
  db.prepare(`
    INSERT INTO session (id, title, project_id, directory, parent_id, time_created, time_updated, time_archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run("ses_13newchild", "New Child", "p1", "/proj1", "ses_13", Date.now(), Date.now(), null);
  db.close();

  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
        _trustedTestExecution: true,
        processChecker: () => false,
      });
    },
    /nuevo hijo detectado|nueva sesión hija/i
  );
});

test("pinned change: rejects plan if a target session was pinned after plan creation", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  const targetRoot = plan.selectedFamilies[0].rootId;
  // Pin this target in store
  await fix.store.update(s => {
    s.pins.push(targetRoot);
  });

  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
        _trustedTestExecution: true,
        processChecker: () => false,
      });
    },
    /candado|revisión/i
  );
});

test("active process: fail-closed if OpenCode is running before plan or apply", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  await assert.rejects(
    async () => {
      await generateOfflinePlan({
        dbPath: fix.dbPath,
        store: fix.store,
        processChecker: () => true, // OpenCode running!
      });
    },
    /OpenCode se encuentra en ejecución/i
  );

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
        _trustedTestExecution: true,
        processChecker: () => true, // OpenCode running during apply!
      });
    },
    /OpenCode se encuentra en ejecución/i
  );
});

test("missing schema: fails closed when session table is absent or invalid", async t => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-offline-badschema-"));
  const badDbPath = path.join(tmpDir, "bad.db");
  const store = new Store(path.join(tmpDir, "vault"));
  const db = new DatabaseSync(badDbPath);
  db.exec("CREATE TABLE not_session (id TEXT PRIMARY KEY);");
  db.close();

  await assert.rejects(
    async () => {
      await inspectDatabase(badDbPath);
    },
    /tabla session/i
  );

  await assert.rejects(
    async () => {
      await generateOfflinePlan({
        dbPath: badDbPath,
        store,
        processChecker: () => false,
      });
    },
    /tabla session/i
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("cascades & foreign keys: cascades delete to child tables and passes foreign_key_check", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  const result = await applyOfflinePlan({
    plan,
    dbPath: fix.dbPath,
    store: fix.store,
    confirmed: true,
        _trustedTestExecution: true,
    processChecker: () => false,
  });

  assert.equal(result.status, "success");
  assert.equal(result.deletedFamilies.length, plan.selectedFamilies.length);
  assert.ok(fsSync.existsSync(result.backupPath), "Backup file must exist");

  const db = new DatabaseSync(fix.dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  const fkCheck = db.prepare("PRAGMA foreign_key_check").all();
  assert.equal(fkCheck.length, 0, "No foreign key violations allowed");

  // Check that messages corresponding to deleted sessions were cascaded
  const allTargetIds = plan.selectedFamilies.flatMap(f => f.memberIds);
  for (const id of allTargetIds) {
    const msg = db.prepare("SELECT count(*) as cnt FROM message WHERE session_id = ?").get(id) as { cnt: number };
    assert.equal(msg.cnt, 0, `Message for deleted session ${id} must be cascaded`);
  }
  db.close();
});

test("rollback on error: leaves database unchanged if an error occurs inside transaction", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  const countBefore = 15;

  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
        _trustedTestExecution: true,
        processChecker: () => false,
        _simulateErrorInTransaction: true,
      });
    },
    /simulated_transaction_error/
  );

  // DB must be intact
  const db = new DatabaseSync(fix.dbPath);
  const countAfter = (db.prepare("SELECT count(*) as cnt FROM session").get() as { cnt: number }).cnt;
  assert.equal(countAfter, countBefore, "Database must be completely rolled back");
  db.close();
});

test("backup failure: does not touch database if backup fails", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
        _trustedTestExecution: true,
        processChecker: () => false,
        _simulateBackupFailure: true,
      });
    },
    /backup_failure/
  );

  const db = new DatabaseSync(fix.dbPath);
  const count = (db.prepare("SELECT count(*) as cnt FROM session").get() as { cnt: number }).cnt;
  assert.equal(count, 15, "No sessions should be deleted if backup fails");
  db.close();
});

test("replay: re-applying already executed plan fails cleanly", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  const res1 = await applyOfflinePlan({
    plan,
    dbPath: fix.dbPath,
    store: fix.store,
    confirmed: true,
        _trustedTestExecution: true,
    processChecker: () => false,
  });
  assert.equal(res1.status, "success");

  // Attempt replay with the same plan
  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
        _trustedTestExecution: true,
        processChecker: () => false,
      });
    },
    /stale|no existen|ya no existen/i
  );
});

test("vacuum partial: reports partial_success and preserves delete if vacuum fails", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  const result = await applyOfflinePlan({
    plan,
    dbPath: fix.dbPath,
    store: fix.store,
    confirmed: true,
        _trustedTestExecution: true,
    processChecker: () => false,
    _simulateVacuumFailure: true,
  });

  assert.equal(result.status, "partial_success");
  assert.equal(result.deletedFamilies.length, plan.selectedFamilies.length);
  assert.ok(result.vacuumError);
  assert.ok(fsSync.existsSync(result.backupPath));

  // The delete was committed, not rolled back
  const db = new DatabaseSync(fix.dbPath);
  const count = (db.prepare("SELECT count(*) as cnt FROM session").get() as { cnt: number }).cnt;
  assert.equal(count, 15 - plan.selectedFamilies.flatMap(f => f.memberIds).length);
  db.close();
});

test("plan expiration: rejects plan if expired", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  // Force expiration
  plan.expiresAt = Date.now() - 1000;

  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
        _trustedTestExecution: true,
        processChecker: () => false,
      });
    },
    /ha expirado/i
  );
});

test("deep family hierarchy: deletes entire tree (grandparent, parent, child) without leaving orphans", async t => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-offline-tree-"));
  const dbPath = path.join(tmpDir, "opencode.db");
  const vaultDir = path.join(tmpDir, "vault");
  await fs.mkdir(vaultDir, { recursive: true });
  const store = new Store(vaultDir);

  const db = createTestDb(dbPath);
  const insert = db.prepare(`
    INSERT INTO session (id, title, project_id, directory, parent_id, time_created, time_updated, time_archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Grandparent, Parent, Child
  const now = 1700000000000;
  insert.run("ses_gp", "Grandparent", "p1", "/proj", null, now - 1000000, now - 1000000, null);
  insert.run("ses_parent", "Parent", "p1", "/proj", "ses_gp", now - 500000, now - 500000, null);
  insert.run("ses_child", "Child", "p1", "/proj", "ses_parent", now - 200000, now - 200000, null);

  // Add 11 newer dummy sessions so profile ten keeps the 10 newest and leaves ses_gp tree as candidate
  for (let i = 0; i < 11; i++) {
    insert.run(`ses_dummy${i}`, `Dummy ${i}`, "p1", "/proj", null, now - (100 - i), now - (100 - i), null);
  }
  db.close();

  const plan = await generateOfflinePlan({
    dbPath,
    store,
    processChecker: () => false,
  });

  const famGp = plan.selectedFamilies.find(f => f.rootId === "ses_gp");
  assert.ok(famGp, "Grandparent family must be candidate");
  assert.equal(famGp.memberIds.length, 3);
  assert.ok(famGp.memberIds.includes("ses_gp"));
  assert.ok(famGp.memberIds.includes("ses_parent"));
  assert.ok(famGp.memberIds.includes("ses_child"));

  const result = await applyOfflinePlan({
    plan,
    dbPath,
    store,
    confirmed: true,
        _trustedTestExecution: true,
    processChecker: () => false,
  });

  assert.equal(result.status, "success");
  assert.ok(result.deletedFamilies.includes("ses_gp"));
  assert.ok(result.deletedSessions.includes("ses_gp"));
  assert.ok(result.deletedSessions.includes("ses_parent"));
  assert.ok(result.deletedSessions.includes("ses_child"));

  const verifyDb = new DatabaseSync(dbPath);
  const remaining = verifyDb.prepare("SELECT id FROM session WHERE id IN ('ses_gp', 'ses_parent', 'ses_child')").all();
  assert.equal(remaining.length, 0, "Entire family tree must be deleted");
  verifyDb.close();

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("destructive schema: rejects unknown table containing session_id without FK cascade", async t => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-offline-unknown-fk-"));
  const dbPath = path.join(tmpDir, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      title TEXT,
      directory TEXT,
      parent_id TEXT,
      time_updated INTEGER
    );
    CREATE TABLE custom_orphan_plugin (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      metadata TEXT
    );
  `);
  db.close();

  // Inspect must succeed non-destructively without failing on unknown table
  const inspectInfo = await inspectDatabase(dbPath);
  assert.equal(inspectInfo.sessionCount, 0);

  // But plan generation must reject non-cascade destructive schema
  const store = new Store(tmpDir);
  await assert.rejects(
    async () => {
      await generateOfflinePlan({ dbPath, store, processChecker: () => false });
    },
    /Tabla desconocida 'custom_orphan_plugin' contiene columna relacionada/i
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("destructive schema: rejects known dependent table when FK lacks ON DELETE CASCADE", async t => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-offline-nocascade-"));
  const dbPath = path.join(tmpDir, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      title TEXT,
      directory TEXT,
      parent_id TEXT,
      time_updated INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      content TEXT,
      FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE RESTRICT
    );
  `);
  db.close();

  // Inspect must succeed non-destructively
  const inspectInfo = await inspectDatabase(dbPath);
  assert.equal(inspectInfo.sessionCount, 0);

  // But plan generation must reject non-cascade destructive schema
  const store = new Store(tmpDir);
  await assert.rejects(
    async () => {
      await generateOfflinePlan({ dbPath, store, processChecker: () => false });
    },
    /tabla dependiente 'message' no tiene clave foránea ON DELETE CASCADE/i
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("scope project: requires explicit projectID and throws clear error if absent", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  await fix.store.update(s => {
    s.config.scope = "project";
  });

  await assert.rejects(
    async () => {
      await generateOfflinePlan({
        dbPath: fix.dbPath,
        store: fix.store,
        processChecker: () => false,
      });
    },
    /alcance configurado.*'project'.*especificar.*projectID/i
  );

  // When projectID is provided, generates plan successfully restricted to that project
  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    projectID: "p1",
    processChecker: () => false,
  });

  assert.equal(plan.scope, "project");
  assert.equal(plan.projectID, "p1");
  assert.ok(plan.candidateFamiliesCount > 0);
});

test("plan manipulation: rejects plan when fingerprint is tampered with", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  // Tamper with fingerprint
  plan.fingerprint = "deadbeef1234567890abcdefdeadbeef1234567890abcdefdeadbeef12345678";

  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
        _trustedTestExecution: true,
        processChecker: () => false,
      });
    },
    /fingerprint.*no coincide|manipulado/i
  );
});

test("plan schema & limits: rejects plan with duplicate session IDs or member discrepancies", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  if (plan.selectedFamilies.length >= 2) {
    // Inject duplicate member id in second family
    plan.selectedFamilies[1].memberIds.push(plan.selectedFamilies[0].rootId);
    plan.selectedFamilies[1].members.push({
      id: plan.selectedFamilies[0].rootId,
      timeUpdated: Date.now(),
    });
    // Recalculate fingerprint with tampered array to isolate schema limit check
    const { computePlanFingerprint } = await import("../src/offline.ts");
    plan.fingerprint = computePlanFingerprint(
      plan.canonicalDbPath,
      plan.stateRevision,
      plan.scope,
      plan.projectID,
      plan.profile,
      plan.selectedFamilies,
      plan.snapshotHash
    );

    await assert.rejects(
      async () => {
        await applyOfflinePlan({
          plan,
          dbPath: fix.dbPath,
          store: fix.store,
          confirmed: true,
        _trustedTestExecution: true,
          processChecker: () => false,
        });
      },
      /ID de sesión duplicado/i
    );
  }
});

test("child message modification: rejects plan if messages change even without session time_updated bump", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  // Add a new message to the target session WITHOUT changing session.time_updated
  const targetId = plan.selectedFamilies[0].rootId;
  const db = new DatabaseSync(fix.dbPath);
  db.prepare(`
    INSERT INTO message (id, session_id, content, time_created)
    VALUES (?, ?, ?, ?)
  `).run("msg_stealth_update", targetId, "Stealth message payload", Date.now());
  db.close();

  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
        _trustedTestExecution: true,
        processChecker: () => false,
      });
    },
    /sesiones o mensajes cambió|stale/i
  );
});

test("B2: part mutation with equal session/message timestamps rejects apply before delete and before backup", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  // Add part table with foreign key cascade
  const db = new DatabaseSync(fix.dbPath);
  db.exec(`
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      session_id TEXT,
      type TEXT,
      content TEXT,
      raw_blob BLOB,
      big_id INTEGER,
      time_created INTEGER,
      FOREIGN KEY(message_id) REFERENCES message(id) ON DELETE CASCADE,
      FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE CASCADE
    );
  `);
  const insertPart = db.prepare(`
    INSERT INTO part (id, message_id, session_id, type, content, raw_blob, big_id, time_created)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertPart.run("part_init_0", "msg_0", "ses_0", "text", "Initial part payload", Buffer.from([1, 2, 3]), 1000n, 1700000000000);
  db.close();

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  // Mutate part table ONLY: insert an additional part for candidate root session
  // Neither session.time_updated nor message.time_created is altered!
  const targetId = plan.selectedFamilies[0].rootId;
  const mutDb = new DatabaseSync(fix.dbPath);
  mutDb.prepare(`
    INSERT INTO part (id, message_id, session_id, type, content, raw_blob, big_id, time_created)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run("part_stealth_update", `msg_${targetId.replace("ses_", "")}`, targetId, "text", "Stealth part payload", Buffer.from([4, 5, 6]), 9007199254740993n, 1700000000000);
  mutDb.close();

  // Should reject during pre-backup snapshot verification before any delete or backup
  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
        _trustedTestExecution: true,
        processChecker: () => false,
      });
    },
    /sesiones o mensajes cambió|stale/i
  );

  // Verify target session was NOT deleted
  const checkDb = new DatabaseSync(fix.dbPath, { readOnly: true });
  const stillExists = checkDb.prepare("SELECT id FROM session WHERE id = ?").get(targetId);
  checkDb.close();
  assert.ok(stillExists, "Session must not be deleted when part mutation is detected");

  // Verify no backup was created
  const files = await fs.readdir(fix.tmpDir);
  const backupFiles = files.filter(f => f.includes(".before-cleanup-"));
  assert.equal(backupFiles.length, 0, "No backup file should be generated when snapshot verification fails pre-backup");
});

test("B2: deterministic snapshot serialization handles BLOB, BigInt and schema columns fail-closed", async t => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-b2-test-"));
  const dbPath = path.join(tmpDir, "b2.db");
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        time_updated INTEGER,
        extra_blob BLOB,
        big_val INTEGER
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        time_created INTEGER,
        data_blob BLOB,
        FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE CASCADE
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT,
        session_id TEXT,
        content TEXT,
        part_blob BLOB,
        FOREIGN KEY(message_id) REFERENCES message(id) ON DELETE CASCADE,
        FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE CASCADE
      );
      INSERT INTO session VALUES ('s1', null, 1000, X'010203', 9007199254740995);
      INSERT INTO message VALUES ('m1', 's1', 1000, X'DEADBEEF');
      INSERT INTO part VALUES ('p1', 'm1', 's1', 'hello', X'CAFEBABE');
    `);

    const { computeCandidateSnapshot } = await import("../src/offline.ts");
    const snap1 = computeCandidateSnapshot(db, ["s1"]);
    const snap2 = computeCandidateSnapshot(db, ["s1"]);
    assert.equal(snap1.snapshotHash, snap2.snapshotHash, "Snapshots must be strictly deterministic");

    // Modify BLOB in part
    db.prepare("UPDATE part SET part_blob = X'CAFEFFFF' WHERE id = 'p1'").run();
    const snap3 = computeCandidateSnapshot(db, ["s1"]);
    assert.notEqual(snap1.snapshotHash, snap3.snapshotHash, "Blob change in part must change snapshot hash");

    // Modify BigInt in session
    db.prepare("UPDATE session SET big_val = 9007199254740999 WHERE id = 's1'").run();
    const snap4 = computeCandidateSnapshot(db, ["s1"]);
    assert.notEqual(snap3.snapshotHash, snap4.snapshotHash, "BigInt change in session must change snapshot hash");

    // Malformed part table without session_id and without message_id should fail closed
    db.exec("CREATE TABLE invalid_part (id TEXT PRIMARY KEY);");
    // Swap table name to simulate invalid part schema
    db.exec("ALTER TABLE part RENAME TO part_backup;");
    db.exec("ALTER TABLE invalid_part RENAME TO part;");
    assert.throws(
      () => computeCandidateSnapshot(db!, ["s1"]),
      /La tabla dependiente 'part' existe pero no posee columna/i
    );
  } finally {
    try {
      db?.close();
    } catch {}
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("mutation between backup and lock: rejects if target mutated while backup was created", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
        _trustedTestExecution: true,
        processChecker: () => false,
        _simulateMutationAfterBackup: true,
      });
    },
    /Mutación detectada.*entre el respaldo y la adquisición del bloqueo/i
  );
});

test("process check before commit: aborts transaction if OpenCode opens during execution", async t => {
  const fix = await setupFixture();
  t.after(fix.cleanup);

  const plan = await generateOfflinePlan({
    dbPath: fix.dbPath,
    store: fix.store,
    processChecker: () => false,
  });

  let checkCounter = 0;
  // Fail on the pre-commit process check
  const dynamicProcessChecker = () => {
    checkCounter++;
    // Call 1: preflight in applyOfflinePlan
    // Call 2: right before COMMIT
    if (checkCounter >= 2) {
      return true; // Simulate OpenCode started!
    }
    return false;
  };

  await assert.rejects(
    async () => {
      await applyOfflinePlan({
        plan,
        dbPath: fix.dbPath,
        store: fix.store,
        confirmed: true,
        _trustedTestExecution: true,
        processChecker: dynamicProcessChecker,
      });
    },
    /OpenCode se encuentra en ejecución/i
  );

  // Database must not have lost any sessions
  const db = new DatabaseSync(fix.dbPath);
  const count = (db.prepare("SELECT count(*) as cnt FROM session").get() as { cnt: number }).cnt;
  assert.equal(count, 15, "Transaction must be aborted if process check fails before commit");
  db.close();
});
