import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../src/store.ts";
import { VaultService } from "../src/service.ts";
import { defaultState, emptyInventoryMessage, inventoryCountLabel, formatBytes, formatDeltaBytes, type Session, type Snapshot, type Plan } from "../src/model.ts";
import { makePlan, familiesOf } from "../src/policy.ts";
import { listBackups } from "../src/archive.ts";
import { OpenCodeGateway, canonicalizeDirectory, type Gateway, type ExportData, type GatewayOptions } from "../src/api.ts";
import {
  checkManualApiAvailability,
  CLAIMED_PLAN_FILE,
  ARMED_PLAN_FILE,
  type ClaimedStateReport,
  type ArmedPlan,
} from "../src/coordination.ts";
import { createVaultNavigationController } from "../src/ui-controller.ts";

class MockGateway implements Gateway {
  sessions: Session[];
  deleted: string[] = [];
  busy = new Set<string>();
  unverified = new Set<string>();
  failExport = false;
  failRemove = false;
  removeCalls = 0;
  afterExport?: () => void;

  constructor(sessions: Session[]) {
    this.sessions = structuredClone(sessions);
  }

  async list(_options?: GatewayOptions): Promise<Session[]> {
    return structuredClone(this.sessions);
  }

  async snapshot(
    active: Set<string>,
    _activeDir?: string,
    _activeProjectID?: string,
    _options?: GatewayOptions
  ): Promise<Snapshot> {
    return {
      sessions: structuredClone(this.sessions),
      busy: new Set(this.busy),
      active: new Set(active),
      unverified: new Set(this.unverified),
    };
  }

  async exportSession(s: Session, _options?: GatewayOptions): Promise<ExportData> {
    if (this.failExport) {
      throw new Error("Simulated storage/network failure during export");
    }
    this.afterExport?.();
    const current = this.sessions.find(item => item.id === s.id) ?? s;
    return {
      info: structuredClone(current),
      messages: [
        {
          info: { id: `msg_${s.id}`, role: "user", time: { created: 1000 } },
          parts: [{ type: "text", text: `Contenido de ${s.id}` }],
        },
      ],
    };
  }

  async remove(s: Session, _options?: GatewayOptions): Promise<void> {
    this.removeCalls++;
    if (this.failRemove) {
      throw new Error("Simulated API remove failure");
    }
    this.deleted.push(s.id);
    // Cascade delete like OpenCode server
    this.sessions = this.sessions.filter(item => item.id !== s.id && item.parentID !== s.id);
  }
}

async function createTestEnv(t: { after: (fn: () => Promise<void>) => void }, sessionCount = 14) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-manual-api-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const now = 1700000000000;
  const sessions: Session[] = Array.from({ length: sessionCount }, (_, i) => ({
    id: `ses_${i}`,
    title: `Sesión ${i}`,
    directory: "/demo",
    projectID: "proj_main",
    time: {
      created: now - (i + 2) * 86400000,
      updated: now - (i + 2) * 86400000,
    },
  }));
  const gateway = new MockGateway(sessions);
  const active = new Set<string>();
  const service = new VaultService({
    store,
    gateway,
    projectID: "proj_main",
    projectDirectory: "/demo",
    active: () => active,
  });
  return { dir, store, gateway, service, active, now };
}

// ---------------------------------------------------------------------------
// 1. Worker Absence & Availability Tests
// ---------------------------------------------------------------------------

test("safe manual API availability: verified available when no claim exists", async t => {
  const { store } = await createTestEnv(t);
  const res = await checkManualApiAvailability(store);
  assert.equal(res.available, true);
  assert.equal(res.report, null);
});

test("safe manual API availability: fail-closed when worker is active", async t => {
  const { dir, store } = await createTestEnv(t);
  const fakeClaim: ArmedPlan = {
    version: 1,
    id: "arm-active-123",
    armedAt: Date.now(),
    expiresAt: Date.now() + 60000,
    ownerPid: process.pid,
    workerPid: 999999,
    status: "claimed",
    plan: {} as any,
  };
  await fs.writeFile(path.join(dir, CLAIMED_PLAN_FILE), JSON.stringify(fakeClaim));

  const res = await checkManualApiAvailability(store, {
    isPidAlive: () => "alive",
  });
  assert.equal(res.available, false);
  assert.match(res.reason ?? "", /activo/i);
});

test("safe manual API availability: fail-closed when worker status is unknown (access denied)", async t => {
  const { dir, store } = await createTestEnv(t);
  const fakeClaim: ArmedPlan = {
    version: 1,
    id: "arm-unknown-123",
    armedAt: Date.now(),
    expiresAt: Date.now() + 60000,
    ownerPid: process.pid,
    workerPid: 888888,
    status: "claimed",
    plan: {} as any,
  };
  await fs.writeFile(path.join(dir, CLAIMED_PLAN_FILE), JSON.stringify(fakeClaim));

  const res = await checkManualApiAvailability(store, {
    isPidAlive: () => "unknown",
  });
  assert.equal(res.available, false);
  assert.match(res.reason ?? "", /desconocido/i);
});

test("safe manual API availability: available when interrupted claim has dead worker, preserves claim artifact", async t => {
  const { dir, store } = await createTestEnv(t);
  const fakeClaim: ArmedPlan = {
    version: 1,
    id: "arm-interrupted-123",
    armedAt: Date.now() - 100000,
    expiresAt: Date.now() - 50000,
    ownerPid: 777777,
    workerPid: 777778,
    status: "claimed",
    plan: {
      selectedFamilies: [{ rootId: "ses_1", memberIds: ["ses_1"], title: "S1", updated: 1000, members: [] }],
    } as any,
  };
  const claimPath = path.join(dir, CLAIMED_PLAN_FILE);
  await fs.writeFile(claimPath, JSON.stringify(fakeClaim));

  const res = await checkManualApiAvailability(store, {
    isPidAlive: () => "dead",
  });
  assert.equal(res.available, true, "Dead worker absence verified -> safe manual API is available");
  assert.ok(res.report, "Report must be provided");
  assert.equal(res.report?.status, "interrupted");

  // Verify old interrupted claim is NOT deleted
  const stillExists = await fs.stat(claimPath).then(() => true).catch(() => false);
  assert.equal(stillExists, true, "Old interrupted claim must be preserved, not auto-removed");
});

// ---------------------------------------------------------------------------
// 2. Policy & Bounded Lot (Max 5 Families)
// ---------------------------------------------------------------------------

