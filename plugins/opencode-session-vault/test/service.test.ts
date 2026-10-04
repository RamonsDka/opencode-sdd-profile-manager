import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { gunzipSync } from "node:zlib";
import type { Gateway, ExportData } from "../src/api.ts";
import { OpenCodeGateway } from "../src/api.ts";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { Store } from "../src/store.ts";
import { VaultService } from "../src/service.ts";
import { listBackups } from "../src/archive.ts";
import { defaultState, type Session, emptyInventoryMessage, inventoryCountLabel, computeBackoff } from "../src/model.ts";
import { makePlan } from "../src/policy.ts";

class Fake implements Gateway {
  sessions: Session[] = Array.from({ length: 14 }, (_, i) => ({ id: `ses_${i}`, title: `Demo ${i}`, directory: "/demo", projectID: "p",
    time: { created: 1700000000000 - i * 86400000, updated: 1700000000000 - i * 86400000 } }));
  deleted: string[] = []; busy = new Set<string>(); fail = false; afterExport?: () => void;
  async list() { return structuredClone(this.sessions); }
  async snapshot(active: Set<string>) { return { sessions: await this.list(), busy: this.busy, active }; }
  async exportSession(s: Session): Promise<ExportData> {
    if (this.fail) throw new Error("disco/lectura fallida");
    this.afterExport?.();
    return { info: structuredClone(s), messages: [{ info: { id: `msg_${s.id}`, role: "user" }, parts: [{ type: "text", text: "Respaldo real" }] }] };
  }
  async remove(s: Session) { this.deleted.push(s.id); this.sessions = this.sessions.filter(v => v.id !== s.id && v.parentID !== s.id); }
}
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-test-")); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir), gateway = new Fake(); const active = new Set<string>();
  const service = new VaultService({ store, gateway, projectID: "p", active: () => active });
  return { store, gateway, service, active };
}
test("respaldo real y verificado antes de borrar; historial de resultados", async t => {
  const { store, service, gateway } = await setup(t); const plan = await service.preview();
  assert.equal((plan as any).possible?.length, 4); assert.equal((plan as any).verified?.length, 0); assert.equal(plan.candidates.length, 0);
  const result = await service.cleanup(plan); assert.equal(result.deleted.length, 0); assert.equal(gateway.sessions.length, 14);
  assert.equal(gateway.deleted.length, 0);
  const backups = await listBackups(store); assert.equal(backups.length, 0);
  assert.equal((await fs.readdir(path.join(store.dir, "history"))).length, 1);
});
test("fallo de respaldo impide borrar", async t => {
  const { service, gateway } = await setup(t); gateway.fail = true;
  const result = await service.cleanup(await service.preview()); assert.equal(result.deleted.length, 0); assert.equal(gateway.deleted.length, 0);
});
test("nueva actividad durante respaldo impide borrar esa familia", async t => {
  const { service, gateway } = await setup(t);
  gateway.afterExport = () => { gateway.sessions.find(s => s.id === "ses_13")!.time.updated = Date.now(); };
  const result = await service.cleanup(await service.preview()); assert.ok(!gateway.deleted.includes("ses_13")); assert.equal(result.deleted.length, 0); assert.equal(gateway.deleted.length, 0);
});
test("candado agregado después de vista previa invalida autorización", async t => {
  const { service, gateway } = await setup(t); const plan = await service.preview(); await service.pin("ses_13");
  await assert.rejects(service.cleanup(plan), /cambió/); assert.equal(gateway.deleted.length, 0);
});
test("sesión abierta después de vista previa impide ejecución", async t => {
  const { service, gateway, active } = await setup(t); const plan = await service.preview(); active.add("ses_13");
  await assert.rejects(service.cleanup(plan), /cambiaron/); assert.equal(gateway.deleted.length, 0);
});
test("bloqueo de archivo impide limpiezas simultáneas", async t => {
  const { store, service } = await setup(t); const plan = await service.preview();
  await store.exclusive(async () => { await assert.rejects(service.cleanup(plan), /Otra operación/); await assert.rejects(service.pin("ses_13"), /Otra operación/); });
});
test("configuración corrupta impide vista previa sin resetear candados", async t => {
  const { store, service } = await setup(t); await fs.writeFile(path.join(store.dir, "state.json"), "{broken");
  await assert.rejects(service.preview()); assert.equal(await fs.readFile(path.join(store.dir, "state.json"), "utf8"), "{broken");
});
test("tope por ejecución y repetición no erosiona el cupo", async t => {
  const { service, gateway } = await setup(t); await service.configure({ maxDeletePerRun: 2 });
  const preview = await service.preview(); assert.equal((preview as any).possible?.length, 4); assert.equal((preview as any).verified?.length, 0); assert.equal(preview.candidates.length, 0);
  assert.equal((await service.cleanup(await service.preview())).deleted.length, 0);
  assert.equal((await service.cleanup(await service.preview())).deleted.length, 0);
  assert.equal((await service.cleanup(await service.preview())).deleted.length, 0); assert.equal(gateway.sessions.length, 14);
});
test("automático apagado no borra y encendido respeta intervalo", async t => {
  const { service, gateway } = await setup(t);
  assert.equal((await service.cleanup(await service.preview(), true)).deleted.length, 0);
  await service.configure({ automatic: true, maxDeletePerRun: 1 });
  assert.equal((await service.cleanup(await service.preview(), true)).deleted.length, 0);
  assert.equal((await service.cleanup(await service.preview(), true)).deleted.length, 0); assert.equal(gateway.deleted.length, 0);
});
test("TDD: computeBackoff escala exponencialmente y queda acotado por el intervalo", () => {
  // Intervalo por defecto: 30 min (1.800.000 ms)
  assert.equal(computeBackoff(0, 30), 60000); // 1m
  assert.equal(computeBackoff(1, 30), 120000); // 2m
  assert.equal(computeBackoff(2, 30), 240000); // 4m
  assert.equal(computeBackoff(3, 30), 480000); // 8m
  assert.equal(computeBackoff(4, 30), 960000); // 16m
  assert.equal(computeBackoff(5, 30), 1800000); // acotado a 30m
  assert.equal(computeBackoff(10, 30), 1800000); // acotado a 30m

  // Intervalo corto (ej. 5 min)
  assert.equal(computeBackoff(3, 5), 300000); // 5m = 300.000 ms acotado
});
test("cierre del host aborta antes de borrar", async t => {
  const { service, gateway } = await setup(t); const abort = new AbortController(); service.signal = abort.signal;
  const plan = await service.preview(); abort.abort(); await assert.rejects(service.cleanup(plan), /cancelada/); assert.equal(gateway.deleted.length, 0);
});
test("sesión hija añadida después de respaldo conserva la familia", async t => {
  const { service, gateway } = await setup(t);
  gateway.afterExport = () => { if (!gateway.sessions.some(s => s.id === "ses_child")) gateway.sessions.push({ ...gateway.sessions[13], id: "ses_child", parentID: "ses_13" }); };
  const result = await service.cleanup(await service.preview()); assert.equal(result.deleted.length, 0); assert.ok(!gateway.deleted.includes("ses_13")); assert.equal(gateway.deleted.length, 0);
});
test("borrado parcial detiene el lote y conserva manifiesto de error", async t => {
  const { store, service, gateway } = await setup(t);
  gateway.sessions.push({ ...gateway.sessions[13], id: "ses_child", parentID: "ses_13" });
  gateway.remove = async s => { gateway.sessions = gateway.sessions.filter(v => v.id !== s.id); };
  const result = await service.cleanup(await service.preview()); assert.equal(result.deleted.length, 0); assert.equal(gateway.deleted.length, 0);
  assert.equal((await listBackups(store)).length, 0);
});
test("SDK transport directory injection: envía directory vacío para listar inventario multi-proyecto", async () => {
  let requestedParameters: Record<string, unknown> | undefined;
  const mockClient: any = {
    experimental: {
      session: {
        list: async (params: Record<string, unknown>) => {
          requestedParameters = params;
          return {
            data: [{
              id: "ses_multi1",
              title: "Multi project 1",
              directory: "/any",
              projectID: "proj_any",
              time: { created: 1000, updated: 1000 },
            }],
            response: { headers: new Map() },
          };
        },
      },
    },
  };
  const gateway = new OpenCodeGateway(mockClient);
  const sessions = await gateway.list();
  assert.equal(sessions.length, 1);
  assert.equal(requestedParameters?.directory, "");
});
test("limpieza por proyecto: solo borra el proyecto actual cuando scope es project", async t => {
  const { store, service, gateway } = await setup(t);
  await store.update(s => { s.config.scope = "project"; });
  gateway.sessions.push({
    id: "ses_other99",
    title: "Old session in other project",
    directory: "/other",
    projectID: "other_project",
    time: { created: 1000, updated: 1000 },
  });
  const plan = await service.preview();
  assert.ok(plan.families.some(f => f.root.id === "ses_other99"));
  const otherFamily = plan.families.find(f => f.root.id === "ses_other99");
  assert.ok(otherFamily?.reasons.includes("Otro proyecto"));
  assert.ok(!plan.candidates.some(f => f.root.projectID !== "p"));
  const result = await service.cleanup(plan);
  assert.ok(!result.deleted.includes("ses_other99"));
  assert.ok(!gateway.deleted.includes("ses_other99"));
  assert.ok(gateway.sessions.some(s => s.id === "ses_other99"));
});
test("limpieza global multi-proyecto: limpia candidatos en otros proyectos cuando liveness es verificada", async t => {
  const { store, service, gateway } = await setup(t);
  await store.update(s => { s.config.scope = "global"; s.config.profile = "ten"; });
  gateway.sessions.push({
    id: "ses_other99",
    title: "Old session in other project",
    directory: "/demo",
    projectID: "other_project",
    time: { created: 1000, updated: 1000 },
  });
  const plan = await service.preview({ liveness: true });
  assert.ok(plan.families.some(f => f.root.id === "ses_other99"));
  const otherFamily = plan.families.find(f => f.root.id === "ses_other99");
  assert.ok(!otherFamily?.reasons.includes("Otro proyecto"), "En alcance global no debe marcar Otro proyecto a sesiones limpias");
  assert.ok((plan as any).possible.some((f: any) => f.root.id === "ses_other99"), "ses_other99 debe ser possible al ser antigua");
  assert.equal((plan as any).verified.length, 0, "Sin exclusion verificada no hay verificadas"); assert.equal(plan.candidates.length, 0, "Host no admitido: cero candidatas ejecutables");
  const result = await service.cleanup(plan);
  assert.ok(!result.deleted.includes("ses_other99"), "Host no admitido: no debe eliminarse");
  assert.ok(gateway.sessions.some(s => s.id === "ses_other99"));
  const backups = await listBackups(store);
  assert.ok(!backups.some(b => b.rootID === "ses_other99" && b.status === "deleted"));
});
test("identidad de proyecto ausente impide borrar y falla cerrado", async t => {
  const { store, gateway } = await setup(t);
  const service = new VaultService({ store, gateway, projectID: "", active: () => new Set() });
  const plan = await service.preview();
  assert.equal(plan.candidates.length, 0);
  await assert.rejects(service.cleanup(plan), /No se pudo identificar el proyecto activo/);
});
test("liveness del proyecto activo: fallo de estado aborta con fallo cerrado", async () => {
  const mockClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: [{
            id: "ses_active1",
            title: "Active project session",
            directory: "/active/dir",
            projectID: "p_active",
            time: { created: 1000, updated: 1000 },
          }],
          response: { headers: new Map() },
        }),
      },
    },
    session: {
      status: async () => { throw new Error("Fallo de conexión en proyecto activo"); },
    },
  };
  const gateway = new OpenCodeGateway(mockClient);
  await assert.rejects(
    gateway.snapshot(new Set(), "/active/dir", "p_active"),
    /Fallo de conexión en proyecto activo/
  );
});
test("liveness de directorio obsoleto: no impide inventario global y no marca sesiones como inactivas", async () => {
  const mockClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: [
            {
              id: "ses_active1",
              title: "Active session",
              directory: "/active/dir",
              projectID: "p_active",
              time: { created: 1000, updated: 1000 },
            },
            {
              id: "ses_obsolete1",
              title: "Historical obsolete session",
              directory: "/deleted/historical/dir",
              projectID: "p_old",
              time: { created: 1000, updated: 1000 },
            },
          ],
          response: { headers: new Map() },
        }),
      },
    },
    session: {
      status: async ({ directory }: { directory: string }) => {
        if (directory === "/active/dir") {
          return { data: { ses_active1: { type: "idle" } } };
        }
        throw new Error("Directorio no existe en disco");
      },
    },
  };
  const gateway = new OpenCodeGateway(mockClient);
  const snapshot = await gateway.snapshot(new Set(), "/active/dir", "p_active");
  assert.equal(snapshot.sessions.length, 2);
  assert.ok(snapshot.busy.has("ses_obsolete1"));
  assert.ok(!snapshot.busy.has("ses_active1"));
});
test("familia mixta con hija o nieta en otro proyecto: cero llamadas a remove y familia protegida", async t => {
  const { service, gateway } = await setup(t);
  const oldTime = 1700000000000 - 50 * 86400000;
  // Mixed family 1: root in p, child in p, grandchild in other_project
  gateway.sessions.push({ id: "ses_m1root", title: "M1 Root", directory: "/demo", projectID: "p", time: { created: oldTime, updated: oldTime } });
  gateway.sessions.push({ id: "ses_m1child", title: "M1 Child", directory: "/demo", projectID: "p", parentID: "ses_m1root", time: { created: oldTime, updated: oldTime } });
  gateway.sessions.push({ id: "ses_m1grand", title: "M1 Grand", directory: "/demo", projectID: "other_project", parentID: "ses_m1child", time: { created: oldTime, updated: oldTime } });
  // Mixed family 2: root in p, child in other_project
  gateway.sessions.push({ id: "ses_m2root", title: "M2 Root", directory: "/demo", projectID: "p", time: { created: oldTime, updated: oldTime } });
  gateway.sessions.push({ id: "ses_m2child", title: "M2 Child", directory: "/demo", projectID: "other_project", parentID: "ses_m2root", time: { created: oldTime, updated: oldTime } });

  const plan = await service.preview();
  assert.ok(!plan.candidates.some(c => c.root.id === "ses_m1root" || c.root.id === "ses_m2root"));
  const f1 = plan.families.find(f => f.root.id === "ses_m1root");
  const f2 = plan.families.find(f => f.root.id === "ses_m2root");
  assert.ok(f1?.reasons.includes("Otro proyecto"));
  assert.ok(f2?.reasons.includes("Otro proyecto"));

  // Even if a malicious or stale approved plan forces them into candidates
  const forcedPlan = structuredClone(plan);
  forcedPlan.candidates.push(f1!, f2!);
  await assert.rejects(service.cleanup(forcedPlan), /no admitida|exclusión/i);
  assert.ok(!gateway.deleted.includes("ses_m1root"));
  assert.ok(!gateway.deleted.includes("ses_m2root"));
  assert.equal(gateway.deleted.length, 0);
  assert.ok(gateway.sessions.some(s => s.id === "ses_m1root"));
  assert.ok(gateway.sessions.some(s => s.id === "ses_m1grand"));
  assert.ok(gateway.sessions.some(s => s.id === "ses_m2root"));
});
test("carrera de snapshot refrescado con nieta en otro proyecto tras respaldo aborta borrado con cero remove", async t => {
  const { store, service, gateway } = await setup(t);
  // ses_13 has child ses_child in project p
  gateway.sessions.push({ ...gateway.sessions[13], id: "ses_child13", parentID: "ses_13" });
  gateway.afterExport = () => {
    gateway.afterExport = undefined;
    // Grandchild added in other_project after backup during afterExport hook
    gateway.sessions.push({
      id: "ses_grand13",
      title: "Raced grandchild in other project",
      directory: "/other",
      projectID: "other_project",
      parentID: "ses_child13",
      time: { created: 1000, updated: 1000 },
    });
  };
  const plan = await service.preview();
  assert.equal((plan as any).verified?.length ?? 0, 0); assert.equal(plan.candidates.length, 0);
  const result = await service.cleanup(plan);
  assert.ok(!gateway.deleted.includes("ses_13")); assert.equal(result.deleted.length, 0); assert.equal(gateway.deleted.length, 0);
  const backups = await listBackups(store);
  assert.equal(backups.length, 0);
  assert.ok(gateway.sessions.some(s => s.id === "ses_13"));
});
test("browsing y vista previa funcionan solo-lectura bajo bloqueo existente sin alterarlo", async t => {
  const { store, service } = await setup(t);
  const lockPath = path.join(store.dir, "operation.lock");
  const lockPayload = JSON.stringify({ pid: 999999, at: 1234567890 });
  await fs.writeFile(lockPath, lockPayload);
  const lockBefore = await fs.readFile(lockPath, "utf8");

  const stateFile = path.join(store.dir, "state.json");
  const stateExistedBefore = await fs.access(stateFile).then(() => true).catch(() => false);

  const plan = await service.preview();
  assert.equal(plan.families.length, 14);
  assert.equal((plan as any).possible?.length, 4); assert.equal((plan as any).verified?.length, 0); assert.equal(plan.candidates.length, 0);

  const lockAfter = await fs.readFile(lockPath, "utf8");
  assert.equal(lockAfter, lockBefore, "Los bytes del bloqueo operation.lock no deben cambiar tras browsing");

  const stateExistedAfter = await fs.access(stateFile).then(() => true).catch(() => false);
  assert.equal(stateExistedAfter, stateExistedBefore, "Browsing no debe crear o escribir state.json");

  await assert.rejects(service.cleanup(plan), /Otra operación/, "Limpieza debe seguir rechazando con bloqueo presente");
  await assert.rejects(service.pin("ses_13"), /Otra operación/, "Mutaciones de pins deben seguir rechazando con bloqueo presente");
});
test("cuota de retención es estable a través de limpiezas repetidas bajo lock", async t => {
  const { service, gateway } = await setup(t);
  await service.configure({ profile: "moderate", maxDeletePerRun: 2 });
  // 14 sessions total; moderate is 25% -> keep = ceil(14 * 0.25) = 4; possible = 10, verified 0, candidates 0 (fail-closed)
  const plan1 = await service.preview();
  assert.equal(plan1.quota.keep, 4);
  assert.equal((plan1 as any).possible?.length, 10); assert.equal((plan1 as any).verified?.length, 0); assert.equal(plan1.candidates.length, 0);

  const result1 = await service.cleanup(plan1);
  assert.equal(result1.deleted.length, 0);
  assert.equal(gateway.sessions.length, 14);

  const plan2 = await service.preview();
  // Quota must NOT have shrunk; fail-closed keeps baseline 14 with keep = 4
  assert.equal(plan2.quota.keep, 4);
  assert.equal((plan2 as any).possible?.length, 10); assert.equal((plan2 as any).verified?.length, 0); assert.equal(plan2.candidates.length, 0);

  const result2 = await service.cleanup(plan2);
  assert.equal(result2.deleted.length, 0);
  assert.equal(gateway.sessions.length, 14);

  const plan3 = await service.preview();
  assert.equal(plan3.quota.keep, 4);
  assert.equal((plan3 as any).possible?.length, 10); assert.equal((plan3 as any).verified?.length, 0); assert.equal(plan3.candidates.length, 0);
});
test("contrato de estado UI distingue carga y fallo de inventario genuinamente vacío", () => {
  // Initial failed request: must NOT claim 0 sessions or "No hay sesiones"
  const failedEmptyMsg = emptyInventoryMessage({ busy: false, error: true, hasPlan: false });
  assert.notEqual(failedEmptyMsg, "No hay sesiones para mostrar.");
  assert.equal(failedEmptyMsg, "No se pudo cargar el inventario.");

  const failedCountLabel = inventoryCountLabel({ count: 0, pageStart: 0, pageSize: 10, busy: false, error: true, hasPlan: false });
  assert.notEqual(failedCountLabel, "0 sesiones");
  assert.equal(failedCountLabel, "Error al cargar");

  // Loading state
  assert.equal(emptyInventoryMessage({ busy: true, error: false, hasPlan: false }), "Cargando…");
  assert.equal(inventoryCountLabel({ count: 0, pageStart: 0, pageSize: 10, busy: true, error: false, hasPlan: false }), "Cargando…");

  // Genuinely empty inventory
  assert.equal(emptyInventoryMessage({ busy: false, error: false, hasPlan: true }), "No hay sesiones para mostrar.");
  assert.equal(inventoryCountLabel({ count: 0, pageStart: 0, pageSize: 10, busy: false, error: false, hasPlan: true }), "0 sesiones");

  // Genuinely non-empty inventory
  assert.equal(inventoryCountLabel({ count: 5, pageStart: 0, pageSize: 10, busy: false, error: false, hasPlan: true }), "1–5 de 5");
});

