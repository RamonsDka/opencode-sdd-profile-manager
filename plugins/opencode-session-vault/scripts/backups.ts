import * as fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Store, atomicWrite } from "../src/store.ts";
import { listBackups } from "../src/archive.ts";
import { safeText } from "../src/model.ts";

const store = new Store();
const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const backups = await listBackups(store);
  for (const b of backups) console.log(`${b.id} | ${new Date(b.created).toLocaleString()} | ${safeText(b.title)} | ${b.status}`);
  if (!backups.length) { console.log("No hay respaldos."); }
  else {
    const id = process.argv[2] || await terminal.question("ID del respaldo a extraer: ");
    const manifest = backups.find(b => b.id === id);
    if (!manifest) throw new Error("ID no encontrado.");
    const out = path.join(store.dir, "recovered", id);
    const commands: string[] = [];
    for (const file of manifest.files) {
      if (!/^ses_[a-zA-Z0-9]+\.json\.gz$/.test(file.file)) throw new Error("Nombre de archivo inválido.");
      const bytes = gunzipSync(await fs.readFile(path.join(store.dir, "backups", id, file.file)), { maxOutputLength: 256 * 1024 * 1024 });
      if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("Respaldo alterado; no se extrajo.");
      const data = JSON.parse(bytes.toString());
      if (data.info.id !== file.sessionID || !Array.isArray(data.messages)) throw new Error("Formato de respaldo inválido.");
      const target = path.join(out, `${file.sessionID}.json`);
      await atomicWrite(target, bytes);
      const quote = (s: string) => process.platform === "win32" ? `'${s.replaceAll("'", "''")}'` : `'${s.replaceAll("'", "'\\''")}'`;
      commands.push(`${process.platform === "win32" ? "Set-Location -LiteralPath" : "cd --"} ${quote(file.directory)}`, `opencode import ${quote(target)}`);
    }
    const instructions = ["Cierra OpenCode. Comprueba que estas sesiones ya no existen antes de importarlas.",
      "Los chats se importan al proyecto del directorio actual. Si el directorio ya no existe, elige el proyecto de destino.",
      "Ejecuta estos comandos en PowerShell (Windows) o tu terminal (Linux/macOS), en el orden indicado:", "", ...commands, "",
      "Se recuperan conversaciones, no el historial completo de eventos, snapshots Git o archivos externos."].join("\n");
    await atomicWrite(path.join(out, "COMO-RESTAURAR.txt"), instructions);
    console.log(`Archivos extraídos y verificados en: ${out}\n${instructions}`);
  }
} catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }
finally { terminal.close(); }
