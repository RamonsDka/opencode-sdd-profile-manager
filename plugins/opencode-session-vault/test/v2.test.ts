import test from "node:test";
import assert from "node:assert/strict";
import { V2Gateway, V2_DELETION_BLOCKED, disabledV2Helper } from "../src/api-v2.ts";
const info = (id: string) => ({ id, projectID: "proj", location: { directory: "/demo" }, time: { created: 1, updated: 2 } });
test("V2 vault paginates native inventory", async () => {
  const args: unknown[] = [];
  let calls = 0;
  const list = async (arg: unknown) => {
    args.push(arg);
    calls += 1;
    return calls === 1
      ? { data: [info("ses_a")], cursor: { next: "p2" } }
      : { data: [info("ses_b")], cursor: {} };
  };
  const rows = await new V2Gateway({ session: { list } } as any).list();
  assert.deepStrictEqual(rows.map(s => [s.id, s.directory, s.title]), [["ses_a", "/demo", "ses_a"], ["ses_b", "/demo", "ses_b"]]);
  assert.deepStrictEqual(args, [{ limit: 256 }, { limit: 256, cursor: "p2" }]);
});
test("V2 vault rejects duplicate inventory", async () => {
  const list = async () => ({ data: [info("ses_a")], cursor: { next: "same" } });
  await assert.rejects(new V2Gateway({ session: { list } } as any).list());
});
test("V2 vault protects all sessions despite running status", async () => {
  const session = { list: async () => ({ data: [info("ses_a"), info("ses_b")], cursor: {} }), active: async () => ({ ses_a: { type: "running" } }) };
  const snapshot = await new V2Gateway({ session } as any).snapshot(new Set());
  assert.deepStrictEqual([...snapshot.busy], ["ses_a"]);
  assert.deepStrictEqual([...snapshot.unverified!], ["ses_a", "ses_b"]);
});
test("V2 vault preserves native export", async () => {
  const message = { id: "msg_a", type: "user", content: [{ type: "text", text: "preserve" }] };
  const native = { info: info("ses_a"), messages: [message] };
  let exportArg: unknown;
  const exportSession = async (arg: unknown) => { exportArg = arg; return native; };
  const result = await new V2Gateway({ session: { export: exportSession } } as any).exportSession({ ...native.info, directory: "/demo", title: "a" });
  assert.deepStrictEqual(result.messages[0], { info: message, parts: message.content });
  assert.deepStrictEqual((result as any).native, native);
  assert.deepStrictEqual(exportArg, { sessionID: "ses_a", sanitize: false });
});
test("V2 vault never calls destructive removal", async () => {
  let called = false;
  const remove = async () => { called = true; };
  await assert.rejects(new V2Gateway({ session: { remove } } as any).remove(info("ses_a") as any), { message: V2_DELETION_BLOCKED });
  assert.equal(called, false);
});
test("V2 vault blocks offline SQLite and spawn", () => {
  assert.throws(() => disabledV2Helper().inspectDatabase(), /V2 offline maintenance is unavailable/);
  assert.throws(() => disabledV2Helper().armAndSpawn(), /V2 offline maintenance is unavailable/);
});