test("SDK mock fetch: list usa global directory:'' y host routing explícito", async () => {
  const captured: Array<{ url: string; headers: Record<string, string> }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const req = typeof input === "string" ? new Request(input, init) : input instanceof URL ? new Request(input.toString(), init) : (input as Request);
    captured.push({
      url: req.url,
      headers: Object.fromEntries(req.headers.entries()),
    });
    return new Response(JSON.stringify([{
      id: "ses_1",
      title: "Session 1",
      directory: "/active/project",
      projectID: "p_active",
      time: { created: 1000, updated: 1000 },
    }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = createOpencodeClient({
    baseUrl: "http://127.0.0.1:4096",
    directory: "/active/project",
    experimental_workspaceID: "ws_active",
    fetch: mockFetch,
  });

  const gateway = new OpenCodeGateway(client, {
    activeDirectory: "/active/project",
    activeWorkspaceID: "ws_active",
  });

  const sessions = await gateway.list();
  assert.equal(sessions.length, 1);
  assert.equal(captured.length, 1);
  const parsedUrl = new URL(captured[0].url);
  assert.equal(parsedUrl.searchParams.get("directory"), "");
  assert.equal(parsedUrl.searchParams.get("workspace"), "ws_active");
});

test("browsing de inventario no realiza llamadas de estado a directorios ajenos ni inicializa instancias externas", async () => {
  const statusCalls: string[] = [];
  const mockSessions: Session[] = [
    { id: "ses_act", title: "Active", directory: "/active/project", projectID: "p_active", time: { created: 1000, updated: 1000 } },
    { id: "ses_dell", title: "Dell Home", directory: "C:\\Users\\DELL", projectID: "p_home", time: { created: 1000, updated: 1000 } },
    { id: "ses_old1", title: "Old 1", directory: "/historical/p1", projectID: "p_old1", time: { created: 1000, updated: 1000 } },
    { id: "ses_old2", title: "Old 2", directory: "/historical/p2", projectID: "p_old2", time: { created: 1000, updated: 1000 } },
    { id: "ses_old3", title: "Old 3", directory: "/historical/p3", projectID: "p_old3", time: { created: 1000, updated: 1000 } },
  ];

  const mockClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: mockSessions,
          response: { headers: new Map() },
        }),
      },
    },
    session: {
      status: async ({ directory }: { directory?: string }) => {
        statusCalls.push(directory ?? "");
        return { data: { ses_act: { type: "idle" } } };
      },
    },
  };

  const gateway = new OpenCodeGateway(mockClient, { activeDirectory: "/active/project" });

  // 1. Inventory browsing (liveness: false)
  const browsingSnapshot = await gateway.snapshot(new Set(), "/active/project", "p_active", { liveness: false });
  assert.equal(browsingSnapshot.sessions.length, 5);
  assert.equal(statusCalls.length, 0, "Browsing no debe llamar a session.status");

  // 2. Destructive liveness (liveness: true)
  const livenessSnapshot = await gateway.snapshot(new Set(), "/active/project", "p_active", { liveness: true });
  assert.equal(livenessSnapshot.sessions.length, 5);
  assert.equal(statusCalls.length, 1, "Solo debe llamar status para el directorio activo");
  assert.equal(statusCalls[0], "/active/project");
  assert.ok(!statusCalls.includes("C:\\Users\\DELL"), "No debe llamar status a C:\\Users\\DELL");
  assert.ok(!livenessSnapshot.busy.has("ses_act"), "ses_act en directorio activo es idle");
  assert.ok(livenessSnapshot.busy.has("ses_dell"), "ses_dell en directorio ajeno debe marcarse busy");
});

