import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../src/store.ts";
import { VaultService } from "../src/service.ts";
import type { Gateway, ExportData, GatewayOptions } from "../src/api.ts";
import type { Session, Snapshot } from "../src/model.ts";
import { createVaultNavigationController, MAINTENANCE_PAGE_SIZE } from "../src/ui-controller.ts";
import type { OfflinePlan, OfflineFamilySummary } from "../src/coordination.ts";

class MockGateway implements Gateway {
  sessions: Session[] = Array.from({ length: 14 }, (_, i) => ({
    id: `ses_${i}`,
    title: `Session ${i}`,
    directory: "/proj",
    projectID: "p1",
    time: {
      created: 1700000000000 - (i + 2) * 86400000,
      updated: 1700000000000 - (i + 2) * 86400000,
    },
  }));
  livenessCalls: boolean[] = [];
  shouldFailPreview = false;
  deleted: string[] = [];

  async list(): Promise<Session[]> {
    return structuredClone(this.sessions);
  }

  async snapshot(active: Set<string>, _dir?: string, _proj?: string, options?: GatewayOptions): Promise<Snapshot> {
    if (this.shouldFailPreview) {
      throw new Error("Simulated network/status error during preview snapshot");
    }
    this.livenessCalls.push(Boolean(options?.liveness));
    return {
      sessions: structuredClone(this.sessions),
      busy: new Set(),
      active,
    };
  }

  async exportSession(s: Session): Promise<ExportData> {
    return {
      info: structuredClone(s),
      messages: [{ info: { id: `msg_${s.id}`, role: "user" }, parts: [{ type: "text", text: "backup" }] }],
    };
  }

  async remove(s: Session): Promise<void> {
    this.deleted.push(s.id);
    this.sessions = this.sessions.filter(item => item.id !== s.id);
  }
}

async function createTestContext(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-ui-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const gateway = new MockGateway();
  const service = new VaultService({
    store,
    gateway,
    projectID: "p1",
    projectDirectory: "/proj",
    active: () => new Set(["ses_0"]),
  });
  return { store, gateway, service };
}

test("nested run in openPreview executes guarded refresh and enables live confirmation", async t => {
  const { service, gateway } = await createTestContext(t);

  let confirmationAsked = false;
  const controller = createVaultNavigationController({
    service,
    askConfirmation: () => {
      confirmationAsked = true;
    },
  });

  // Initial list refresh (liveness: false for browsing)
  await controller.run(controller.refresh);
  assert.equal(controller.screen(), "list");
  assert.equal(controller.livePlan(), false, "List browsing must not have livePlan");
  assert.equal(gateway.livenessCalls.includes(true), false, "List refresh must not request liveness");

  // Keyboard 'v' caller simulates run(openPreview)
  await controller.run(controller.openPreview);

  assert.equal(
    gateway.livenessCalls.includes(true),
    true,
    "Preview entry MUST execute refresh with liveness: true"
  );
  assert.equal(controller.livePlan(), true, "Successful preview MUST set livePlan: true");
  assert.equal(controller.canClean(), false, "Host without cross-instance exclusion must fail closed without candidates");

  // Attempting clean does not trigger confirmation when cannot clean
  controller.clean();
  assert.equal(confirmationAsked, false, "Confirmation must not be triggered without candidates");
});

test("keyboard caller (run(openPreview)) and click caller (openPreview()) both execute guarded refresh with liveness: true", async t => {
  const { service, gateway } = await createTestContext(t);

  const controller = createVaultNavigationController({ service });

  // 1. Keyboard caller: run(openPreview)
  gateway.livenessCalls = [];
  await controller.run(controller.openPreview);
  assert.equal(controller.screen(), "preview");
  assert.equal(controller.livePlan(), true);
  assert.equal(gateway.livenessCalls.filter(x => x === true).length, 1);

  // Return to list
  controller.go("list");
  assert.equal(controller.screen(), "list");
  assert.equal(controller.livePlan(), false);

  // 2. Click caller: openPreview() called directly without outer run
  gateway.livenessCalls = [];
  await controller.openPreview();
  assert.equal(controller.screen(), "preview");
  assert.equal(controller.livePlan(), true);
  assert.equal(gateway.livenessCalls.filter(x => x === true).length, 1);
});

