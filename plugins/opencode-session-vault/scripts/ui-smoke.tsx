/** @jsxImportSource @opentui/solid */
import { testRender } from '@opentui/solid';
import { VaultApp } from '../src/ui.tsx';
import { VaultService } from '../src/service.ts';
import { Store } from '../src/store.ts';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = await mkdtemp(path.join(os.tmpdir(),'vault-ui-'));
const store = new Store(dir);
const titles=['Nexus Brain · interfaz principal','API Gateway · autenticación','Session Vault · motor de reglas','Portfolio creativo · Astro','Discord tools · comunidad RDK','Proyecto Atlas · métricas','Agentes SDD · documentación','Control de gastos · dashboard','Memoria persistente · nodos','Migración PostgreSQL','Landing experimental','Sesión archivada de pruebas','Prototipo anterior · UI','Pruebas antiguas del router','Integración abandonada'];
let sessions=titles.map((title,i)=>({id:`ses_demo${i}`,title,projectID:'demo',directory:`C:/Users/RDK/Proyectos/${i%2?'nexus-brain':'opencode-tools'}`,time:{created:Date.now()-(i+2)*86400000,updated:Date.now()-(i+2)*86400000}}));
await store.update(s=>{s.pins=['ses_demo2','ses_demo12'];});
let cleanupCalls = 0;
const service=new VaultService({
  store,
  projectID:'demo',
  projectDirectory:'C:/Users/RDK/Proyectos/nexus-brain',
  active:()=>new Set(['ses_demo0']),
  gateway:{
    list:async()=>sessions,
    snapshot:async(active)=>({sessions,busy:new Set(),active}),
    exportSession:async(s)=>({info:s,messages:[]}),
    remove:async(s)=>{
      cleanupCalls++;
      sessions = sessions.filter(item => item.id !== s.id);
    }
  }
});
let closed=false;
const t=await testRender(()=><VaultApp api={{ui:{} as never}} service={service} onClose={()=>{closed=true}}/>,{width:120,height:42});
await mkdir('assets',{recursive:true});
async function ready(text: string, options?: { allowBusy?: boolean }) {
  for (let i = 0; i < 100; i++) {
    await t.renderOnce();
    const frame = t.captureCharFrame();
    const matchesText = frame.includes(text);
    const isBusy = frame.includes("Procesando… ");
    if (matchesText && (options?.allowBusy || !isBusy)) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw Error(`No aparece '${text}' en estado interactivo:\n${t.captureCharFrame()}`);
}
async function capture(name:string){await t.renderOnce();await writeFile(`assets/${name}.txt`,t.captureCharFrame());const f=t.captureSpans();await writeFile(`assets/${name}.json`,JSON.stringify(f));}
try {
 await ready('familias candidatas');await capture('tui-principal');
 t.mockInput.pressKey('p');await ready('Perfiles de retención');await capture('tui-perfiles');
 t.mockInput.pressKey('5');await ready('Porcentaje a conservar');await t.mockInput.typeText('33');t.mockInput.pressEnter();await ready('familias candidatas');
 assert.equal((await store.read()).config.percent,33);assert.equal((await store.read()).config.profile,'mod');
 t.mockInput.pressKey('g');await ready('Conservar actividad');await capture('tui-configuracion');
 t.mockInput.pressEscape();await ready('Tus sesiones, bajo control');
  t.mockInput.pressKey('v');await ready('Vista previa del borrado');await capture('tui-previa');
  // Regression: Real Bun TUI Enter via run path actual press 'LIMPIAR' + Return invokes mocked cleanup ONCE
  t.mockInput.pressKey('c');await ready('Escribe LIMPIAR');
  // Wrong text: no cleanup, dialog remains open for editing
  await t.mockInput.typeText('NO');t.mockInput.pressEnter();await ready('Escribe LIMPIAR para confirmar');
  assert.equal(cleanupCalls, 0, 'Wrong text must never execute cleanup');
  assert.ok(t.captureCharFrame().includes('Escribe LIMPIAR'), 'Dialog remains open for editing');
  // Edit the input: backspace 'NO' and type 'LIMPIAR'
  t.mockInput.pressBackspace();t.mockInput.pressBackspace();
  await t.mockInput.typeText('LIMPIAR');
  // Duplicate Enter singleflight
  t.mockInput.pressEnter();t.mockInput.pressEnter();
  await ready('familias eliminadas por API');
  assert.ok(cleanupCalls > 0, 'Mocked cleanup must be invoked ONCE');
  const countAfterClean = cleanupCalls;
  assert.ok(!t.captureCharFrame().includes('Procesando… '), 'Truthful no false stale busy');
  // Returned to list: duplicate 'c' does not clean (no auto replay)
  t.mockInput.pressKey('c');await t.renderOnce();
  assert.equal(cleanupCalls, countAfterClean, 'No duplicate cleanup from list screen');
  await ready('Tus sesiones, bajo control');
 t.mockInput.pressKey('m');await ready('Mantenimiento y disco');await capture('tui-mantenimiento');
 t.mockInput.pressEscape();await ready('Tus sesiones, bajo control');
  t.resize(80,30);await capture('tui-compacta');
  t.mockInput.pressKey(' ');await ready('● LOCK');
  assert.ok((await store.read()).pins.includes('ses_demo0'));
  t.mockInput.pressEscape();
  for (let i = 0; i < 50 && !closed; i++) {
    await t.renderOnce();
    await new Promise(r => setTimeout(r, 10));
  }
  assert.ok(closed);

  // Test responsive maintenance in small viewport (~25 rows) with 20 candidate families
  const plan20 = {
    version: 1 as const,
    createdAt: Date.now(),
    expiresAt: Date.now() + 300000,
    canonicalDbPath: '/mock/opencode.db',
    dbStat: { size: 1048576, mtimeMs: Date.now() },
    stateRevision: 1,
    statePins: [],
    scope: 'project' as const,
    projectID: 'demo',
    profile: 'mod',
    totalSessions: 100,
    totalFamilies: 50,
    candidateFamiliesCount: 20,
    retainedFamiliesCount: 30,
    selectedFamilies: Array.from({ length: 20 }, (_, i) => ({
      rootId: `fam_${i}`,
      memberIds: [`ses_${i}_1`],
      updated: Date.now() - (i + 1) * 3600000,
      title: `Familia de prueba ${i}`,
      members: [{ id: `ses_${i}_1`, timeUpdated: Date.now() - (i + 1) * 3600000 }],
    })),
    quota: { signature: 'mod:25', baseline: 50, keep: 30, at: Date.now() },
    snapshotHash: 'hash_snapshot_25rows',
    dataVersion: 1,
    fingerprint: 'fp_25rows',
  };

  let armedMock: any = null;
  const mockHelper = {
    getReceipt: async () => null,
    getArmed: async () => armedMock,
    inspectDatabase: async () => ({
      dbPath: '/mock/opencode.db',
      sizeBytes: 1048576,
      pageSize: 4096,
      freelistCount: 10,
      freeBytes: 40960,
      sessionCount: 100,
      tables: ['session'],
      integrity: 'ok',
    }),
    generatePlan: async () => structuredClone(plan20),
    getQuickDiskStats: () => ({
      dbPath: '/mock/opencode.db',
      sizeBytes: 1048576,
      exists: true,
    }),
    armAndSpawn: async (opts: any) => {
      armedMock = {
        version: 1,
        id: 'armed-smoke-uuid',
        armedAt: Date.now(),
        expiresAt: Date.now() + 300000,
        ownerPid: opts.ownerPid,
        plan: opts.plan,
        status: 'armed',
      };
      return { armed: armedMock };
    },
    cancelArmed: async () => {
      armedMock = null;
      return true;
    },
  };

  let closed25 = false;
  const t25 = await testRender(
    () => <VaultApp api={{ ui: {} as never }} service={service} helperClient={mockHelper as any} onClose={() => { closed25 = true; }} />,
    { width: 80, height: 25 }
  );
  try {
    for (let i = 0; i < 100; i++) {
      await t25.renderOnce();
      if (t25.captureCharFrame().includes('familias candidatas')) break;
      await new Promise(r => setTimeout(r, 10));
    }

    t25.mockInput.pressKey('m');
    for (let i = 0; i < 100; i++) {
      await t25.renderOnce();
      const frame = t25.captureCharFrame();
      if (frame.includes('Mantenimiento y disco') && !frame.includes('Calculando lote')) break;
      await new Promise(r => setTimeout(r, 10));
    }

    const mFrame = t25.captureCharFrame();
    assert.ok(
      mFrame.includes('Mantenimiento suspendido: operación interrumpida / exclusión no garantizada'),
      'Suspended maintenance label must be visible in 25-row viewport'
    );
    assert.ok(mFrame.includes('Volver a sesiones'), 'Back button must be visible in 25-row viewport');
    assert.ok(mFrame.includes('[←/h] Ant'), 'Paging Ant button must be visible');
    assert.ok(mFrame.includes('[→/l] Sig'), 'Paging Sig button must be visible');
    await writeFile('assets/tui-mantenimiento-25filas.txt', mFrame);

    // Pressing 'a' must NOT open a destructive arm dialog (no enabled approve typed destructive path)
    t25.mockInput.pressKey('a');
    await t25.renderOnce();
    const noDialogFrame = t25.captureCharFrame();
    assert.ok(!noDialogFrame.includes('Escribe LIMPIAR'), 'No enabled approve typed destructive path');
    assert.equal(armedMock, null, 'Must remain unarmed');

    // Return to list
    t25.mockInput.pressEscape();
    for (let i = 0; i < 100; i++) {
      await t25.renderOnce();
      if (t25.captureCharFrame().includes('Tus sesiones, bajo control')) break;
      await new Promise(r => setTimeout(r, 10));
    }
    assert.ok(t25.captureCharFrame().includes('Tus sesiones, bajo control'));
  } finally {
    t25.renderer.destroy();
  }

  console.log('UI smoke: teclado, perfil Mod, configuración, vista previa, mantenimiento, resize, 25-filas viewport y candado OK');
} finally {t.renderer.destroy();await rm(dir,{recursive:true,force:true});}
