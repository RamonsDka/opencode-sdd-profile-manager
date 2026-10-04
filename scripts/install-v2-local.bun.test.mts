import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Host } from "C:/Users/DELL/.config/opencode/node_modules/@opencode/plugin/dist/host.js";

test("installer registrations satisfy the installed directory resolver for server and TUI", () => {
  const home = mkdtempSync(path.join(tmpdir(), "opencode-v2-registration-"));
  mkdirSync(path.join(home, "opencode"));
  for (const file of ["cli.json", "opencode.json"]) {
    writeFileSync(path.join(home, "opencode", file), '{/* retained */"plugin":[],"plugins":[],"unrelated":true}');
  }
  const result = Bun.spawnSync(["node", path.join(import.meta.dir, "install-v2-local.mjs")], {
    env: { ...process.env, XDG_CONFIG_HOME: home },
  });
  expect(result.exitCode).toBe(0);
  const registrations = result.stdout.toString().trim().split("\n").map(line => JSON.parse(line));
  expect(registrations).toHaveLength(2);
  for (const item of registrations) {
    const directory = fileURLToPath(item.ownedSource);
    expect(statSync(directory).isDirectory()).toBe(true);
    const resolved = Host.resolve({ directory });
    expect(resolved.server).toEndWith("/server.ts");
    expect(resolved.tui).toEndWith("/tui.ts");
  }
  expect(registrations[0].ownedSource).toBe(registrations[1].ownedSource);
});