test("policy manualApi: bounds lot to max 5 families, oldest first", async t => {
  const { service, store, now } = await createTestEnv(t, 14);
  const state = await store.read();
  const snap: Snapshot = {
    sessions: Array.from({ length: 14 }, (_, i) => ({
      id: `ses_${i}`,
      title: `Sesión ${i}`,
      directory: "/demo",
      projectID: "proj_main",
      time: { created: now - (i + 2) * 86400000, updated: now - (i + 2) * 86400000 },
    })),
    active: new Set(),
    busy: new Set(),
  };

  // Automated/default plan: candidates must remain 0
  const defaultPlan = makePlan(snap, state, "proj_main", now);
  assert.equal(defaultPlan.candidates.length, 0);

  // Manual API plan: candidates bounded to max 5, oldest first (ses_13 down to ses_9)
  const manualPlan = makePlan(snap, state, "proj_main", now, { manualApi: true });
  assert.equal(manualPlan.candidates.length, 4, "Only 4 exceed retention (14 total - 10 kept = 4)");
  assert.equal(manualPlan.candidates[0].root.id, "ses_13", "Oldest session first");

  // With 20 sessions (10 kept, 10 exceed): bounded to EXACTLY 5
  const snap20: Snapshot = {
    sessions: Array.from({ length: 20 }, (_, i) => ({
      id: `ses_${i}`,
      title: `Sesión ${i}`,
      directory: "/demo",
      projectID: "proj_main",
      time: { created: now - (i + 2) * 86400000, updated: now - (i + 2) * 86400000 },
    })),
    active: new Set(),
    busy: new Set(),
  };
  const manualPlan20 = makePlan(snap20, state, "proj_main", now, { manualApi: true });
  assert.equal(manualPlan20.candidates.length, 5, "Strictly bounded to max 5 families per approved lot");
  assert.equal(manualPlan20.candidates[0].root.id, "ses_19");
  assert.equal(manualPlan20.candidates[4].root.id, "ses_15");
});

test("policy manualApi: active, busy, retry, unverified protect whole family", async t => {
  const { store, now } = await createTestEnv(t);
  const state = await store.read();
  const root = { id: "ses_root", title: "Root", directory: "/demo", projectID: "proj_main", time: { created: 100, updated: 100 } };
  const child = { id: "ses_child", title: "Child", directory: "/demo", projectID: "proj_main", parentID: "ses_root", time: { created: 100, updated: 100 } };

  // 1. Active child protects whole family
  const snapActive: Snapshot = {
    sessions: [root, child],
    active: new Set(["ses_child"]),
    busy: new Set(),
  };
  const planActive = makePlan(snapActive, state, "proj_main", now, { manualApi: true });
  assert.equal(planActive.candidates.length, 0);
  assert.ok(planActive.families[0].reasons.includes("Abierta"));

  // 2. Busy child protects whole family
  const snapBusy: Snapshot = {
    sessions: [root, child],
    active: new Set(),
    busy: new Set(["ses_child"]),
  };
  const planBusy = makePlan(snapBusy, state, "proj_main", now, { manualApi: true });
  assert.equal(planBusy.candidates.length, 0);
  assert.ok(planBusy.families[0].reasons.includes("Trabajando"));

  // 3. Unverified child protects whole family
  const snapUnv: Snapshot = {
    sessions: [root, child],
    active: new Set(),
    busy: new Set(),
    unverified: new Set(["ses_child"]),
  };
  const planUnv = makePlan(snapUnv, state, "proj_main", now, { manualApi: true });
  assert.equal(planUnv.candidates.length, 0);
  assert.ok(planUnv.families[0].reasons.includes("Actividad no verificada"));
});

// ---------------------------------------------------------------------------
// 3. Service Safe Manual API Execution
// ---------------------------------------------------------------------------

test("service cleanup: automated remains blocked; manualApi succeeds with verified backup", async t => {
  const { service, store, gateway } = await createTestEnv(t);

  // 1. Automated attempt: MUST reject
  const autoPreview = await service.preview({ liveness: true });
  const autoResult = await service.cleanup(autoPreview, true);
  assert.equal(autoResult.deleted.length, 0, "Automated must never delete");
  assert.equal(gateway.removeCalls, 0);

  // 2. Manual API preview and execution
  const manualPlan = await service.preview({ liveness: true, manualApi: true });
  assert.ok(manualPlan.candidates.length > 0, "Manual API preview produces candidates");
  assert.ok(manualPlan.candidates.length <= 5, "Candidates bounded by 5");

  const manualResult = await service.cleanup(manualPlan, false, { manualApi: true });
  assert.equal(manualResult.deleted.length, manualPlan.candidates.length);
  assert.equal(manualResult.error, undefined);
  assert.equal(gateway.removeCalls, manualPlan.candidates.length);

  // Verify backup manifests were created with status 'deleted'
  const backups = await listBackups(store);
  assert.equal(backups.length, manualPlan.candidates.length);
  for (const b of backups) {
    assert.equal(b.status, "deleted");
  }
});

test("service cleanup: backup failure never deletes from gateway", async t => {
  const { service, gateway } = await createTestEnv(t);
  const manualPlan = await service.preview({ liveness: true, manualApi: true });
  assert.ok(manualPlan.candidates.length > 0);

  gateway.failExport = true;
  const result = await service.cleanup(manualPlan, false, { manualApi: true });
  assert.equal(result.deleted.length, 0, "Must not delete any session on backup failure");
  assert.ok(result.error, "Result must contain error");
  assert.equal(gateway.removeCalls, 0, "gateway.remove must NEVER be called if backup fails");
});

test("service cleanup: rejects lot with > 5 families fail-closed", async t => {
  const { service, store, now } = await createTestEnv(t, 20);
  const state = await store.read();
  const snap: Snapshot = {
    sessions: Array.from({ length: 20 }, (_, i) => ({
      id: `ses_${i}`,
      title: `S ${i}`,
      directory: "/demo",
      projectID: "proj_main",
      time: { created: Date.now() - (i + 2) * 86400000, updated: Date.now() - (i + 2) * 86400000 },
    })),
    active: new Set(),
    busy: new Set(),
  };
  const oversizedPlan = makePlan(snap, state, "proj_main", Date.now(), { manualApi: true, maxManualFamilies: 10 });
  assert.equal(oversizedPlan.candidates.length, 10);

  await assert.rejects(
    service.cleanup(oversizedPlan, false, { manualApi: true }),
    /límite máximo de 5 familias/i
  );
});

test("service cleanup: tree change (new child added) aborts execution with zero deletes", async t => {
  const { service, gateway } = await createTestEnv(t);
  const manualPlan = await service.preview({ liveness: true, manualApi: true });
  const targetId = manualPlan.candidates[0].root.id;

  // New child added during export/snapshot check
  gateway.afterExport = () => {
    gateway.afterExport = undefined;
    gateway.sessions.push({
      id: "ses_new_intruder_child",
      title: "New Child Added Concurrently",
      directory: "/demo",
      projectID: "proj_main",
      parentID: targetId,
      time: { created: Date.now(), updated: Date.now() },
    });
  };

  const result = await service.cleanup(manualPlan, false, { manualApi: true });
  assert.equal(result.deleted.length, 0, "Must abort on changed tree membership");
  assert.ok(result.error, "Error must be recorded");
  assert.ok(!gateway.deleted.includes(targetId), "Target family must not be deleted");
});

test("service cleanup: pin added after preview aborts execution with zero deletes", async t => {
  const { service, store, gateway } = await createTestEnv(t);
  const manualPlan = await service.preview({ liveness: true, manualApi: true });
  const targetId = manualPlan.candidates[0].root.id;

  // Pin target before cleanup
  await service.pin(targetId);

  await assert.rejects(
    service.cleanup(manualPlan, false, { manualApi: true }),
    /cambi/i
  );
  assert.equal(gateway.deleted.length, 0);
});

// ---------------------------------------------------------------------------
// 4. UI Controller & UI Workflow
// ---------------------------------------------------------------------------

