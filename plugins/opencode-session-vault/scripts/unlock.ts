import * as fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Store } from "../src/store.ts";
const store = new Store();
const input = createInterface({ input: process.stdin, output: process.stdout });
try {
  console.log("Este reparador solo quita operation.lock, nunca candados de sesiones. Cierra todas las instancias de OpenCode.");
  const file = path.join(store.dir, "operation.lock");
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  if (!Number.isInteger(data.pid) || data.pid <= 0) throw new Error("Bloqueo inválido: revísalo manualmente con OpenCode cerrado.");
  let live = true;
  try { process.kill(data.pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") live = false; else throw e; }
  if (live) throw new Error("El proceso registrado sigue vivo. No se quitó el bloqueo.");
  if (await input.question("Escribe CERRADO para quitar el bloqueo de la operación interrumpida: ") === "CERRADO") {
    await fs.unlink(file); console.log("Bloqueo de operación retirado. Puedes reiniciar OpenCode.");
  }
} catch (e) { console.error((e as NodeJS.ErrnoException).code === "ENOENT" ? "No hay un bloqueo de operación que reparar." : String(e)); }
finally { input.close(); }