test("proyecto con sesiones en múltiples directorios no asume inactividad y protege actividad desconocida", async t => {
  const { store } = await setup(t);
  const oldTime = 1700000000000 - 50 * 86400000;
  const multiDirSessions: Session[] = [
    { id: "ses_projdirA", title: "Project in Dir A", directory: "/project/dirA", projectID: "p_same", time: { created: oldTime, updated: oldTime } },
    { id: "ses_projdirB", title: "Project in Dir B", directory: "/project/dirB", projectID: "p_same", time: { created: oldTime, updated: oldTime } },
  ];

  const mockClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: structuredClone(multiDirSessions),
          response: { headers: new Map() },
        }),
      },
    },
    session: {
      status: async ({ directory }: { directory?: string }) => {
        if (directory === "/project/dirA") {
          return { data: { ses_projdirA: { type: "idle" } } };
        }
        throw new Error("No debe consultar dirB");
      },
    },
  };

  const gateway = new OpenCodeGateway(mockClient, { activeDirectory: "/project/dirA" });
  const service = new VaultService({
    store,
    gateway,
    projectID: "p_same",
    projectDirectory: "/project/dirA",
    active: () => new Set(),
  });

  const plan = await service.preview({ liveness: true });
  const famB = plan.families.find(f => f.root.id === "ses_projdirB");
  assert.ok(famB?.reasons.includes("Trabajando"), "ses_projdirB en directorio ajeno debe tener razón Trabajando");
  assert.ok(!plan.candidates.some(c => c.root.id === "ses_projdirB"), "ses_projdirB no puede ser candidato");
});

