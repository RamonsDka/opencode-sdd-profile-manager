import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { applyEdits, modify, parse } from "jsonc-parser";

const root = resolve(import.meta.dirname, "..");
const home = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
const configRoot = join(home, "opencode");
const targets = [
  { path: join(configRoot, "cli.json"), key: "plugins", entry: pathToFileURL(root).href },
  { path: join(configRoot, existsSync(join(configRoot, "opencode.jsonc")) ? "opencode.jsonc" : "opencode.json"), key: "plugin", entry: pathToFileURL(root).href },
];

// Preserve unrelated entries and JSONC comments. The host already bundles both TUIs.
// V2 resolves configured directories without a package name, so exports alone
// do not suffice: these conventional entry files must exist inside the directory.
if (!statSync(root).isDirectory() || !["server.ts", "tui.ts"].every(name => statSync(join(root, name)).isFile())) {
  throw new Error("Plugin registration requires a directory with server.ts and tui.ts");
}
const owned = value => {
  const name = typeof value === "string" ? value : value?.package;
  return typeof name === "string" && /opencode-sdd-profile-manager|suite-de-agentes|agent-suite-plugin\.mjs|opencode-session-vault/.test(name);
};
const candidates = targets.map(target => {
  const before = readFileSync(target.path, "utf8");
  const errors = [];
  const document = parse(before, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`Invalid configuration: ${target.path}`);
  const key = target.key === "plugin" && Array.isArray(document.plugins) ? "plugins" : target.key;
  const entries = document[key] ?? [];
  if (!Array.isArray(entries)) throw new Error(`Invalid plugin array: ${target.path}`);
  const plugins = [...entries.filter(entry => !owned(entry)), target.entry];
  const candidate = applyEdits(before, modify(before, [key], plugins, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  const next = parse(candidate);
  const expected = { ...document, [key]: plugins };
  if (JSON.stringify(next) !== JSON.stringify(expected)) throw new Error("Unrelated configuration changed");
  const bytes = Buffer.byteLength(candidate);
  if (bytes > 1024 * 1024) throw new Error("Configuration exceeds safety budget");
  return { ...target, key, candidate, bytes, words: candidate.trim().split(/\s+/).length, hash: createHash("sha256").update(candidate).digest("hex"), plugins };
});
for (const item of candidates) {
  if (process.argv.includes("--apply")) {
    // Do not duplicate secret-bearing configuration to a plaintext backup.
    // The original document stays in memory for this transaction.
    writeFileSync(item.path, item.candidate, "utf8");
    const actual = readFileSync(item.path, "utf8");
    if (actual !== item.candidate) throw new Error("Post-write verification failed");
  }
  console.log(JSON.stringify({ path: item.path, field: item.key, applied: process.argv.includes("--apply"), bytes: item.bytes, words: item.words, sha256: item.hash, ownedSource: item.entry, otherEntriesPreserved: item.plugins.length - 1 }));
}
