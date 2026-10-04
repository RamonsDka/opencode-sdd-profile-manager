import test from "node:test";
import assert from "node:assert/strict";
import { editConfig } from "../scripts/install.ts";
import { parse } from "jsonc-parser";
const url = "file:///C:/Users/Demo/extensions/session-vault/tui.js";
test("instalador preserva JSONC y plugins existentes", () => {
  const text = '{\n// Mi configuración\n"theme":"opencode",\n"plugin":["opencode-sdd-profile-manager",["another",{"a":1}]],\n}';
  const output = editConfig(text, url);
  assert.ok(output.includes("// Mi configuración")); assert.equal(parse(output).theme, "opencode");
  assert.deepEqual(parse(output).plugin.slice(0, 2), ["opencode-sdd-profile-manager", ["another", { a: 1 }]]);
  assert.equal(parse(output).plugin[2], url);
});
test("reinstalar es idempotente y desinstalar retira solo su entrada", () => {
  const first = editConfig('{"plugin":["sdd"]}', url);
  assert.equal(editConfig(first, url), first);
  assert.deepEqual(parse(editConfig(first, url, true)).plugin, ["sdd"]);
});
test("JSON o campo plugin inválido no se sobrescriben", () => {
  for (const input of ["{broken", "null", "[]", '{"plugin":{}}']) assert.throws(() => editConfig(input, url));
});