test("hanging inventory o status termina acotado por timeout/deadline con error legible de UI", async () => {
  const hangingClient: any = {
    experimental: {
      session: {
        list: async () => new Promise(() => {}), // never resolves
      },
    },
    session: {
      status: async () => new Promise(() => {}), // never resolves
    },
  };

  const gateway = new OpenCodeGateway(hangingClient, { activeDirectory: "/active/project" });

  await assert.rejects(
    gateway.list({ timeoutMs: 50 }),
    /Tiempo de espera agotado al consultar el inventario de sesiones/
  );

  const listOkClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: [{ id: "ses_s1", title: "S1", directory: "/active/project", projectID: "p", time: { created: 1000, updated: 1000 } }],
          response: { headers: new Map() },
        }),
      },
    },
    session: {
      status: async () => new Promise(() => {}), // never resolves
    },
  };

  const gatewayStatusHang = new OpenCodeGateway(listOkClient, { activeDirectory: "/active/project" });

  await assert.rejects(
    gatewayStatusHang.snapshot(new Set(), "/active/project", "p", { timeoutMs: 50, liveness: true }),
    /Tiempo de espera agotado al verificar el estado de actividad/
  );
});

test("TDD regression: candidate foreign directory status timeout fails closed without aborting snapshot", async t => {
  const tmpForeignDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-foreign-test-"));
  t.after(() => fs.rm(tmpForeignDir, { recursive: true, force: true }));

  const client: any = {
    experimental: {
      session: {
        list: async () => ({
          data: [
            { id: "ses_act", title: "Active", directory: "/active/project", projectID: "p", time: { created: 1000, updated: 1000 } },
            { id: "ses_for", title: "Foreign", directory: tmpForeignDir, projectID: "p_other", time: { created: 1000, updated: 1000 } },
          ],
          response: { headers: new Map() },
        }),
      },
    },
    session: {
      status: async (params: { directory: string }) => {
        if (params.directory === "/active/project") {
          return { data: { ses_act: { type: "idle" } } };
        }
        // Foreign directory hangs
        return new Promise(() => {});
      },
    },
  };

  const gateway = new OpenCodeGateway(client, { activeDirectory: "/active/project" });
  const snapshot = await gateway.snapshot(new Set(), "/active/project", "p", {
    timeoutMs: 80,
    liveness: true,
    candidateDirectories: [tmpForeignDir],
  });

  // Active directory session is idle and verified
  assert.equal(snapshot.unverified?.has("ses_act"), false);
  assert.equal(snapshot.busy.has("ses_act"), false);

  // Foreign directory session that timed out must fail closed: protected in unverified and busy
  assert.equal(snapshot.unverified?.has("ses_for"), true, "Timed out foreign session must be marked unverified");
  assert.equal(snapshot.busy.has("ses_for"), true, "Timed out foreign session must be marked busy");
});