test("stale/non-live plan must never be confirmable while refresh is pending", async t => {
  const { service } = await createTestContext(t);

  let confirmationAsked = false;
  const controller = createVaultNavigationController({
    service,
    askConfirmation: () => {
      confirmationAsked = true;
    },
  });

  // Load initial list
  await controller.run(controller.refresh);

  // Simulate entering preview where refresh is pending (busy = true)
  controller.go("preview");
  controller.setBusy(true);

  assert.equal(controller.canClean(), false, "Cannot clean while preview refresh is pending");
  controller.clean();
  assert.equal(confirmationAsked, false, "Confirmation must not be triggered while pending");
});

test("stale/non-live plan must never be confirmable if preview refresh fails", async t => {
  const { service, gateway } = await createTestContext(t);

  let confirmationAsked = false;
  const controller = createVaultNavigationController({
    service,
    askConfirmation: () => {
      confirmationAsked = true;
    },
  });

  // Load initial list plan
  await controller.run(controller.refresh);
  assert.ok(controller.plan(), "Initial plan loaded");

  // Cause preview refresh to fail
  gateway.shouldFailPreview = true;
  await controller.openPreview();

  assert.equal(controller.error(), true, "Error must be recorded");
  assert.equal(controller.livePlan(), false, "Plan must NOT be live after error");
  assert.equal(controller.canClean(), false, "Cannot clean after preview error");

  controller.clean();
  assert.equal(confirmationAsked, false, "Confirmation must not be triggered after failure");
});

test("cleanup is disabled when host cannot prove exclusion and candidates are zero", async t => {
  const { service, gateway } = await createTestContext(t);

  let confirmationAction: ((value: string) => Promise<void>) | undefined;
  const controller = createVaultNavigationController({
    service,
    askConfirmation: (_title, _ph, action) => {
      confirmationAction = action;
    },
  });

  await controller.openPreview();
  assert.equal(controller.canClean(), false);

  controller.clean();
  assert.equal(confirmationAction, undefined, "Confirmation action must not be provided when canClean is false");
  assert.equal(controller.error(), false);
  assert.equal(gateway.deleted.length, 0, "No candidates deleted on unproven exclusion host");
});

test("status message highlights unverified protected families in plan update", async t => {
  const { service, gateway } = await createTestContext(t);

  // Add an unverified session
  gateway.sessions.push({
    id: "ses_unv1",
    title: "Unverified Session",
    directory: "/foreign",
    projectID: "p2",
    time: { created: 1000, updated: 1000 },
  });

  const controller = createVaultNavigationController({ service });
  // Snapshot with unverified session
  const origSnapshot = gateway.snapshot.bind(gateway);
  gateway.snapshot = async (active, dir, proj, options) => {
    const res = await origSnapshot(active, dir, proj, options);
    res.unverified = new Set(["ses_unv1"]);
    return res;
  };

  await controller.run(controller.refresh);
  assert.match(controller.message(), /sin verificar protegidas/);
});

test("loadMaintenance truthful state: failure sets error and preserves undefined dbInspect without fake ok", async t => {
  const { service } = await createTestContext(t);

  // Mock helperClient that rejects inspectDatabase
  const mockHelperClient = {
    getReceipt: async () => null,
    getArmed: async () => null,
    inspectDatabase: async () => {
      throw new Error("El proceso helper excedió el tiempo de espera (30s) al inspeccionar la base de datos.");
    },
    generatePlan: async () => {
      throw new Error("Should not reach generatePlan if inspect fails");
    },
    getQuickDiskStats: () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 25000000000,
      exists: true,
    }),
  };

  const controller = createVaultNavigationController({
    service,
    helperClient: mockHelperClient as any,
  });

  await controller.loadMaintenance();

  assert.equal(controller.maintenanceLoading(), false);
  assert.match(controller.maintenanceError() ?? "", /excedió el tiempo de espera/);
  // dbInspect must NOT be a fake object with integrity: "ok"
  assert.equal(controller.dbInspect(), undefined);
});

function create20FamiliesOfflinePlan(): OfflinePlan {
  const selectedFamilies: OfflineFamilySummary[] = Array.from({ length: 20 }, (_, i) => ({
    rootId: `fam_${i}`,
    memberIds: [`ses_${i}_1`, `ses_${i}_2`],
    updated: 1700000000000 - i * 3600000,
    title: `Family ${i}`,
    members: [
      { id: `ses_${i}_1`, timeUpdated: 1700000000000 - i * 3600000 },
      { id: `ses_${i}_2`, timeUpdated: 1700000000000 - i * 3600000 },
    ],
  }));

  return {
    version: 1,
    createdAt: 1700000000000,
    expiresAt: 1700000300000,
    canonicalDbPath: "/mock/opencode.db",
    dbStat: { size: 1000000, mtimeMs: 1700000000000 },
    stateRevision: 1,
    statePins: ["ses_pinned_1"],
    scope: "project",
    projectID: "p1",
    profile: "mod",
    totalSessions: 100,
    totalFamilies: 50,
    candidateFamiliesCount: 20,
    retainedFamiliesCount: 30,
    selectedFamilies,
    quota: { signature: "sig", baseline: 50, keep: 30, at: 1700000000000 },
    snapshotHash: "hash_snapshot_abc123",
    dataVersion: 1,
    fingerprint: "fp_test_123",
  };
}

