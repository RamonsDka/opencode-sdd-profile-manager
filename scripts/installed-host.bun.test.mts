import { test, expect } from "bun:test";
import path from "node:path";
import { Host } from "C:/Users/DELL/.config/opencode/node_modules/@opencode/plugin/dist/host.js";

import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure";
import { Plugin, PluginContextProvider, usePlugin } from "@opencode/plugin/tui";

// Match the V2.0.21 CLI preload; this is a separate Bun harness, not a live CLI check.
ensureRuntimePluginSupport({
  additional: { "@opencode/plugin/tui": { Plugin, PluginContextProvider, usePlugin } },
});
const root = path.resolve(import.meta.dir, "..");
const packages = [
  [root, "opencode-sdd-profile-manager"],
  [path.join(root, "plugins/suite-de-agentes"), "opencode-agent-suite"],
  [path.join(root, "plugins/opencode-session-vault"), "opencode-session-vault"],
];

for (const [directory, name] of packages) {
  test(`installed Bun Host.resolve/load: ${name}, optional RPC absent`, async () => {
    const result = Host.resolve({ directory, name });
    expect(result.tui).toBeString();
    expect(result.rpc).toBeUndefined();
    const plugin = await Host.load(result.tui!);
    expect(plugin.default.setup).toBeFunction();
  });
}

test("resolver accepts coded non-Error objects but rethrows unrelated failures", () => {
  const resolveWith = (failure: unknown) =>
    new Function("path", "resolveModule", `return (${Host.resolve.toString()})`)(
      path, () => { throw failure; },
    );
  for (const failure of [{ code: "ERR_MODULE_NOT_FOUND" }, new Error("ordinary failure"), { code: "EACCES" }, null, "ERR_MODULE_NOT_FOUND"]) {
    const resolve = resolveWith(failure);
    if (failure && typeof failure === "object" && "code" in failure && failure.code === "ERR_MODULE_NOT_FOUND") {
      expect(resolve({ directory: root, name: "missing" })).toEqual({ server: undefined, tui: undefined, rpc: undefined });
    } else {
      let caught: unknown = Symbol("not thrown");
      try { resolve({ directory: root, name: "missing" }); } catch (error) { caught = error; }
      expect(caught).toBe(failure);
    }
  }
});
test("runtime sharing preserves renderer and Solid identities across bundled source contexts", async () => {
  const { writeFileSync, unlinkSync } = await import("node:fs");
  const { pathToFileURL } = await import("node:url");
  const core = await import("@opentui/core");
  const solid = await import("@opentui/solid");
  const reactive = await import("solid-js");
  const store = await import("solid-js/store");
  for (const [directory] of packages) {
    const fixture = path.join(directory, `.renderer-identity-${process.pid}.ts`);
    writeFileSync(fixture, 'export { RGBA } from "@opentui/core"; export { render } from "@opentui/solid"; export { createSignal, getOwner } from "solid-js"; export { createStore } from "solid-js/store";');
    try {
      const loaded = await import(pathToFileURL(fixture).href);
      expect(loaded.RGBA).toBe(core.RGBA);
      expect(loaded.render).toBe(solid.render);
      expect(loaded.createSignal).toBe(reactive.createSignal);
      expect(loaded.createStore).toBe(store.createStore);
      reactive.createRoot((dispose) => {
        expect(loaded.getOwner()).toBe(reactive.getOwner());
        dispose();
      });
    } finally {
      unlinkSync(fixture);
    }
  }
});