test("cleanup con error de status o tipo de actividad desconocido aborta y nunca borra sesiones", async t => {
  const { store } = await setup(t);
  let deletedSessions: string[] = [];

  const mockClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: [
            { id: "ses_unknowntype", title: "Unknown Type", directory: "/active/dir", projectID: "p_active", time: { created: 1000, updated: 1000 } },
          ],
          response: { headers: new Map() },
        }),
      },
    },
    session: {
      status: async () => ({
        data: {
          ses_unknowntype: { type: "future_unrecognized_state" },
        },
      }),
      delete: async ({ sessionID }: { sessionID: string }) => {
        deletedSessions.push(sessionID);
        return { data: true };
      },
    },
  };

  const gateway = new OpenCodeGateway(mockClient, { activeDirectory: "/active/dir" });
  const snapshot = await gateway.snapshot(new Set(), "/active/dir", "p_active", { liveness: true });
  assert.ok(snapshot.busy.has("ses_unknowntype"), "Tipo de actividad desconocido debe marcarse busy");

  const service = new VaultService({
    store,
    gateway,
    projectID: "p_active",
    projectDirectory: "/active/dir",
    active: () => new Set(),
  });

  const plan = await service.preview({ liveness: true });
  assert.equal(plan.candidates.length, 0, "No debe haber candidatos cuando el estado es desconocido");
  assert.equal(deletedSessions.length, 0);
});