test("ui-controller: truthful states for manual API clean with LIMPIAR confirmation", async t => {
  const { service, gateway } = await createTestEnv(t);

  let confirmationTitle = "";
  let confirmationDescription = "";
  let confirmationAction: ((v: string) => Promise<void>) | undefined;

  const controller = createVaultNavigationController({
    service,
    manualApi: true,
    askConfirmation: (title, _ph, action, desc) => {
      confirmationTitle = title;
      confirmationDescription = desc ?? "";
      confirmationAction = action;
    },
  });

  // Open preview
  await controller.openPreview();

  // With no active worker, safe manual API is available
  assert.equal(controller.canClean(), true, "canClean must be true for safe manual API preview");
  assert.ok((controller.plan()?.candidates.length ?? 0) <= 5);

  controller.clean();
  assert.ok(confirmationAction, "Confirmation action must be provided");
  assert.match(confirmationTitle, /borrar por api/i);
  assert.match(confirmationDescription, /sqlite en disco no se reduce/i);

  // Esc / invalid text fails
  await assert.rejects(confirmationAction("NO"), /escribe limpiar/i);

  // Valid confirmation LIMPIAR via run path (simulates TUI submitEntry)
  await controller.run(async () => await confirmationAction!("LIMPIAR"));
  assert.equal(controller.error(), false);
  assert.match(controller.message(), /familias eliminadas por API/i);
  assert.ok(gateway.deleted.length > 0);
});

test("ui-controller & TUI regression: Enter via run path, singleflight duplicate Enter, wrong text editing, stale plan rejection, partial error lifecycle", async t => {
  const { service, gateway } = await createTestEnv(t, 20);

  let confirmationAction: ((v: string) => Promise<void>) | undefined;
  let confirmationClosed = false;

  const controller = createVaultNavigationController({
    service,
    manualApi: true,
    askConfirmation: (_title, _ph, action) => {
      confirmationAction = action;
      confirmationClosed = false;
    },
    closeConfirmation: () => {
      confirmationClosed = true;
    },
  });

  await controller.openPreview();
  assert.equal(controller.canClean(), true);
  controller.clean();
  assert.ok(confirmationAction);

  // 1. Wrong text does not clean, does not close modal (allows editing), gates remain intact
  await controller.run(async () => await confirmationAction!("WRONG"));
  assert.equal(gateway.removeCalls, 0, "Wrong text must never invoke cleanup");
  assert.equal(confirmationClosed, false, "Wrong confirmation must keep dialog open for editing");
  assert.equal(controller.error(), true);
  assert.match(controller.message(), /escribe limpiar/i);
  assert.equal(controller.busy(), false, "No false stale busy on validation error");

  // 2. Singleflight: duplicate concurrent Enter invokes cleanup ONCE
  let concurrentSkipped = true;
  const initialRemoveCalls = gateway.removeCalls;
  await controller.run(async () => {
    // Attempt concurrent run during active run
    await controller.run(async () => {
      concurrentSkipped = false;
    });
    await confirmationAction!("LIMPIAR");
  });

  assert.equal(concurrentSkipped, true, "Concurrent execution must be dropped by singleflight");
  assert.equal(gateway.removeCalls > initialRemoveCalls, true, "First run performed delete");
  assert.equal(confirmationClosed, true, "Confirmation modal closed on success");
  assert.equal(controller.error(), false);
  assert.equal(controller.busy(), false, "Truthful no false stale busy after completion");
  assert.equal(confirmationClosed, true, "Confirmation modal closed on success");
  assert.equal(controller.error(), false);
  assert.equal(controller.busy(), false, "Truthful no false stale busy after completion");

  // Duplicate Enter invocation after execution must not perform second delete
  const deletesAfterFirst = gateway.removeCalls;
  await controller.run(async () => await confirmationAction!("LIMPIAR"));
  assert.equal(gateway.removeCalls, deletesAfterFirst, "Duplicate Enter must not invoke second delete");

  // 3. Reject stale plan availability changed:
  await controller.openPreview();
  assert.equal(controller.canClean(), true);
  controller.clean();
  confirmationClosed = false;

  // Simulate availability change (e.g. worker appeared or liveness revoked)
  controller.setManualApiAvailable(false);
  await controller.run(async () => await confirmationAction!("LIMPIAR"));
  assert.equal(controller.error(), true);
  assert.match(controller.message(), /desactualizada/i);
  assert.equal(confirmationClosed, true, "Stale plan error closes confirmation modal");
  assert.equal(controller.plan(), undefined, "Stale plan must be invalidated");
  assert.equal(controller.livePlan(), false);
  assert.equal(controller.busy(), false, "Truthful no false stale busy on stale rejection");

  // 4. Failure partial can't auto replay and truthful no false stale busy:
  await controller.openPreview();
  assert.equal(controller.canClean(), true);
  controller.clean();
  confirmationClosed = false;

  // Simulate partial removal failure in gateway
  gateway.failRemove = true;
  await controller.run(async () => await confirmationAction!("LIMPIAR"));
  assert.equal(confirmationClosed, true, "Service partial error closes confirmation modal");
  assert.equal(controller.error(), true, "Service partial error sets error flag");
  assert.match(controller.message(), /omitidas|error/i);
  assert.equal(controller.busy(), false, "Truthful no false stale busy on service error");
  assert.equal(controller.screen(), "list", "Navigates to list on completion");
  assert.equal(controller.canClean(), false, "Cannot clean on list screen (no auto replay)");
});

// ---------------------------------------------------------------------------
// 5. Authoritative Foreign Directory Routing & Idle Classification Tests
// ---------------------------------------------------------------------------

test("authoritative routing: successful empty map proven dir eligible foreign", async t => {
  const foreignDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-foreign-idle-"));
  t.after(() => fs.rm(foreignDir, { recursive: true, force: true }));

  const foreignSession: Session = {
    id: "ses_foridle1",
    title: "Foreign Idle Session",
    directory: foreignDir,
    projectID: "proj_main",
    time: { created: 1000, updated: 1000 },
  };

  const pathCalls: string[] = [];
  const statusCalls: string[] = [];

  const mockClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: [foreignSession],
          response: { headers: new Map() },
        }),
      },
    },
    path: {
      get: async (params: any) => {
        pathCalls.push(params.directory);
        return {
          data: {
            directory: foreignDir,
            worktree: foreignDir,
          },
        };
      },
    },
    session: {
      status: async (params: any) => {
        statusCalls.push(params.directory);
        // Empty status map represents all sessions idle (OpenCode deletes idle from status map)
        return { data: {} };
      },
    },
  };

  const gateway = new OpenCodeGateway(mockClient, { activeDirectory: "/active/dir" });
  const snapshot = await gateway.snapshot(new Set(), "/active/dir", "proj_main", {
    liveness: true,
    candidateDirectories: [foreignDir],
  });

  assert.equal(snapshot.busy.has("ses_foridle1"), false, "Proven idle must NOT be marked busy");
  assert.equal(snapshot.unverified?.has("ses_foridle1"), false, "Proven idle must NOT be marked unverified");
  assert.ok(pathCalls.length >= 1, "Authoritative path.get must have been invoked");
  assert.ok(statusCalls.length >= 1, "session.status must have been invoked");
});