test("20 familias todas accesibles incl última lote EXACTO navegable y paginado", async t => {
  const { service } = await createTestContext(t);
  const plan20 = create20FamiliesOfflinePlan();

  const mockHelperClient = {
    getReceipt: async () => null,
    getArmed: async () => null,
    inspectDatabase: async () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 1000000,
      pageSize: 4096,
      freelistCount: 10,
      freeBytes: 40960,
      sessionCount: 100,
      tables: ["session"],
      integrity: "ok",
    }),
    generatePlan: async () => structuredClone(plan20),
    getQuickDiskStats: () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 1000000,
      exists: true,
    }),
  };

  const controller = createVaultNavigationController({
    service,
    helperClient: mockHelperClient as any,
  });

  await controller.loadMaintenance();

  assert.equal(controller.offlinePlan()?.selectedFamilies.length, 20);
  assert.equal(controller.maintenanceTotalPages(), Math.ceil(20 / MAINTENANCE_PAGE_SIZE)); // 4 pages
  assert.equal(controller.maintenancePage(), 0);

  // Page 0: first batch of families
  const page0 = controller.maintenanceVisibleFamilies();
  assert.equal(page0.length, MAINTENANCE_PAGE_SIZE);
  assert.equal(page0[0].rootId, "fam_0");

  // Navigate through all pages
  const collectedIds: string[] = [];
  for (let p = 0; p < controller.maintenanceTotalPages(); p++) {
    const visible = controller.maintenanceVisibleFamilies();
    for (const f of visible) {
      collectedIds.push(f.rootId);
    }
    if (p < controller.maintenanceTotalPages() - 1) {
      controller.nextMaintenancePage();
    }
  }

  // All 20 families must be visited in exact order
  assert.equal(collectedIds.length, 20);
  for (let i = 0; i < 20; i++) {
    assert.equal(collectedIds[i], `fam_${i}`, `Family ${i} must be accessible`);
  }

  // Direct indexing to the very last family (family 20, index 19)
  controller.setMaintenanceIndex(19);
  assert.equal(controller.maintenanceFocus(), 19);
  assert.equal(controller.maintenancePage(), 3);
  const lastPage = controller.maintenanceVisibleFamilies();
  const lastFamily = lastPage[lastPage.length - 1];
  assert.equal(lastFamily.rootId, "fam_19", "Last family (index 19) must be accessible");
});

test("contadores maintenance vs live consistentes", async t => {
  const { service, gateway } = await createTestContext(t);
  const plan20 = create20FamiliesOfflinePlan();

  // Configure gateway so live preview has 0 candidates
  gateway.snapshot = async (active) => ({
    sessions: [gateway.sessions[0]], // active session protected
    busy: new Set(),
    active,
  });

  const mockHelperClient = {
    getReceipt: async () => null,
    getArmed: async () => null,
    inspectDatabase: async () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 1000000,
      pageSize: 4096,
      freelistCount: 0,
      freeBytes: 0,
      sessionCount: 100,
      tables: ["session"],
      integrity: "ok",
    }),
    generatePlan: async () => structuredClone(plan20),
    getQuickDiskStats: () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 1000000,
      exists: true,
    }),
  };

  const controller = createVaultNavigationController({
    service,
    _trustedTestExecution: true,
    helperClient: mockHelperClient as any,
  });

  // 1. Live list refresh
  await controller.run(controller.refresh);
  assert.equal(controller.screen(), "list");
  assert.equal(controller.plan()?.candidates.length, 0, "Live candidates should be 0");
  assert.match(controller.message(), /^0 familias candidatas/);

  // 2. Navigate to maintenance
  controller.go("maintenance");
  await controller.loadMaintenance();

  assert.equal(controller.screen(), "maintenance");
  assert.equal(controller.offlinePlan()?.selectedFamilies.length, 20, "Offline batch should have 20 candidates");
  // In maintenance, message must report the offline batch, not live 0
  assert.match(controller.message(), /20 familias candidatas en lote fuera de línea/);

  // 3. Return to list restores live context
  controller.go("list");
  assert.equal(controller.screen(), "list");
  assert.match(controller.message(), /^0 familias candidatas/);
});