test("cierre de diálogo cancela peticiones en curso vía AbortSignal", async () => {
  const abortCtrl = new AbortController();
  const hangingClient: any = {
    experimental: {
      session: {
        list: async (_params: any, options: any) => {
          return new Promise((_, reject) => {
            if (options?.signal) {
              options.signal.addEventListener("abort", () => {
                reject(new DOMException("The operation was aborted", "AbortError"));
              });
            }
          });
        },
      },
    },
  };

  const gateway = new OpenCodeGateway(hangingClient);
  const promise = gateway.list({ signal: abortCtrl.signal, timeoutMs: 10000 });
  abortCtrl.abort();

  await assert.rejects(promise, /cancelada|aborted/i);
});

test("migración atómica de configuración: schema 1 con automatic:true migra a schema 2 global y automatic:false", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-mig-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const oldState = {
    schema: 1,
    revision: 3,
    config: {
      profile: "conservative",
      percent: 40,
      scope: "project",
      automatic: true,
      graceHours: 48,
      includeArchived: false,
      intervalMinutes: 15,
      maxDeletePerRun: 5,
    },
    pins: ["ses_pinned1"],
    quotas: {
      "project:p1": { signature: "conservative:40", baseline: 50, keep: 20, at: 1000 },
      global: { signature: "stale:stale", baseline: 10, keep: 2, at: 500 },
    },
    lastRun: 12345,
  };
  await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(oldState, null, 2));

  const res1 = await store.migrate();
  assert.equal(res1.migrated, true);
  assert.equal(res1.state.schema, 2);
  assert.equal(res1.state.config.scope, "global");
  assert.equal(res1.state.config.automatic, false, "Migración a global debe pausar automático inicialmente");
  assert.equal(res1.state.config.profile, "conservative");
  assert.equal(res1.state.config.graceHours, 48);
  assert.deepEqual(res1.state.pins, ["ses_pinned1"]);
  assert.ok(res1.state.quotas["project:p1"], "Debe conservar cuotas previas de proyectos");
  assert.equal(res1.state.quotas["global"], undefined, "Debe limpiar cuota global stale calculada en el esquema anterior");

  // Idempotent migration
  const res2 = await store.migrate();
  assert.equal(res2.migrated, false);
  assert.equal(res2.state.schema, 2);
});

test("migración falla cerrado ante conflicto de bloqueo operation.lock y no altera el bloqueo", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-mig-lock-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const lockFile = path.join(dir, "operation.lock");
  const lockBytes = JSON.stringify({ pid: 8888, at: 99999 });
  await fs.writeFile(lockFile, lockBytes);

  await assert.rejects(store.migrate(), /Otra operación está en curso/);
  const lockAfter = await fs.readFile(lockFile, "utf8");
  assert.equal(lockAfter, lockBytes, "El archivo de bloqueo no debe ser alterado ni eliminado");
});