test("authoritative routing: wrong-dir200 protected (fails closed on mismatched identity)", async t => {
  const foreignDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-foreign-wrongdir-"));
  t.after(() => fs.rm(foreignDir, { recursive: true, force: true }));

  const foreignSession: Session = {
    id: "ses_forwrong1",
    title: "Foreign Session Wrong Dir",
    directory: foreignDir,
    projectID: "proj_main",
    time: { created: 1000, updated: 1000 },
  };

  const mockClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: [foreignSession],
          response: { headers: new Map() },
        }),
      },
    },
    path: {
      get: async () => {
        // Server ignores directory and returns 200 with default active directory
        return {
          data: {
            directory: "/active/dir",
            worktree: "/active/dir",
          },
        };
      },
    },
    session: {
      status: async () => {
        // Returns 200 empty map, but from wrong directory!
        return { data: {} };
      },
    },
  };

  const gateway = new OpenCodeGateway(mockClient, { activeDirectory: "/active/dir" });
  const snapshot = await gateway.snapshot(new Set(), "/active/dir", "proj_main", {
    liveness: true,
    candidateDirectories: [foreignDir],
  });

  assert.equal(snapshot.unverified?.has("ses_forwrong1"), true, "Wrong-dir 200 must be marked unverified");
  assert.equal(snapshot.busy.has("ses_forwrong1"), true, "Wrong-dir 200 must be marked busy");
});

test("authoritative routing: unreachable server fails closed and protects family", async t => {
  const foreignDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-foreign-unreach-"));
  t.after(() => fs.rm(foreignDir, { recursive: true, force: true }));

  const foreignSession: Session = {
    id: "ses_forunreach1",
    title: "Foreign Session Unreachable",
    directory: foreignDir,
    projectID: "proj_main",
    time: { created: 1000, updated: 1000 },
  };

  const mockClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: [foreignSession],
          response: { headers: new Map() },
        }),
      },
    },
    path: {
      get: async (params: any) => {
        if (params?.directory === foreignDir) {
          throw new Error("ECONNREFUSED: Server unreachable");
        }
        return { data: { directory: "/active/dir", worktree: "/active/dir" } };
      },
    },
    session: {
      status: async (params: any) => {
        if (params?.directory === foreignDir) {
          throw new Error("ECONNREFUSED: Server unreachable");
        }
        return { data: {} };
      },
    },
  };

  const gateway = new OpenCodeGateway(mockClient, { activeDirectory: "/active/dir" });
  const snapshot = await gateway.snapshot(new Set(), "/active/dir", "proj_main", {
    liveness: true,
    candidateDirectories: [foreignDir],
  });

  assert.equal(snapshot.unverified?.has("ses_forunreach1"), true, "Unreachable server must be marked unverified");
  assert.equal(snapshot.busy.has("ses_forunreach1"), true, "Unreachable server must be marked busy");
});

test("authoritative routing: unknown status type protects whole family", async t => {
  const foreignDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-foreign-unknown-"));
  t.after(() => fs.rm(foreignDir, { recursive: true, force: true }));

  const foreignSession: Session = {
    id: "ses_forunknown1",
    title: "Foreign Session Unknown Status",
    directory: foreignDir,
    projectID: "proj_main",
    time: { created: 1000, updated: 1000 },
  };

  const mockClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: [foreignSession],
          response: { headers: new Map() },
        }),
      },
    },
    path: {
      get: async () => ({
        data: { directory: foreignDir, worktree: foreignDir },
      }),
    },
    session: {
      status: async (params: any) => {
        if (params?.directory === "/active/dir") return { data: {} };
        return {
          data: {
            ses_forunknown1: { type: "unrecognized_future_state" as any },
          },
        };
      },
    },
  };

  const gateway = new OpenCodeGateway(mockClient, { activeDirectory: "/active/dir" });
  const snapshot = await gateway.snapshot(new Set(), "/active/dir", "proj_main", {
    liveness: true,
    candidateDirectories: [foreignDir],
  });

  assert.equal(snapshot.unverified?.has("ses_forunknown1"), true, "Unknown status type must be marked unverified");
  assert.equal(snapshot.busy.has("ses_forunknown1"), true, "Unknown status type must be marked busy");
});

test("authoritative routing: abort and bounded timeout fail closed", async t => {
  const foreignDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-foreign-timeout-"));
  t.after(() => fs.rm(foreignDir, { recursive: true, force: true }));

  const foreignSession: Session = {
    id: "ses_fortimeout1",
    title: "Foreign Session Timeout",
    directory: foreignDir,
    projectID: "proj_main",
    time: { created: 1000, updated: 1000 },
  };

  // 1. Foreign directory status hangs: bounded per-directory timeout fails closed without aborting snapshot
  const mockTimingOutClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: [foreignSession],
          response: { headers: new Map() },
        }),
      },
    },
    path: {
      get: async (params: any) => {
        if (params?.directory === "/active/dir") {
          return { data: { directory: "/active/dir", worktree: "/active/dir" } };
        }
        return new Promise(() => {}); // Never resolves for foreign
      },
    },
    session: {
      status: async (params: any) => {
        if (params?.directory === "/active/dir") {
          return { data: {} };
        }
        return new Promise(() => {}); // Never resolves for foreign
      },
    },
  };

  const gateway = new OpenCodeGateway(mockTimingOutClient, { activeDirectory: "/active/dir" });
  const snapshot = await gateway.snapshot(new Set(), "/active/dir", "proj_main", {
    liveness: true,
    timeoutMs: 80, // Snapshot bounded timeout triggers foreign timeout handler
    candidateDirectories: [foreignDir],
  });

  assert.equal(snapshot.unverified?.has("ses_fortimeout1"), true, "Timed out foreign dir must fail closed");
  assert.equal(snapshot.busy.has("ses_fortimeout1"), true);

  // 2. Parent AbortSignal cancels operation
  const abortCtrl = new AbortController();
  abortCtrl.abort();
  await assert.rejects(
    gateway.snapshot(new Set(), "/active/dir", "proj_main", {
      signal: abortCtrl.signal,
      liveness: true,
      candidateDirectories: [foreignDir],
    }),
    /cancelada|aborted/i
  );
});

test("authoritative routing: known busy and retry retained and protected", async t => {
  const foreignDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-foreign-busy-"));
  t.after(() => fs.rm(foreignDir, { recursive: true, force: true }));

  const sessionBusy: Session = {
    id: "ses_forbusy1",
    title: "Foreign Session Busy",
    directory: foreignDir,
    projectID: "proj_main",
    time: { created: 1000, updated: 1000 },
  };
  const sessionRetry: Session = {
    id: "ses_forretry1",
    title: "Foreign Session Retry",
    directory: foreignDir,
    projectID: "proj_main",
    time: { created: 1000, updated: 1000 },
  };

  const mockClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: [sessionBusy, sessionRetry],
          response: { headers: new Map() },
        }),
      },
    },
    path: {
      get: async () => ({
        data: { directory: foreignDir, worktree: foreignDir },
      }),
    },
    session: {
      status: async () => ({
        data: {
          ses_forbusy1: { type: "busy" },
          ses_forretry1: { type: "retry" },
        },
      }),
    },
  };

  const gateway = new OpenCodeGateway(mockClient, { activeDirectory: "/active/dir" });
  const snapshot = await gateway.snapshot(new Set(), "/active/dir", "proj_main", {
    liveness: true,
    candidateDirectories: [foreignDir],
  });

  assert.equal(snapshot.busy.has("ses_forbusy1"), true, "Known busy must be busy");
  assert.equal(snapshot.busy.has("ses_forretry1"), true, "Known retry must be busy");
  assert.equal(snapshot.unverified?.has("ses_forbusy1"), false, "Known busy is verified busy, not unverified");
  assert.equal(snapshot.unverified?.has("ses_forretry1"), false, "Known retry is verified retry, not unverified");
});

