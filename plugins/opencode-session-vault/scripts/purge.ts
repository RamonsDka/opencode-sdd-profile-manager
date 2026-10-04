import * as fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Store } from "../src/store.ts";
import { listBackups } from "../src/archive.ts";
import { safeText } from "../src/model.ts";
const store = new Store();
const input = createInterface({ input: process.stdin, output: process.stdout });
try {
  const days = Number(process.argv[2] ?? 30);
  if (!Number.isInteger(days) || days < 1) throw new Error("Indica un número entero de días, mínimo 1.");
  await store.exclusive(async () => {
    const items = (await listBackups(store)).filter(b => b.created < Date.now() - days * 86400000 && b.status === "deleted");
    for (const item of items) console.log(`${item.id} | ${safeText(item.title)}`);
    console.log(`${items.length} respaldos de conversaciones ya eliminadas, con más de ${days} días.`);
    if (!items.length) return;
    if (await input.question("Esto borra esas copias definitivamente. Escribe PURGAR: ") !== "PURGAR") return;
    await store.audit({ at: Date.now(), action: "purge-requested", backups: items.map(i => i.id) });
    for (const item of items) {
      if (!/^\d+-[a-f0-9-]+$/.test(item.id)) throw new Error("ID inválido.");
      await fs.rm(path.join(store.dir, "backups", item.id), { recursive: true });
    }
    console.log("Respaldos eliminados.");
  });
} catch (e) { console.error(String(e)); process.exitCode = 1; }
finally { input.close(); }
