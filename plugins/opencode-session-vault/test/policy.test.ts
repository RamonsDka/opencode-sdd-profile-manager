import test from "node:test";
import assert from "node:assert/strict";
import { defaultState, type Session, type Snapshot } from "../src/model.ts";
import { makePlan, familiesOf, resolveQuota, validateState } from "../src/policy.ts";

const now = 1800000000000;
export const session = (n: number, extra: Partial<Session> = {}): Session => ({ id: `ses_${n}`, title: `Sesión ${n}`, projectID: "projectA", directory: "/demo",
  time: { created: now - n * 86400000, updated: now - n * 86400000 }, ...extra });
const snap = (sessions: Session[]): Snapshot => ({ sessions, active: new Set(), busy: new Set() });
test("conserva por actualización, no por creación", () => {
  const s = defaultState(); const values = Array.from({ length: 15 }, (_, i) => session(i + 1));
  values[14].time.updated = now - 1000;
  const p = makePlan(snap(values), s, "projectA", now);
  assert.equal(p.families[0].root.id, "ses_15"); assert.equal((p as any).possible?.length, 5);
  assert.equal((p as any).verified?.length, 0); assert.equal(p.candidates.length, 0);
  assert.ok(!((p as any).possible as any[])?.some((f: any) => f.root.id === "ses_15"));
  assert.ok(p.families.every(f => f.reasons.includes("Actividad no verificada")));
});
for (const [profile, keep] of [["basic", 15], ["moderate", 25], ["conservative", 40]] as const) {
  test(`perfil ${profile}: ${keep} de 100; no erosiona tras limpiezas`, () => {
    const state = defaultState(); state.config.profile = profile;
    let data = Array.from({ length: 100 }, (_, i) => session(i + 2));
    const p = makePlan(snap(data), state, "projectA", now); state.quotas[p.scopeKey] = p.quota;
    assert.equal(p.quota.keep, keep);
    data = p.retained.flatMap(f => f.members);
    for (let i = 0; i < 5; i++) assert.equal(makePlan(snap(data), state, "projectA", now).candidates.length, 0);
  });
}
test("candados se conservan además de las 10, aunque sean antiguos", () => {
  const s = defaultState(); s.pins = ["ses_20"];
  const p = makePlan(snap(Array.from({ length: 20 }, (_, i) => session(i + 1))), s, "projectA", now);
  assert.equal(p.locked, 1); assert.equal((p as any).possible?.length, 9); assert.equal((p as any).verified?.length, 0); assert.equal(p.candidates.length, 0); assert.equal(p.retained.length, 20);
});
test("hija con candado protege padre y hermanos", () => {
  const state = defaultState(); state.config.profile = "mod"; state.config.percent = 1; state.pins = ["ses_100"];
  const p = makePlan(snap([session(1), session(50), session(100, { parentID: "ses_50" }), session(101, { parentID: "ses_50" })]), state, "projectA", now);
  assert.equal(p.candidates.length, 0); assert.equal(p.families.length, 2);
});
test("última actividad de hija se propaga a la familia", () => {
  const families = familiesOf([session(1), session(50), session(100, { parentID: "ses_50", time: { created: now - 100, updated: now - 10 } })]);
  assert.equal(families[0].root.id, "ses_50");
});
test("ocupadas, abiertas y archivadas quedan protegidas", () => {
  const state = defaultState(); state.config.profile = "mod"; state.config.percent = 1;
  const snapshot = snap([session(2), session(3), session(4), session(5, { time: { created: 1, updated: now - 100 * 86400000, archived: now - 1000 } })]);
  snapshot.busy.add("ses_3"); snapshot.active.add("ses_4");
  assert.equal(makePlan(snapshot, state, "projectA", now).candidates.length, 0);
});
test("alcance por proyecto: inventario global visible y limpieza restringida al proyecto activo", () => {
  const s = defaultState(); s.config.scope = "project";
  const p = makePlan(snap([session(1), session(2, { projectID: "projectB" })]), s, "projectA", now);
  assert.equal(p.families.length, 2);
  assert.equal(p.scopeKey, "project:projectA");
  const b = p.families.find(f => f.root.id === "ses_2");
  assert.ok(b?.reasons.includes("Otro proyecto"));
  assert.ok(!p.candidates.some(f => f.root.projectID !== "projectA"));
});
test("alcance global: evalúa inventario multi-proyecto con cuota global aislada sin marcar Otro proyecto a familias limpias", () => {
  const s = defaultState(); s.config.scope = "global"; s.config.profile = "mod"; s.config.percent = 50;
  // 4 families: 2 in projectA, 2 in projectB (old sessions)
  const p = makePlan(snap([
    session(1, { projectID: "projectA" }),
    session(2, { projectID: "projectA" }),
    session(3, { projectID: "projectB" }),
    session(4, { projectID: "projectB" }),
  ]), s, "projectA", now);
  assert.equal(p.families.length, 4);
  assert.equal(p.scopeKey, "global");
  assert.ok(!p.families.some(f => f.reasons.includes("Otro proyecto")));
  // 50% of 4 = 2 kept, 2 candidates
  assert.equal(p.quota.keep, 2);
  assert.equal((p as any).possible?.length, 2); assert.equal((p as any).verified?.length, 0); assert.equal(p.candidates.length, 0);
});
test("actividad no verificada protege a la familia y la excluye de candidatas", () => {
  const s = defaultState();
  const snapshot = snap([session(1), session(2)]);
  snapshot.unverified = new Set(["ses_2"]);
  const p = makePlan(snapshot, s, "projectA", now);
  const f2 = p.families.find(f => f.root.id === "ses_2");
  assert.ok(f2?.reasons.includes("Actividad no verificada"));
  assert.ok(!p.candidates.some(f => f.root.id === "ses_2"));
});
test("identidad de proyecto ausente impide candidatos y detiene limpieza", () => {
  const s = defaultState();
  const p1 = makePlan(snap([session(1), session(2)]), s, "", now);
  assert.equal(p1.candidates.length, 0);
  assert.ok(p1.families.every(f => f.reasons.includes("Otro proyecto")));
  const p2 = makePlan(snap([session(1), session(2)]), s, "   ", now);
  assert.equal(p2.candidates.length, 0);
});
test("rechaza ciclos y padres ausentes", () => {
  assert.throws(() => familiesOf([session(1, { parentID: "ses_2" }), session(2, { parentID: "ses_1" })]), /circular/);
  assert.throws(() => familiesOf([session(1, { parentID: "ses_2" })]), /incompleto/);
});
test("rechaza fechas inválidas y IDs duplicados", () => {
  assert.throws(() => familiesOf([session(1), session(1)]));
  assert.throws(() => familiesOf([session(1, { time: { created: 1, updated: NaN } })]));
});
test("Mod valida 1–100, redondea hacia arriba y respeta mínimo de 1", () => {
  const s = defaultState(); s.config.profile = "mod"; s.config.percent = 15;
  assert.equal(resolveQuota(s.config, 11).keep, 2); assert.equal(resolveQuota(s.config, 0).keep, 1);
  for (const n of [0, 101, 1.5, NaN]) { s.config.percent = n; assert.throws(() => validateState(s)); }
});
test("100% conserva todas las familias y empates son deterministas", () => {
  const s = defaultState(); s.config.profile = "mod"; s.config.percent = 100;
  const values = [session(1), session(2, { time: session(1).time })];
  assert.equal(makePlan(snap(values), s, "projectA", now).candidates.length, 0);
  assert.deepEqual(familiesOf(values).map(f => f.root.id), familiesOf([...values].reverse()).map(f => f.root.id));
});
test("10.000 sesiones: cupo fijo correcto", () => {
  const p = makePlan(snap(Array.from({ length: 10000 }, (_, i) => session(i + 2))), defaultState(), "projectA", now);
  assert.equal((p as any).possible?.length, 9990); assert.equal((p as any).verified?.length, 0); assert.equal(p.candidates.length, 0);
});
test("familia mixta con hija en otro proyecto queda protegida y excluida de candidatos", () => {
  const s = defaultState();
  const root = session(10, { projectID: "projectA" });
  const child = session(11, { parentID: "ses_10", projectID: "projectB" });
  const p = makePlan(snap([root, child]), s, "projectA", now);
  assert.equal(p.families.length, 1);
  assert.equal(p.candidates.length, 0);
  assert.ok(p.families[0].reasons.includes("Otro proyecto"));
  assert.equal(p.retained.length, 1);
});
test("familia mixta con nieta en otro proyecto o projectID desconocido falla cerrado y protege toda la familia", () => {
  const s = defaultState();
  const root = session(20, { projectID: "projectA" });
  const child = session(21, { parentID: "ses_20", projectID: "projectA" });
  const grandchildOther = session(22, { parentID: "ses_21", projectID: "projectC" });
  const p1 = makePlan(snap([root, child, grandchildOther]), s, "projectA", now);
  assert.equal(p1.candidates.length, 0);
  assert.ok(p1.families[0].reasons.includes("Otro proyecto"));

  const grandchildUnknown = session(23, { parentID: "ses_21", projectID: "" });
  const p2 = makePlan(snap([root, child, grandchildUnknown]), s, "projectA", now);
  assert.equal(p2.candidates.length, 0);
  assert.ok(p2.families[0].reasons.includes("Otro proyecto"));
});
test("363 possible 0 verified: proteccion consistente y descendientes solos nunca razon", () => {
  const s = defaultState();
  const values = Array.from({ length: 373 }, (_, i) => session(i + 2));
  const p = makePlan(snap(values), s, "projectA", now);
  assert.equal((p as any).possible?.length, 363); assert.equal((p as any).verified?.length, 0); assert.equal(p.candidates.length, 0);
  assert.ok((p as any).possible.every((f: any) => f.reasons.includes("Actividad no verificada")));
  assert.ok(!p.families.some(f => f.reasons.some(r => /descend/i.test(r))));
  const withChild = makePlan(snap([session(1), session(50), session(100, { parentID: "ses_50" })]), s, "projectA", now);
  assert.ok(!withChild.families.some(f => f.reasons.some(r => /descend/i.test(r))));
});
test("misma incertidumbre de proyecto propaga proteccion pero conserva possible", () => {
  const s = defaultState();
  const values = Array.from({ length: 12 }, (_, i) => session(i + 1));
  const snapshot = snap(values); snapshot.unverified = new Set(["ses_12"]);
  const p = makePlan(snapshot, s, "projectA", now);
  const f12 = p.families.find(f => f.root.id === "ses_12");
  assert.ok(f12?.reasons.includes("Actividad no verificada"));
  assert.ok((p as any).possible?.some((f: any) => f.root.id === "ses_12"));
  assert.ok(!(p as any).verified?.some?.((f: any) => f.root.id === "ses_12")); assert.equal((p as any).verified?.length, 0); assert.equal(p.candidates.length, 0);
});