test("plan loading y error sin zeros falsos", async t => {
  const { service } = await createTestContext(t);

  let planCalled = false;
  const mockHelperClient = {
    getReceipt: async () => null,
    getArmed: async () => null,
    inspectDatabase: async () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 500000,
      pageSize: 4096,
      freelistCount: 0,
      freeBytes: 0,
      sessionCount: 10,
      tables: ["session"],
      integrity: "ok",
    }),
    generatePlan: async () => {
      planCalled = true;
      throw new Error("Fallo de I/O al leer catálogo de familias");
    },
    getQuickDiskStats: () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 500000,
      exists: true,
    }),
  };

  const controller = createVaultNavigationController({
    service,
    helperClient: mockHelperClient as any,
  });

  await controller.loadMaintenance();

  assert.equal(planCalled, true);
  assert.equal(controller.maintenanceLoading(), false);
  assert.match(controller.maintenanceError() ?? "", /Fallo de I\/O/);
  // Must NOT have a fake offlinePlan with 0 candidates or 0 families
  assert.equal(controller.offlinePlan(), undefined);
  assert.match(controller.message(), /Fallo de I\/O/);
  assert.doesNotMatch(controller.message(), /0 familias/);
});

test("paginación e invalidación de snapshot al refresh", async t => {
  const { service } = await createTestContext(t);
  let planVersion = 1;

  const mockHelperClient = {
    getReceipt: async () => null,
    getArmed: async () => null,
    inspectDatabase: async () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 1000000,
      pageSize: 4096,
      freelistCount: 0,
      freeBytes: 0,
      sessionCount: 100,
      tables: ["session"],
      integrity: "ok",
    }),
    generatePlan: async () => {
      const p = create20FamiliesOfflinePlan();
      p.snapshotHash = `hash_version_${planVersion}`;
      return p;
    },
    getQuickDiskStats: () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 1000000,
      exists: true,
    }),
    armAndSpawn: async (opts: any) => {
      return { armed: { ...opts.plan, armedAt: Date.now(), ownerPid: 1234 } };
    },
  };

  let confirmationAction: ((value: string) => Promise<void>) | undefined;
  const controller = createVaultNavigationController({
    service,
    _trustedTestExecution: true,
    helperClient: mockHelperClient as any,
    askConfirmation: (_t, _p, action) => {
      confirmationAction = action;
    },
  });

  await controller.loadMaintenance();
  assert.equal(controller.maintenancePage(), 0);

  // Navigate to page 2 / index 14
  controller.setMaintenanceIndex(14);
  assert.equal(controller.maintenancePage(), 2);
  assert.equal(controller.maintenanceFocus(), 14);

  // Trigger arm dialog to capture snapshot
  controller.armMaintenance();
  assert.ok(confirmationAction, "Confirmation dialog was opened");

  // Before user confirms, plan is refreshed with new snapshot
  planVersion = 2;
  await controller.loadMaintenance();

  // Page and focus are reset upon refresh
  assert.equal(controller.maintenancePage(), 0);
  assert.equal(controller.maintenanceFocus(), 0);

  // Trying to execute the old confirmation action fails closed because plan was invalidated
  await assert.rejects(
    async () => {
      await confirmationAction!("LIMPIAR");
    },
    /El plan de mantenimiento cambió o fue invalidado/
  );
});

