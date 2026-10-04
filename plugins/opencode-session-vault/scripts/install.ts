import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, modify, applyEdits, type ParseError } from "jsonc-parser";
import { atomicWrite } from "../src/store.ts";

export function editConfig(text: string, entry: string, uninstall = false): string {
  const errors: ParseError[] = [];
  const config = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== "object" || Array.isArray(config)) throw new Error("tui.json/jsonc no es válido. No se modificó.");
  if (config.plugin !== undefined && !Array.isArray(config.plugin)) throw new Error("El campo plugin debe ser una lista. No se modificó.");
  const list = config.plugin ?? [];
  const matches = list.map((value: unknown, i: number) => (Array.isArray(value) ? value[0] : value) === entry ? i : -1).filter((i: number) => i >= 0);
  const options = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes("\r\n") ? "\r\n" : "\n" } };
  if (!uninstall) {
    if (matches.length) return text;
    return applyEdits(text, modify(text, config.plugin === undefined ? ["plugin"] : ["plugin", list.length], config.plugin === undefined ? [entry] : entry, { ...options, isArrayInsertion: true }));
  }
  let next = text;
  for (const i of matches.reverse()) next = applyEdits(next, modify(next, ["plugin", i], undefined, options));
  return next;
}
async function exists(file: string) { try { await fs.access(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; } }
export async function install(args: string[], releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const option = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Falta el valor de ${name}`); return args[i + 1]; };
  const configDir = path.resolve(option("--config-dir") || process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode"));
  const destination = path.join(configDir, "extensions", "session-vault");
  const entry = pathToFileURL(path.join(destination, "tui.js")).href;
  const json = path.join(configDir, "tui.json"), jsonc = path.join(configDir, "tui.jsonc");
  const custom = option("--config-file");
  if (!custom && await exists(json) && await exists(jsonc)) throw new Error("Existen tui.json y tui.jsonc. Indica el archivo activo con --config-file ruta.");
  const configFile = custom ? path.resolve(custom) : await exists(jsonc) ? jsonc : json;
  const previous = await exists(configFile) ? await fs.readFile(configFile, "utf8") : '{\n  "$schema": "https://opencode.ai/tui.json"\n}\n';
  const uninstall = args.includes("--uninstall");
  const next = editConfig(previous, entry, uninstall);
  if (args.includes("--dry-run")) return { configFile, destination, preview: next, changed: next !== previous };
  if (!uninstall) {
    const bundle = await fs.readFile(path.join(releaseRoot, "dist", "tui.js"));
    const manifest = JSON.parse(await fs.readFile(path.join(releaseRoot, "package.json"), "utf8"));
    if (manifest.name !== "opencode-session-vault" || !bundle.length) throw new Error("Paquete de instalación inválido.");
    await atomicWrite(path.join(destination, "tui.js"), bundle);
    const helperSource = path.join(releaseRoot, "dist", "offline-vault.mjs");
    if (await exists(helperSource)) {
      const helperBundle = await fs.readFile(helperSource);
      await atomicWrite(path.join(destination, "offline-vault.mjs"), helperBundle);
    }
    await atomicWrite(path.join(destination, "package.json"), JSON.stringify({ name: manifest.name, version: manifest.version, type: "module" }));
  }
  if (next !== previous) {
    if (await exists(configFile)) await fs.copyFile(configFile, `${configFile}.session-vault-${Date.now()}.bak`, fs.constants.COPYFILE_EXCL);
    await atomicWrite(configFile, next);
  }
  return { configFile, destination, changed: next !== previous, uninstall };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  install(process.argv.slice(2)).then(result => {
    if ("preview" in result) console.log(result.preview);
    else console.log(result.uninstall ? "Session Vault desactivado. Reinicia OpenCode. Tus candados y respaldos se conservan." : "Session Vault instalado. Reinicia OpenCode y escribe /session-vault. Requiere OpenCode 1.18.29 de la rama 1.x.");
    console.log(`Configuración: ${result.configFile}`);
  }).catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
}