test("manual service path actual invocation proof no mocking Boolean bypass only", async t => {
  const { dir, store } = await createTestEnv(t, 0);
  const foreignDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-manual-invocation-"));
  t.after(() => fs.rm(foreignDir, { recursive: true, force: true }));

  const now = 1700000000000;
  // 11 active sessions (within retention 10, newest kept) + 1 old foreign session exceeding retention
  const sessions: Session[] = Array.from({ length: 11 }, (_, i) => ({
    id: `ses_act${i}`,
    title: `Active Session ${i}`,
    directory: "/demo",
    projectID: "proj_main",
    time: { created: now - i * 1000, updated: now - i * 1000 },
  }));
  sessions.push({
    id: "ses_forold1",
    title: "Foreign Old 1",
    directory: foreignDir,
    projectID: "proj_main",
    time: { created: now - 100000000, updated: now - 100000000 },
  });

  let pathInvocations = 0;
  let statusInvocations = 0;
  let exportInvocations = 0;
  let deleteInvocations = 0;

  const mockClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: structuredClone(sessions),
          response: { headers: new Map() },
        }),
      },
    },
    path: {
      get: async (params: any) => {
        pathInvocations++;
        return {
          data: {
            directory: params.directory ?? foreignDir,
            worktree: params.directory ?? foreignDir,
          },
        };
      },
    },
    session: {
      status: async () => {
        statusInvocations++;
        // Empty map: all idle
        return { data: {} };
      },
      get: async (params: any) => {
        const found = sessions.find(s => s.id === params.sessionID);
        return { data: found };
      },
      messages: async () => {
        exportInvocations++;
        return {
          data: [{ info: { id: "m1", time: { created: 100 } }, parts: [] }],
          response: { headers: new Map() },
        };
      },
      delete: async (params: any) => {
        deleteInvocations++;
        const idx = sessions.findIndex(s => s.id === params.sessionID);
        if (idx >= 0) sessions.splice(idx, 1);
        return { data: true };
      },
    },
  };

  const gateway = new OpenCodeGateway(mockClient, { activeDirectory: "/demo" });
  const service = new VaultService({
    store,
    gateway,
    projectID: "proj_main",
    projectDirectory: "/demo",
    active: () => new Set(),
  });

  // 1. Preview with manualApi: true
  const plan = await service.preview({ liveness: true, manualApi: true });
  assert.ok(plan.candidates.length > 0, "Foreign idle session must produce candidate");
  assert.equal(plan.candidates[0].root.id, "ses_forold1");
  assert.ok(pathInvocations > 0, "Real path.get must have been called (no boolean bypass)");
  assert.ok(statusInvocations > 0, "Real session.status must have been called");

  // 2. Safe cleanup execution
  const cleanupResult = await service.cleanup(plan, false, { manualApi: true });
  assert.equal(cleanupResult.deleted.length, 2);
  assert.ok(cleanupResult.deleted.includes("ses_forold1"));
  assert.ok(exportInvocations > 0, "Verified export backup must be called before delete");
  assert.ok(deleteInvocations > 0, "Actual delete must be invoked");

  // 3. Verify backup exists with status deleted
  const backups = await listBackups(store);
  assert.equal(backups.length, 2);
  assert.ok(backups.some(b => b.rootID === "ses_forold1" && b.status === "deleted"));
});

test("canonicalizeDirectory: Windows case, separators, root safe and no prefix false", () => {
  assert.equal(canonicalizeDirectory(""), "");
  assert.equal(canonicalizeDirectory(null as any), "");

  if (process.platform === "win32") {
    // Case folding
    assert.equal(
      canonicalizeDirectory("C:\\Users\\DELL\\Project"),
      canonicalizeDirectory("c:\\users\\dell\\project")
    );
    // Mixed separators
    assert.equal(
      canonicalizeDirectory("C:/Users/DELL/Project/"),
      canonicalizeDirectory("c:\\users\\dell\\project")
    );
    // Root safety
    const root = canonicalizeDirectory("C:\\");
    assert.match(root, /^[a-z]:\\$/);
  }

  // Prefix false: sibling directories with common prefix must NOT match
  assert.notEqual(
    canonicalizeDirectory("/foo/bar"),
    canonicalizeDirectory("/foo/bar_baz")
  );
  assert.notEqual(
    canonicalizeDirectory("/foo"),
    canonicalizeDirectory("/foo/bar")
  );
});

test("diagnoseDirectoryRouting: safe read-only identity diagnostic", async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-diag-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const mockClient: any = {
    path: {
      get: async () => ({
        data: { directory: tempDir, worktree: tempDir },
      }),
    },
  };
  const gateway = new OpenCodeGateway(mockClient, { activeDirectory: "/active/dir" });

  const diagSuccess = await gateway.diagnoseDirectoryRouting(tempDir);
  assert.equal(diagSuccess.existsOnDisk, true);
  assert.equal(diagSuccess.proven, true);
  assert.equal(typeof diagSuccess.canonicalDirectory, "string");

  const diagNonexistent = await gateway.diagnoseDirectoryRouting(path.join(tempDir, "missing"));
  assert.equal(diagNonexistent.existsOnDisk, false);
  assert.equal(diagNonexistent.proven, false);
  assert.equal(diagNonexistent.reason, "directory_not_found_on_disk");
});