test("keyboard navigation busy safe", async t => {
  const { service } = await createTestContext(t);
  const plan20 = create20FamiliesOfflinePlan();

  const mockHelperClient = {
    getReceipt: async () => null,
    getArmed: async () => null,
    inspectDatabase: async () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 1000000,
      pageSize: 4096,
      freelistCount: 0,
      freeBytes: 0,
      sessionCount: 100,
      tables: ["session"],
      integrity: "ok",
    }),
    generatePlan: async () => structuredClone(plan20),
    getQuickDiskStats: () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 1000000,
      exists: true,
    }),
  };

  const controller = createVaultNavigationController({
    service,
    helperClient: mockHelperClient as any,
  });

  await controller.loadMaintenance();
  assert.equal(controller.maintenancePage(), 0);
  assert.equal(controller.maintenanceFocus(), 0);

  // When busy is true, navigation calls are safely ignored
  controller.setBusy(true);
  controller.nextMaintenancePage();
  assert.equal(controller.maintenancePage(), 0, "nextMaintenancePage must be ignored when busy");
  controller.setMaintenanceIndex(10);
  assert.equal(controller.maintenanceFocus(), 0, "setMaintenanceIndex must be ignored when busy");
  controller.prevMaintenancePage();
  assert.equal(controller.maintenancePage(), 0, "prevMaintenancePage must be ignored when busy");

  // When maintenanceLoading is true, navigation calls are safely ignored
  controller.setBusy(false);
  controller.loadMaintenance(); // async call, loading starts
  controller.nextMaintenancePage();
  assert.equal(controller.maintenancePage(), 0, "nextMaintenancePage must be ignored when loading");
  controller.setMaintenanceIndex(15);
  assert.equal(controller.maintenanceFocus(), 0, "setMaintenanceIndex must be ignored when loading");
});

test("canArmMaintenance truthful states across loading, error, armed and empty", async t => {
  const { service } = await createTestContext(t);
  const plan20 = create20FamiliesOfflinePlan();

  const mockHelperClient = {
    getReceipt: async () => null,
    getArmed: async () => null,
    inspectDatabase: async () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 1000000,
      pageSize: 4096,
      freelistCount: 0,
      freeBytes: 0,
      sessionCount: 100,
      tables: ["session"],
      integrity: "ok",
    }),
    generatePlan: async () => structuredClone(plan20),
    getQuickDiskStats: () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 1000000,
      exists: true,
    }),
  };

  const controller = createVaultNavigationController({
    service,
    _trustedTestExecution: true,
    helperClient: mockHelperClient as any,
  });

  // Initially before loading, canArmMaintenance is false
  assert.equal(controller.canArmMaintenance(), false);

  // Load maintenance successfully
  await controller.loadMaintenance();
  assert.equal(controller.canArmMaintenance(), true, "Should be true when plan has candidates and ready");

  // When busy, canArmMaintenance is false
  controller.setBusy(true);
  assert.equal(controller.canArmMaintenance(), false);
  controller.setBusy(false);
  assert.equal(controller.canArmMaintenance(), true);

  // When error is set, canArmMaintenance is false
  controller.setMaintenanceError("Error de prueba");
  assert.equal(controller.canArmMaintenance(), false);
  controller.setMaintenanceError(undefined);
  assert.equal(controller.canArmMaintenance(), true);

  // When already armed, canArmMaintenance is false
  controller.setArmedPlan({
    version: 1,
    id: "armed-123",
    armedAt: Date.now(),
    expiresAt: Date.now() + 300000,
    ownerPid: 9999,
    plan: plan20,
    status: "armed",
  });
  assert.equal(controller.canArmMaintenance(), false, "Should be false when plan is already armed");
  controller.setArmedPlan(undefined);
  assert.equal(controller.canArmMaintenance(), true);

  // When candidate families count is 0, canArmMaintenance is false
  const emptyPlan = structuredClone(plan20);
  emptyPlan.selectedFamilies = [];
  controller.setOfflinePlan(emptyPlan);
  assert.equal(controller.canArmMaintenance(), false, "Should be false when 0 candidates");
});