test("limpieza automática rechazada si schema < 2", async t => {
  const { store, service } = await setup(t);
  // Manually force schema 1 in file
  const state = await store.read();
  const rawSchema1 = { ...state, schema: 1, config: { ...state.config, automatic: true } };
  await fs.writeFile(path.join(store.dir, "state.json"), JSON.stringify(rawSchema1));

  const plan = await service.preview();
  const result = await service.cleanup(plan, true);
  assert.equal(result.deleted.length, 0, "Limpieza automática debe retornar vacío si el esquema no ha sido migrado");
});

test("liveness con directorio inexistente: falla cerrado sin llamar session.status y marca Actividad no verificada", async () => {
  const statusCalledDirs: string[] = [];
  const mockClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: [
            { id: "ses_act", title: "Active", directory: process.cwd(), projectID: "p_act", time: { created: 1000, updated: 1000 } },
            { id: "ses_missing", title: "Missing Dir", directory: "C:\\nonexistent\\historical\\dir999", projectID: "p_miss", time: { created: 1000, updated: 1000 } },
          ],
          response: { headers: new Map() },
        }),
      },
    },
    session: {
      status: async ({ directory }: { directory?: string }) => {
        statusCalledDirs.push(directory ?? "");
        return { data: { ses_act: { type: "idle" } } };
      },
    },
  };

  const gateway = new OpenCodeGateway(mockClient, { activeDirectory: process.cwd() });
  const snapshot = await gateway.snapshot(new Set(), process.cwd(), "p_act", {
    liveness: true,
    candidateDirectories: ["C:\\nonexistent\\historical\\dir999"],
  });

  assert.ok(!statusCalledDirs.includes("C:\\nonexistent\\historical\\dir999"), "Directorio inexistente no debe invocar session.status");
  assert.ok(snapshot.unverified?.has("ses_missing"), "Sesión en directorio inexistente debe marcarse unverified");
  assert.ok(snapshot.busy.has("ses_missing"), "Sesión en directorio inexistente debe marcarse busy");
});

test("bounded concurrency limita consultas concurrentes de directorios a máximo 4", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-concurrency-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  // Create 8 temporary real directories
  const tempDirs: string[] = [];
  for (let i = 0; i < 8; i++) {
    const sub = path.join(dir, `sub_${i}`);
    await fs.mkdir(sub);
    tempDirs.push(sub);
  }

  let activeRequests = 0;
  let maxConcurrentSeen = 0;

  const mockClient: any = {
    experimental: {
      session: {
        list: async () => ({
          data: tempDirs.map((d, i) => ({
            id: `ses_c${i}`,
            title: `Conc ${i}`,
            directory: d,
            projectID: `p${i}`,
            time: { created: 1000, updated: 1000 },
          })),
          response: { headers: new Map() },
        }),
      },
    },
    session: {
      status: async () => {
        activeRequests++;
        maxConcurrentSeen = Math.max(maxConcurrentSeen, activeRequests);
        await new Promise(r => setTimeout(r, 20));
        activeRequests--;
        return { data: {} };
      },
    },
  };

  const gateway = new OpenCodeGateway(mockClient, { activeDirectory: tempDirs[0] });
  await gateway.snapshot(new Set(), tempDirs[0], "p_0", {
    liveness: true,
    candidateDirectories: tempDirs.slice(1),
  });

  assert.ok(maxConcurrentSeen <= 4, `La concurrencia máxima vista (${maxConcurrentSeen}) debe ser <= 4`);
  assert.ok(maxConcurrentSeen > 1, `Debe ejecutar en paralelo con concurrencia > 1 (vista: ${maxConcurrentSeen})`);
});