test("UI regression cleanup rejection retains list and candados no false load error, no duplicate cleanup", async t => {
  const { service, store, gateway } = await createTestEnv(t, 15);
  await service.pin("ses_0");
  await service.pin("ses_5");

  service.allowed = async () => {
    throw new Error("Cierra las otras instancias de OpenCode antes de limpiar. Puedes seguir revisando y poniendo candados.");
  };

  let confirmationAction: ((v: string) => Promise<void>) | undefined;
  let confirmationClosed = false;

  const controller = createVaultNavigationController({
    service,
    manualApi: true,
    askConfirmation: (_title, _ph, action) => {
      confirmationAction = action;
      confirmationClosed = false;
    },
    closeConfirmation: () => {
      confirmationClosed = true;
    },
  });

  // 1. Open preview: plan is generated and has families
  await controller.openPreview();
  assert.equal(controller.canClean(), true, "Live preview with candidates can clean");
  const initialPlan = controller.plan();
  assert.ok(initialPlan);
  assert.equal(initialPlan.families.length > 0, true);
  const initialFamiliesCount = initialPlan.families.length;

  // 2. Trigger cleanup and confirm with LIMPIAR
  controller.clean();
  assert.ok(confirmationAction);

  await controller.run(async () => await confirmationAction!("LIMPIAR"));

  // 3. Cleanup rejection verification
  assert.equal(confirmationClosed, true, "Confirmation modal closes on rejection");
  assert.equal(controller.error(), true, "Error must be recorded");
  assert.equal(controller.operationError(), true, "Operation error is set on cleanup guard failure");
  assert.equal(controller.inventoryError(), false, "Inventory error must NOT be set on operation failure");
  assert.match(controller.message(), /Cierra las otras instancias de OpenCode/);

  // 4. Inventory and candados are RETAINED
  const preservedPlan = controller.plan();
  assert.ok(preservedPlan, "Plan must be preserved after cleanup rejection");
  assert.equal(preservedPlan.families.length, initialFamiliesCount, "List rows must remain intact");

  const state = controller.state();
  assert.ok(state);
  assert.equal(state.pins.includes("ses_0"), true, "Candados (pins) must be preserved");
  assert.equal(state.pins.includes("ses_5"), true, "Candados (pins) must be preserved");

  // 5. No false load error in inventory helpers
  const emptyMsg = emptyInventoryMessage({ busy: controller.busy(), error: controller.inventoryError(), hasPlan: Boolean(preservedPlan) });
  assert.notEqual(emptyMsg, "No se pudo cargar el inventario.", "Must NOT show false inventory load error");

  const countLabel = inventoryCountLabel({
    count: preservedPlan.families.length,
    pageStart: 0,
    pageSize: 6,
    busy: controller.busy(),
    error: controller.inventoryError(),
    hasPlan: true,
  });
  assert.notEqual(countLabel, "Error al cargar", "Count label must NOT show false load error");
  assert.match(countLabel, /1–6 de 15/, "Shows actual visible count range");

  // 6. Approved plan invalidated before unsafe retry
  assert.equal(controller.livePlan(), false, "Plan is no longer live after cleanup rejection");
  assert.equal(controller.canClean(), false, "Cannot clean without new preview (no duplicate cleanup)");

  const deletesBefore = gateway.removeCalls;
  controller.clean();
  assert.equal(gateway.removeCalls, deletesBefore, "No duplicate cleanup can execute");

  // 7. New preview updates clears prior operation error properly
  service.allowed = async () => {};
  await controller.openPreview();
  assert.equal(controller.operationError(), false, "New preview clears prior operation error");
  assert.equal(controller.error(), false, "Error flag cleared after fresh preview");
  assert.equal(controller.livePlan(), true, "New plan is live and valid");
  assert.equal(controller.canClean(), true, "Can clean with fresh valid preview");
});

// ---------------------------------------------------------------------------
// 8. TDD: Persistent Clear Last Manual API Cleanup Outcome
// ---------------------------------------------------------------------------

test("TDD: manual API cleanup exact 5 roots 9 sessions outcome with verified backup marker and durable persistence", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-exact-5roots-9sessions-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const now = 1700000000000;
  const day = 86400000;

  // 5 candidate families with 9 sessions total:
  // f0: root + c1 (2)
  // f1: root + c1 (2)
  // f2: root + c1 (2)
  // f3: root + c1 (2)
  // f4: root only (1)
  // Total = 9 sessions
  const sessions: Session[] = [
    // 10 retained recent sessions so candidate batch contains exactly the 5 old families
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `ses_recent${i}`,
      title: `Recent ${i}`,
      directory: "/demo",
      projectID: "proj_main",
      time: { created: now - i * 1000, updated: now - i * 1000 },
    })),
    // 5 old candidate families (updated > 2 days ago, outside graceHours)
    { id: "ses_fam0root", title: "Fam 0 Root", directory: "/demo", projectID: "proj_main", time: { created: now - 10 * day, updated: now - 10 * day } },
    { id: "ses_fam0c1", parentID: "ses_fam0root", title: "Fam 0 Child 1", directory: "/demo", projectID: "proj_main", time: { created: now - 10 * day, updated: now - 10 * day } },

    { id: "ses_fam1root", title: "Fam 1 Root", directory: "/demo", projectID: "proj_main", time: { created: now - 9 * day, updated: now - 9 * day } },
    { id: "ses_fam1c1", parentID: "ses_fam1root", title: "Fam 1 Child 1", directory: "/demo", projectID: "proj_main", time: { created: now - 9 * day, updated: now - 9 * day } },

    { id: "ses_fam2root", title: "Fam 2 Root", directory: "/demo", projectID: "proj_main", time: { created: now - 8 * day, updated: now - 8 * day } },
    { id: "ses_fam2c1", parentID: "ses_fam2root", title: "Fam 2 Child 1", directory: "/demo", projectID: "proj_main", time: { created: now - 8 * day, updated: now - 8 * day } },

    { id: "ses_fam3root", title: "Fam 3 Root", directory: "/demo", projectID: "proj_main", time: { created: now - 7 * day, updated: now - 7 * day } },
    { id: "ses_fam3c1", parentID: "ses_fam3root", title: "Fam 3 Child 1", directory: "/demo", projectID: "proj_main", time: { created: now - 7 * day, updated: now - 7 * day } },

    { id: "ses_fam4root", title: "Fam 4 Root", directory: "/demo", projectID: "proj_main", time: { created: now - 6 * day, updated: now - 6 * day } },
  ];

  const gateway = new MockGateway(sessions);
  const active = new Set<string>();
  const service = new VaultService({
    store,
    gateway,
    projectID: "proj_main",
    projectDirectory: "/demo",
    active: () => active,
  });

  let confirmationAction: ((v: string) => Promise<void>) | undefined;
  const controller = createVaultNavigationController({
    service,
    manualApi: true,
    askConfirmation: (_t, _p, action) => {
      confirmationAction = action;
    },
  });

  // 1. Open preview: exact 5 candidate families
  await controller.openPreview();
  const plan = controller.plan();
  assert.ok(plan);
  assert.equal(plan.candidates.length, 5, "Must have exactly 5 candidate families");
  const totalCandidateSessions = plan.candidates.reduce((sum, f) => sum + f.members.length, 0);
  assert.equal(totalCandidateSessions, 9, "Must have exactly 9 sessions across 5 candidate families");

  // 2. Clean and confirm with LIMPIAR
  controller.clean();
  assert.ok(confirmationAction);
  await controller.run(async () => await confirmationAction!("LIMPIAR"));

  // 3. Verify lastManualResult after clean
  const outcome = controller.lastManualResult();
  assert.ok(outcome, "Outcome must be set after cleanup");
  assert.equal(outcome.status, "success");
  assert.equal(outcome.deletedFamiliesCount, 5, "Roots count must be exactly 5");
  assert.equal(outcome.deletedSessionsCount, 9, "Members count must be exactly 9");
  assert.equal(outcome.targetFamiliesCount, 5);
  assert.equal(outcome.targetSessionsCount, 9);
  assert.equal(outcome.backupVerified, true, "Backups must have evidenced SHA-256 verification");
  assert.equal(outcome.uncertainDescendants, false);
  assert.equal(outcome.error, undefined);
  assert.ok(outcome.operationId, "Operation ID must be present");

  // 4. Navigation and refresh DO NOT clear lastManualResult
  controller.go("settings");
  assert.equal(controller.lastManualResult()?.deletedFamiliesCount, 5);
  controller.go("list");
  assert.equal(controller.lastManualResult()?.deletedFamiliesCount, 5);
  await controller.refresh();
  assert.equal(controller.lastManualResult()?.deletedFamiliesCount, 5, "Generic refresh must NOT clear outcome");

  // 5. New controller loads durable outcome from history
  const controller2 = createVaultNavigationController({
    service,
    manualApi: true,
  });
  await new Promise(r => setTimeout(r, 20));
  const persistedOutcome = controller2.lastManualResult();
  assert.ok(persistedOutcome, "New controller must load durable outcome from store history");
  assert.equal(persistedOutcome.status, "success");
  assert.equal(persistedOutcome.deletedFamiliesCount, 5);
  assert.equal(persistedOutcome.deletedSessionsCount, 9);
  assert.equal(persistedOutcome.backupVerified, true);

  // 6. Dismiss policy is optional and does NOT destroy durable history
  controller2.dismissLastManualResult();
  assert.equal(controller2.lastManualResult(), null, "Dismiss in-memory banner");

  const historyFiles = await fs.readdir(path.join(dir, "history"));
  assert.equal(historyFiles.length, 1, "Durable history file must be preserved on disk");

  // Re-reading from store still retrieves the outcome
  const loadedAgain = await store.getLastManualApiOutcome();
  assert.ok(loadedAgain);
  assert.equal(loadedAgain.deletedFamiliesCount, 5);
  assert.equal(loadedAgain.deletedSessionsCount, 9);
});