test("maintenance confirmation dialog: factual prompt, Esc cancels without arming, Enter validates LIMPIAR", async t => {
  const { service } = await createTestContext(t);
  const plan20 = create20FamiliesOfflinePlan();

  let spawned = false;
  const mockHelperClient = {
    getReceipt: async () => null,
    getArmed: async () => null,
    inspectDatabase: async () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 1000000,
      pageSize: 4096,
      freelistCount: 0,
      freeBytes: 0,
      sessionCount: 100,
      tables: ["session"],
      integrity: "ok",
    }),
    generatePlan: async () => structuredClone(plan20),
    getQuickDiskStats: () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 1000000,
      exists: true,
    }),
    armAndSpawn: async (opts: any) => {
      spawned = true;
      return {
        armed: {
          version: 1,
          id: "armed-uuid-123",
          armedAt: Date.now(),
          expiresAt: Date.now() + 300000,
          ownerPid: opts.ownerPid,
          plan: opts.plan,
          status: "armed",
        },
      };
    },
  };

  let capturedTitle = "";
  let capturedPlaceholder = "";
  let capturedDescription = "";
  let capturedAction: ((value: string) => Promise<void>) | undefined;

  const controller = createVaultNavigationController({
    service,
    _trustedTestExecution: true,
    helperClient: mockHelperClient as any,
    askConfirmation: (title, placeholder, action, description) => {
      capturedTitle = title;
      capturedPlaceholder = placeholder;
      capturedAction = action;
      capturedDescription = description ?? "";
    },
  });

  await controller.loadMaintenance();

  // Trigger arming dialog
  controller.armMaintenance();

  // Verify dialog contents
  assert.match(capturedTitle, /Armar mantenimiento para 20 familias tras cerrar OpenCode/);
  assert.equal(capturedPlaceholder, "Escribe LIMPIAR");
  assert.doesNotMatch(capturedDescription, /30s|garantizado/i);
  assert.doesNotMatch(capturedDescription, /Advertencia: no aprobar hasta disponer de monitor de finalización/i);
  assert.doesNotMatch(capturedDescription, /sin ventana ni señal externa/i);
  assert.match(capturedDescription, /ventana de monitorización visible/i);
  assert.match(capturedDescription, /seguro volver a abrirlo/i);
  assert.ok(capturedAction);

  // 1. Esc simulation: user presses Esc, so action is NEVER invoked
  // Verify plan remains unarmed
  assert.equal(spawned, false);
  assert.equal(controller.armedPlan(), undefined);

  // 2. User presses Enter without typing LIMPIAR (e.g. empty or wrong text)
  await assert.rejects(
    async () => {
      await capturedAction!("");
    },
    /Escribe LIMPIAR para confirmar el armado/
  );
  assert.equal(spawned, false);
  assert.equal(controller.armedPlan(), undefined);

  await assert.rejects(
    async () => {
      await capturedAction!("limpiar"); // lower case rejected
    },
    /Escribe LIMPIAR para confirmar el armado/
  );
  assert.equal(spawned, false);
  assert.equal(controller.armedPlan(), undefined);

  // 3. User types exact "LIMPIAR" and presses Enter
  await capturedAction!("LIMPIAR");
  assert.equal(spawned, true);
  assert.equal(controller.armedPlan()?.id, "armed-uuid-123");
  assert.doesNotMatch(controller.message(), /30s/i);
  assert.match(controller.message(), /Monitor visible activo/i);
  assert.match(controller.message(), /indicará cuándo volver a abrirlo/i);
});

test("TDD: controller loads DB stats lazily and stat failure never blocks inventory", async t => {
  const { service } = await createTestContext(t);

  let inspectCalled = 0;
  const mockHelper = {
    getQuickDiskStats: () => ({
      dbPath: "/mock/opencode.db",
      sizeBytes: 27326750720, // 25.45 GiB
      exists: true,
      walSizeBytes: 15728640, // 15.0 MiB
    }),
    inspectDatabase: async () => {
      inspectCalled++;
      return {
        dbPath: "/mock/opencode.db",
        sizeBytes: 27326750720,
        pageSize: 4096,
        freelistCount: 307200, // 1.20 GiB
        freeBytes: 307200 * 4096,
        sessionCount: 500,
        tables: ["session"],
        integrity: "ok",
      };
    },
    inspectClaimed: async () => null,
    getReceipt: async () => null,
    getArmed: async () => null,
    generatePlan: async () => ({} as any),
  };

  const controller = createVaultNavigationController({
    service,
    helperClient: mockHelper as any,
  });

  await controller.loadDbStats();
  assert.equal(controller.dbStatsLoading(), false);
  assert.equal(controller.dbStatsError(), undefined);
  assert.equal(controller.quickDisk()?.sizeBytes, 27326750720);
  assert.equal(controller.quickDisk()?.walSizeBytes, 15728640);
  assert.equal(controller.dbInspect()?.freeBytes, 1258291200); // 1.17 GiB

  // Failure scenario: inspect throws error -> must NOT block inventory
  const failingHelper = {
    getQuickDiskStats: () => {
      throw new Error("Disk unavailable");
    },
    inspectDatabase: async () => {
      throw new Error("SQLite inspect timeout");
    },
    inspectClaimed: async () => null,
    getReceipt: async () => null,
    getArmed: async () => null,
    generatePlan: async () => ({} as any),
  };

  const controller2 = createVaultNavigationController({
    service,
    helperClient: failingHelper as any,
  });

  // Refreshing inventory must succeed completely even if db stats fail!
  await controller2.refresh();
  assert.equal(controller2.inventoryError(), false, "Inventory must NOT fail on stat error");
  assert.ok(controller2.plan(), "Plan must be present");
});