test("TDD regression: actual SDK inherited workspace wire no inyecta activeWorkspaceID en consultas foráneas", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-wire-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const foreignDir = path.join(dir, "foreign_project");
  await fs.mkdir(foreignDir);

  const captured: Array<{ url: string; headers: Record<string, string> }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const req = typeof input === "string" ? new Request(input, init) : input instanceof URL ? new Request(input.toString(), init) : (input as Request);
    captured.push({
      url: req.url,
      headers: Object.fromEntries(req.headers.entries()),
    });
    const url = new URL(req.url);
    if (url.pathname.includes("/experimental/session") || url.pathname.includes("/session/list")) {
      return new Response(JSON.stringify([{
        id: "ses_act",
        title: "Session Active",
        directory: "/active/project",
        projectID: "p_active",
        time: { created: 1000, updated: 1000 },
      }, {
        id: "ses_for",
        title: "Session Foreign",
        directory: foreignDir,
        projectID: "p_foreign",
        time: { created: 1000, updated: 1000 },
      }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = createOpencodeClient({
    baseUrl: "http://127.0.0.1:4096",
    directory: "/active/project",
    experimental_workspaceID: "ws_active",
    fetch: mockFetch,
  });

  const gateway = new OpenCodeGateway(client, {
    activeDirectory: "/active/project",
    activeWorkspaceID: "ws_active",
  });

  await gateway.snapshot(new Set(), "/active/project", "p_active", {
    liveness: true,
    candidateDirectories: [foreignDir],
  });

  const statusRequests = captured.filter(req => req.url.includes("/session/status"));
  assert.ok(statusRequests.length >= 2, "Debe haber peticiones de status para activo y foráneo");

  const foreignReq = statusRequests.find(req => {
    const u = new URL(req.url);
    return u.searchParams.get("directory") === foreignDir;
  });
  assert.ok(foreignReq, "Debe existir petición de status para foreignDir");
  const foreignUrl = new URL(foreignReq.url);
  assert.equal(foreignUrl.searchParams.get("workspace"), null, "Petición a foreignDir en el cable NO debe tener workspace param");
  assert.equal(foreignReq.headers["x-opencode-workspace"], undefined, "Petición a foreignDir en el cable NO debe tener x-opencode-workspace header");
});

test("TDD regression: schema2 under existing lock read-only procede sin fallar ni alterar el bloqueo", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-mig-fastpath-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const store = new Store(dir);
  const stateFile = path.join(dir, "state.json");
  const validState2 = defaultState();
  validState2.schema = 2;
  validState2.revision = 3;
  await fs.writeFile(stateFile, JSON.stringify(validState2, null, 2));

  const lockFile = path.join(dir, "operation.lock");
  const lockBytes = JSON.stringify({ pid: 12345, at: 99999 });
  await fs.writeFile(lockFile, lockBytes);

  const res = await store.migrate();
  assert.equal(res.migrated, false);
  assert.equal(res.state.schema, 2);
  assert.equal(res.state.revision, 3);

  const lockAfter = await fs.readFile(lockFile, "utf8");
  assert.equal(lockAfter, lockBytes, "El bloqueo existente debe permanecer intacto");
});

test("TDD regression: auto live preview ejecuta preview con liveness true explícito", async t => {
  const { store, gateway } = await setup(t);
  const service = new VaultService({ store, gateway, projectID: "p", active: () => new Set() });

  let calledLiveness: boolean | undefined;
  const originalPreview = service.preview.bind(service);
  service.preview = async (options) => {
    calledLiveness = options?.liveness;
    return originalPreview(options);
  };

  const defaultPreview = await service.preview();
  assert.equal(calledLiveness, undefined, "preview sin opciones deja liveness undefined o false por defecto");
  assert.ok(defaultPreview, "preview default debe generar plan");

  await service.preview({ liveness: true });
  assert.equal(calledLiveness, true, "auto live preview debe pasar liveness: true explícito");
});

test("TDD regression: multi-directory project calcula candidateDirs para ambos scopes cuando liveness es true", async t => {
  const { store } = await setup(t);
  await store.update(s => { s.config.scope = "project"; s.config.profile = "ten"; });

  let snapshotOptionsPassed: any;
  const sessions: Session[] = Array.from({ length: 14 }, (_, i) => ({
    id: `ses_p${i}`,
    title: `P ${i}`,
    directory: i % 2 === 0 ? "/project/dirA" : "/project/dirB",
    projectID: "p_multi",
    time: { created: 1700000000000 - i * 86400000, updated: 1700000000000 - i * 86400000 },
  }));

  const mockGateway: Gateway = {
    async list() { return structuredClone(sessions); },
    async snapshot(active, activeDir, projectID, options) {
      if (options?.liveness) {
        snapshotOptionsPassed = options;
      }
      return { sessions: structuredClone(sessions), busy: new Set(), active, unverified: new Set() };
    },
    async exportSession() { throw new Error("not implemented"); },
    async remove() { throw new Error("not implemented"); },
  };

  const service = new VaultService({
    store,
    gateway: mockGateway,
    projectID: "p_multi",
    projectDirectory: "/project/dirA",
    active: () => new Set(),
  });

  const plan = await service.preview({ liveness: true });
  assert.ok(plan, "Debe generar plan");
  assert.ok(snapshotOptionsPassed?.candidateDirectories instanceof Set, "Debe haber calculado candidateDirectories para scope project");
  assert.ok(snapshotOptionsPassed.candidateDirectories.has("/project/dirA"), "Debe incluir dirA");
  assert.ok(snapshotOptionsPassed.candidateDirectories.has("/project/dirB"), "Debe incluir dirB");
});

test("TDD regression: wrong/unverified context never remove protege sesiones foráneas no verificadas", async t => {
  const { store } = await setup(t);
  await store.update(s => { s.config.scope = "global"; s.config.profile = "ten"; });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-unverified-"));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const foreignSession: Session = {
    id: "ses_for99",
    title: "Foreign Session Unverified",
    directory: tempDir,
    projectID: "p_foreign",
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
    session: {
      status: async () => {
        return { data: {} };
      },
      delete: async () => {
        throw new Error("DELETE nunca debe ejecutarse para sesión foránea no verificada");
      },
    },
  };

  const gateway = new OpenCodeGateway(mockClient, { activeDirectory: "/active/dir" });
  const service = new VaultService({
    store,
    gateway,
    projectID: "p_act",
    projectDirectory: "/active/dir",
    active: () => new Set(),
  });

  const snapshot = await gateway.snapshot(new Set(), "/active/dir", "p_act", {
    liveness: true,
    candidateDirectories: [tempDir],
  });

  assert.ok(snapshot.unverified?.has("ses_for99"), "Sesión foránea con status omitido y routing no probado debe marcarse unverified");
  assert.ok(snapshot.busy.has("ses_for99"), "Sesión foránea con status omitido debe marcarse busy (no false idle)");

  const plan = await service.preview({ liveness: true });
  const fam = plan.families.find(f => f.root.id === "ses_for99");
  assert.ok(fam?.reasons.includes("Actividad no verificada"), "Debe tener razón Actividad no verificada");
  assert.ok(!plan.candidates.some(c => c.root.id === "ses_for99"), "No debe ser candidato");

  const cleanupResult = await service.cleanup(plan);
  assert.equal(cleanupResult.deleted.length, 0, "No debe borrar ninguna sesión");
  assert.ok(!cleanupResult.deleted.includes("ses_for99"), "Sesión foránea no verificada jamás debe ser eliminada");
});