test("TDD: zero history none produces null lastManualResult without error", async t => {
  const { store, service } = await createTestEnv(t, 5);
  const controller = createVaultNavigationController({ service, manualApi: true });
  await new Promise(r => setTimeout(r, 20));

  assert.equal(controller.lastManualResult(), null);
  assert.equal(controller.inventoryError(), false);
  await controller.refresh();
  assert.equal(controller.lastManualResult(), null);
  assert.equal(controller.inventoryError(), false);
});

test("TDD: legacy history records honest unavailable (no fake 0)", async t => {
  const { dir, store, service } = await createTestEnv(t, 5);

  // Write a legacy history audit record without deletedSessionsCount or backupVerified
  const legacyRecord = {
    at: 1700000000000,
    mode: "manual-api",
    deleted: ["root_1", "root_2", "root_3", "root_4", "root_5"],
    skipped: [],
    archives: ["arch_1", "arch_2"],
  };
  await fs.mkdir(path.join(dir, "history"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "history", "1700000000000-legacy.json"),
    JSON.stringify(legacyRecord, null, 2)
  );

  const controller = createVaultNavigationController({ service, manualApi: true });
  await new Promise(r => setTimeout(r, 20));

  const outcome = controller.lastManualResult();
  assert.ok(outcome);
  assert.equal(outcome.status, "success");
  assert.equal(outcome.deletedFamiliesCount, 5);
  assert.equal(outcome.deletedSessionsCount, undefined, "Must be undefined (honest unavailable), NOT 0");
  assert.equal(outcome.backupVerified, false, "Must NOT claim backup verification without evidence");
});

test("TDD: partial outcome counts with uncertain API error on descendants", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-partial-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const now = 1700000000000;
  const day = 86400000;

  // 2 candidate families
  // f0: root + c1 (2 sessions)
  // f1: root + c1 + c2 (3 sessions)
  // Total = 5 sessions
  const sessions: Session[] = [
    // 10 retained recent sessions
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `ses_recent${i}`,
      title: `Recent ${i}`,
      directory: "/demo",
      projectID: "proj_main",
      time: { created: now - i * 1000, updated: now - i * 1000 },
    })),
    { id: "ses_fam0root", title: "Fam 0", directory: "/demo", projectID: "proj_main", time: { created: now - 10 * day, updated: now - 10 * day } },
    { id: "ses_fam0c1", parentID: "ses_fam0root", title: "Fam 0 Child", directory: "/demo", projectID: "proj_main", time: { created: now - 10 * day, updated: now - 10 * day } },
    { id: "ses_fam1root", title: "Fam 1", directory: "/demo", projectID: "proj_main", time: { created: now - 9 * day, updated: now - 9 * day } },
    { id: "ses_fam1c1", parentID: "ses_fam1root", title: "Fam 1 Child 1", directory: "/demo", projectID: "proj_main", time: { created: now - 9 * day, updated: now - 9 * day } },
    { id: "ses_fam1c2", parentID: "ses_fam1root", title: "Fam 1 Child 2", directory: "/demo", projectID: "proj_main", time: { created: now - 9 * day, updated: now - 9 * day } },
  ];

  const gateway = new MockGateway(sessions);
  // Fail on remove of second family
  let removeCalls = 0;
  const originalRemove = gateway.remove.bind(gateway);
  gateway.remove = async (s, opts) => {
    removeCalls++;
    if (removeCalls > 1) {
      throw new Error("Simulated network drop during family 2 remove");
    }
    return originalRemove(s, opts);
  };

  const service = new VaultService({
    store,
    gateway,
    projectID: "proj_main",
    projectDirectory: "/demo",
    active: () => new Set(),
  });

  let confirmationAction: ((v: string) => Promise<void>) | undefined;
  const controller = createVaultNavigationController({
    service,
    manualApi: true,
    askConfirmation: (_t, _p, action) => {
      confirmationAction = action;
    },
  });

  await controller.openPreview();
  assert.equal(controller.plan()?.candidates.length, 2);

  controller.clean();
  assert.ok(confirmationAction);

  await controller.run(async () => await confirmationAction!("LIMPIAR"));

  assert.equal(controller.operationError(), true, "Operation error must be set on partial failure");

  const outcome = controller.lastManualResult();
  assert.ok(outcome, "Outcome must be recorded even after partial failure");
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.deletedFamiliesCount, 1);
  assert.equal(outcome.deletedSessionsCount, 2);
  assert.equal(outcome.targetFamiliesCount, 2);
  assert.equal(outcome.targetSessionsCount, 5);
  assert.equal(outcome.uncertainDescendants, true, "API error on remove leaves descendants uncertain");
  assert.match(outcome.error ?? "", /Simulated network drop/);
});

test("TDD: load result failure must not hide inventory", async t => {
  const { service } = await createTestEnv(t, 10);

  // Mock store.getLastManualApiOutcome to throw an error
  service.store.getLastManualApiOutcome = async () => {
    throw new Error("Disk corruption or read failure in history");
  };

  const controller = createVaultNavigationController({ service, manualApi: true });
  await controller.run(controller.refresh);

  assert.equal(controller.inventoryError(), false, "Inventory must NOT report error if history fails");
  assert.ok(controller.plan(), "Plan must load normally");
  assert.equal(controller.plan()?.families.length, 10);
  assert.equal(controller.lastManualResult(), null, "Outcome is gracefully null on error");
});

test("TDD: dialog processing copy does not keep 'Escribe LIMPIAR' once processing; no auto retry", async t => {
  const { service, gateway } = await createTestEnv(t, 14);

  let confirmationTitle = "";
  let confirmationPlaceholder = "";
  let confirmationAction: ((v: string) => Promise<void>) | undefined;

  const controller = createVaultNavigationController({
    service,
    manualApi: true,
    askConfirmation: (title, ph, action) => {
      confirmationTitle = title;
      confirmationPlaceholder = ph;
      confirmationAction = action;
    },
  });

  await controller.openPreview();
  controller.clean();
  assert.equal(confirmationPlaceholder, "Escribe LIMPIAR");

  // While action runs, busy is true
  let executedOnce = false;
  let runningPromise: Promise<void> | undefined;

  const originalCleanup = service.cleanup.bind(service);
  service.cleanup = async (plan, auto, opts) => {
    // Assert that while cleanup is processing, controller is busy
    assert.equal(controller.busy(), true, "Controller must be busy during cleanup execution");
    executedOnce = true;
    return originalCleanup(plan, auto, opts);
  };

  await controller.run(async () => {
    await confirmationAction!("LIMPIAR");
  });

  assert.equal(executedOnce, true, "Cleanup executed exactly once");
  assert.equal(controller.busy(), false, "Controller is no longer busy after completion");
  assert.equal(controller.lastManualResult()?.status, "success");
});

