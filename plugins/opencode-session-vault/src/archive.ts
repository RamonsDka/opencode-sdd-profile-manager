import * as fs from "node:fs/promises";
import path from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { atomicWrite, type Store } from "./store.ts";
import type { Gateway } from "./api.ts";
import type { Family } from "./model.ts";

const zip = promisify(gzip), unzip = promisify(gunzip);
export type ArchiveManifest = {
  schema: 1; id: string; rootID: string; title: string; created: number;
  status: "backed-up" | "deleted" | "skipped" | "error";
  files: { sessionID: string; directory: string; file: string; sha256: string; bytes: number; compressed: number }[];
};
export async function backupFamily(store: Store, gateway: Gateway, family: Family): Promise<ArchiveManifest> {
  const id = `${Date.now()}-${randomUUID()}`;
  const directory = path.join(store.dir, "backups", id);
  const manifest: ArchiveManifest = { schema: 1, id, rootID: family.root.id, title: family.root.title,
    created: Date.now(), status: "backed-up", files: [] };
  try {
    for (const session of family.members) {
      const data = await gateway.exportSession(session);
      if (data.info.time.updated !== session.time.updated) throw new Error("La sesión cambió durante el respaldo.");
      const bytes = Buffer.from(JSON.stringify(data));
      if (bytes.length > 256 * 1024 * 1024) throw new Error("La conversación supera el límite de respaldo de 256 MiB. Se conserva.");
      const compressed = await zip(bytes);
      const file = `${session.id}.json.gz`;
      await atomicWrite(path.join(directory, file), compressed);
      // Read actual persisted bytes, decompress, verify exact hash before any delete.
      const saved = await unzip(await fs.readFile(path.join(directory, file)));
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (createHash("sha256").update(saved).digest("hex") !== hash) throw new Error("No se pudo verificar el respaldo.");
      manifest.files.push({ sessionID: session.id, directory: session.directory, file,
        sha256: hash, bytes: bytes.length, compressed: compressed.length });
    }
    await saveManifest(store, manifest);
    return manifest;
  } catch (e) {
    // No deletion has happened here; remove only this incomplete backup.
    await fs.rm(directory, { recursive: true, force: true });
    throw e;
  }
}
export async function saveManifest(store: Store, manifest: ArchiveManifest) {
  await atomicWrite(path.join(store.dir, "backups", manifest.id, "manifest.json"), JSON.stringify(manifest, null, 2));
}
export async function listBackups(store: Store): Promise<ArchiveManifest[]> {
  let entries;
  try { entries = await fs.readdir(path.join(store.dir, "backups"), { withFileTypes: true }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  const result: ArchiveManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const m = JSON.parse(await fs.readFile(path.join(store.dir, "backups", entry.name, "manifest.json"), "utf8")) as ArchiveManifest;
    if (m.schema !== 1 || m.id !== entry.name || !Array.isArray(m.files)) throw new Error("Hay un respaldo incompleto; inspecciona la carpeta de respaldos.");
    result.push(m);
  }
  return result.sort((a, b) => b.created - a.created);
}