test("TDD: outcome banner scope is 'última operación' not cumulative and never exposes private IDs", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-scope-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const now = 1700000000000;
  const day = 86400000;

  const sessions: Session[] = [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `ses_recent${i}`,
      title: `Recent ${i}`,
      directory: "/demo",
      projectID: "proj_main",
      time: { created: now - i * 1000, updated: now - i * 1000 },
    })),
    { id: "ses_pvtroot1", title: "Secret Private Root 1", directory: "/secret/path", projectID: "proj_main", time: { created: now - 10 * day, updated: now - 10 * day } },
    { id: "ses_pvtchild1", parentID: "ses_pvtroot1", title: "Secret Private Child", directory: "/secret/path", projectID: "proj_main", time: { created: now - 10 * day, updated: now - 10 * day } },
  ];

  const gateway = new MockGateway(sessions);
  const service = new VaultService({
    store,
    gateway,
    projectID: "proj_main",
    projectDirectory: "/demo",
    active: () => new Set(),
  });

  let confirmationAction: ((v: string) => Promise<void>) | undefined;
  const controller = createVaultNavigationController({
    service,
    manualApi: true,
    askConfirmation: (_t, _p, action) => {
      confirmationAction = action;
    },
  });

  await controller.openPreview();
  controller.clean();
  await controller.run(async () => await confirmationAction!("LIMPIAR"));

  const outcome = controller.lastManualResult();
  assert.ok(outcome);

  // Scope: exactly this single operation's counts (1 family, 2 sessions)
  assert.equal(outcome.deletedFamiliesCount, 1);
  assert.equal(outcome.deletedSessionsCount, 2);

  // Serialize outcome to JSON to verify no private session IDs or internal directories are stored in outcome fields
  const serialized = JSON.stringify(outcome);
  assert.equal(serialized.includes("ses_pvtroot1"), false, "Must NOT expose private session ID");
  assert.equal(serialized.includes("ses_pvtchild1"), false, "Must NOT expose private child ID");
  assert.equal(serialized.includes("/secret/path"), false, "Must NOT expose private directory path");
});

test("TDD: formatBytes and formatDeltaBytes format GiB, MiB, KiB and observed variation without claiming causality", async () => {
  // 25.45 GiB exact requirement: 25.45 * 1024^3 = 27326750720 bytes
  assert.equal(formatBytes(27326750720), "25.45 GiB");
  assert.equal(formatBytes(1073741824), "1.00 GiB");
  assert.equal(formatBytes(10485760), "10.0 MiB");
  assert.equal(formatBytes(1536), "1.5 KiB");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(-1), "—");
  assert.equal(formatBytes(NaN), "—");

  // Negative delta (freed / size reduced)
  assert.equal(formatDeltaBytes(-10485760), "-10.0 MiB");
  // Positive delta (size increased e.g. concurrent writes)
  assert.equal(formatDeltaBytes(2097152), "+2.0 MiB");
  // Zero variation
  assert.equal(formatDeltaBytes(0), "0 B");
});

test("TDD: manual API cleanup records physical stats before/after via injected readonly metrics backend", async t => {
  const { store, service, gateway } = await createTestEnv(t, 16);
  let confirmationAction: ((v: string) => Promise<void>) | undefined;

  let phase: "initial" | "post-cleanup" = "initial";
  const origRemove = gateway.remove.bind(gateway);
  gateway.remove = async (s) => {
    phase = "post-cleanup";
    return origRemove(s);
  };

  const controller = createVaultNavigationController({
    service,
    manualApi: true,
    askConfirmation: (_t, _p, action) => {
      confirmationAction = action;
    },
    helperClient: {
      getQuickDiskStats: () => {
        return phase === "initial"
          ? { dbPath: "/mock.db", sizeBytes: 1000000, exists: true, walSizeBytes: 50000 }
          : { dbPath: "/mock.db", sizeBytes: 950000, exists: true, walSizeBytes: 20000 };
      },
      inspectClaimed: async () => null,
      getReceipt: async () => null,
      getArmed: async () => null,
      inspectDatabase: async () => ({ dbPath: "/mock.db", sizeBytes: 950000, pageSize: 4096, freelistCount: 10, freeBytes: 40960, sessionCount: 50, tables: ["session"], integrity: "ok" }),
      generatePlan: async () => ({} as any),
    } as any,
  });

  await controller.openPreview();
  assert.ok(controller.canClean(), "Must be cleanable in preview");
  controller.clean();
  assert.ok(confirmationAction, "Confirmation action must be set");
  await controller.run(async () => await confirmationAction!("LIMPIAR"));

  const outcome = controller.lastManualResult();
  assert.ok(outcome);
  assert.equal(outcome.status, "success");
  assert.equal(outcome.deletedFamiliesCount, 5);
  assert.equal(outcome.dbSizeBytesBefore, 1000000);
  assert.equal(outcome.dbSizeBytesAfter, 950000);
  assert.equal(outcome.dbSizeDeltaBytes, -50000);
  assert.equal(outcome.walSizeBytesBefore, 50000);
  assert.equal(outcome.walSizeBytesAfter, 20000);

  // Durable store persistence retains before/after physical stats
  const fromHistory = await store.getLastManualApiOutcome();
  assert.ok(fromHistory);
  assert.equal(fromHistory.dbSizeBytesBefore, 1000000);
  assert.equal(fromHistory.dbSizeBytesAfter, 950000);
  assert.equal(fromHistory.dbSizeDeltaBytes, -50000);
});

test("TDD: metrics backend failure does NOT abort or couple to deletion", async t => {
  const { service } = await createTestEnv(t, 15);
  let confirmationAction: ((v: string) => Promise<void>) | undefined;

  const failingMetricsClient = {
    getQuickDiskStats: () => {
      throw new Error("Disk stat EACCES permission denied");
    },
    inspectClaimed: async () => null,
    getReceipt: async () => null,
    getArmed: async () => null,
    inspectDatabase: async () => ({ dbPath: "/mock.db", sizeBytes: 500000, pageSize: 4096, freelistCount: 0, freeBytes: 0, sessionCount: 20, tables: ["session"], integrity: "ok" }),
    generatePlan: async () => ({} as any),
  };

  const controller = createVaultNavigationController({
    service,
    manualApi: true,
    askConfirmation: (_t, _p, action) => {
      confirmationAction = action;
    },
    helperClient: failingMetricsClient as any,
  });

  await controller.openPreview();
  assert.ok(controller.canClean(), "Must be cleanable in preview");
  controller.clean();
  assert.ok(confirmationAction, "Confirmation action must be set");
  // Deletion must still succeed despite metrics error!
  await controller.run(async () => await confirmationAction!("LIMPIAR"));

  const outcome = controller.lastManualResult();
  assert.ok(outcome);
  assert.equal(outcome.status, "success");
  assert.equal(outcome.deletedFamiliesCount, 5);
  // Physical stats gracefully undefined without throwing or corrupting
  assert.equal(outcome.dbSizeBytesBefore, undefined);
  assert.equal(outcome.dbSizeBytesAfter, undefined);
  assert.equal(outcome.dbSizeDeltaBytes, undefined);
});
