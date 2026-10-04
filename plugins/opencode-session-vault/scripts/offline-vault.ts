#!/usr/bin/env node
/**
 * Herramienta de mantenimiento fuera de línea para OpenCode Session Vault.
 *
 * Requisitos críticos de seguridad:
 * - OpenCode debe estar completamente cerrado (fail-closed process check).
 * - Selección rigurosa de familias completas de sesiones (parent_id sin FK).
 * - Revalidación transaccional (detecta sesiones modificadas, hijos nuevos, candados).
 * - Respaldo SQLite consistente y verificable previo a cualquier borrado.
 * - Comprobación de claves foráneas e integridad (foreign_key_check, quick_check).
 * - Compactación (VACUUM) separable: si el borrado se confirma y VACUUM falla,
 *   se reporta éxito parcial sin repetir ni revertir el borrado.
 * - Sin garantías absolutas: BEGIN EXCLUSIVE en WAL no excluye lectores externos
 *   ni cubre la brecha commit->VACUUM.
 * - Datos privados nunca en registros.
 */

import * as readline from "node:readline/promises";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import { Store } from "../src/store.ts";
import {
  defaultDatabasePath,
  inspectDatabase,
  generateOfflinePlan,
  applyOfflinePlan,
  checkOpenCodeProcessRunning,
  armOfflinePlan,
  cancelArmedPlan,
  getArmedPlan,
  getClaimedPlan,
  inspectClaimedState,
  getReceipt,
  clearReceipt,
  runArmedMaintenance,
  type OfflinePlan,
  type ArmedPlan,
  type MaintenanceReceipt,
} from "../src/offline.ts";

function printHelp() {
  console.log(`
Uso: node scripts/offline-vault.ts <comando> [opciones]

Comandos:
  inspect           Inspeccionar el archivo de base de datos (solo lectura, sin cambios).
  plan              Generar plan de limpieza basado en perfiles y candados (modo simulado / dry-run, no borra).
  claimed           Inspeccionar estado de operaciones reclamadas / incidentes (solo lectura).
  apply             Aplicar el plan: suspendido temporalmente por contención de incidentes.
  run-armed         Ejecutar mantenimiento armado: suspendido temporalmente por contención de incidentes.
  cancel-armed      Cancelar un plan de mantenimiento armado en espera.
  receipt           Consultar o limpiar el recibo del último mantenimiento ejecutado.

Opciones generales:
  --db <ruta>       Ruta explícita a opencode.db (por defecto busca la ruta canónica del sistema).
  --plan <ruta>     Ruta al archivo de plan JSON (por defecto: vault-plan.json).
  --out <ruta>      Ruta donde guardar el plan generado (por defecto: vault-plan.json).
  --project <id>    ID del proyecto objetivo (requerido si el alcance en Vault es 'project').
  --max <n>         Límite máximo de familias a seleccionar en el lote (1–100).
  --json            Emitir el resultado estructurado en formato JSON a stdout.
  --allow-running   Permitir plan/inspección de solo lectura mientras OpenCode esté abierto.
  --state-dir <dir> Directorio de estado de Session Vault (por defecto el canónico).
  --owner-pid <pid> PID del proceso OpenCode propietario a monitorear antes de ejecutar.
  --clear           Limpiar el recibo tras consultarlo (en comando 'receipt').
  --confirm         Omitir solicitud interactiva de confirmación y ejecutar.
  --skip-vacuum     Borrar sesiones y respaldar pero omitir la compactación VACUUM.
  --help, -h        Mostrar esta ayuda.
`);
}

function parseArgs(args: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--confirm") {
      flags.confirm = true;
    } else if (arg === "--skip-vacuum") {
      flags.skipVacuum = true;
    } else if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        flags[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { command: positional[0], flags };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").substring(0, 19);
}

async function handleInspect(dbPath: string, asJson = false, checkIntegrity = false) {
  if (!asJson) {
    console.log(`\nComprobando estado de OpenCode...`);
    await checkOpenCodeProcessRunning();
    console.log(`OpenCode cerrado. Inspeccionando base de datos: ${dbPath}`);
  }

  const info = await inspectDatabase(dbPath, { checkIntegrity });
  if (asJson) {
    console.log(JSON.stringify(info));
    return;
  }

  console.log(`
--- RESUMEN DE INSPECCIÓN ---
Ruta:              ${info.dbPath}
Tamaño en disco:   ${formatBytes(info.sizeBytes)}
Sesiones totales:  ${info.sessionCount}
Páginas libres:    ${info.freelistCount} (${formatBytes(info.freeBytes)})
Integridad SQLite: ${info.integrity === "pending" ? "Pendiente (usa --check-integrity para escanear páginas)" : info.integrity}
Tablas detectadas: ${info.tables.join(", ")}
-----------------------------
Operación 100% de solo lectura. No se modificó ningún archivo.
Para evaluar qué sesiones calificarían para limpieza según tus perfiles y candados,
ejecuta: node scripts/offline-vault.ts plan
`);
}

async function handlePlan(
  dbPath: string,
  planPath: string,
  batchLimit?: number,
  projectID?: string,
  asJson = false,
  allowRunning = false,
  stateDir?: string
) {
  if (!asJson && !allowRunning) {
    console.log(`\nComprobando estado de OpenCode...`);
    await checkOpenCodeProcessRunning();
  }

  const store = new Store(stateDir);
  const state = await store.read();

  if (state.config.scope === "project" && (!projectID || projectID.trim() === "")) {
    throw new Error(
      "El alcance configurado en Vault es 'project'. Debes especificar el proyecto objetivo con '--project <id>'."
    );
  }

  if (!asJson) {
    console.log(`Generando plan fuera de línea para: ${dbPath}`);
    console.log(
      `Perfil activo: ${state.config.profile} | Alcance: ${state.config.scope}${
        state.config.scope === "project" ? ` (proyecto: ${projectID})` : ""
      } | Candados configurados: ${state.pins.length}`
    );
  }

  const plan = await generateOfflinePlan({
    dbPath,
    store,
    projectID,
    batchLimit,
    allowRunningProcess: allowRunning,
  });

  if (asJson) {
    console.log(JSON.stringify(plan));
    return;
  }

  console.log(`
--- PLAN DE LIMPIEZA (SIMULACIÓN / DRY-RUN) ---
Sesiones totales:       ${plan.totalSessions}
Familias totales:       ${plan.totalFamilies}
Familias protegidas:    ${plan.retainedFamiliesCount} (candados, dentro del cupo, archivadas o recientes)
Familias candidatas:    ${plan.candidateFamiliesCount}
Familias en este lote:  ${plan.selectedFamilies.length} (máx. permitido por ejecución)
Cupo de retención:      ${plan.quota.keep} familias conservadas
Expiración del plan:    30 minutos
Huella digital (SHA):   ${plan.fingerprint.slice(0, 16)}...
-----------------------------------------------`);

  if (plan.selectedFamilies.length === 0) {
    console.log(`No hay familias candidatas para borrar. Todas tus sesiones están protegidas por candados, cuota o actividad reciente.`);
    return;
  }

  console.log(`\nFamilias seleccionadas para eliminación (de más antigua a más reciente):`);
  for (let i = 0; i < plan.selectedFamilies.length; i++) {
    const f = plan.selectedFamilies[i];
    const childNote = f.memberIds.length > 1 ? ` (+${f.memberIds.length - 1} hijas)` : "";
    console.log(` [${i + 1}] Raíz: ${f.rootId} | Miembros: ${f.memberIds.length}${childNote} | Última act: ${formatDate(f.updated)} | "${f.title.slice(0, 40)}"`);
  }

  await fs.writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
  console.log(`\nPlan guardado en: ${planPath}`);
  console.log(`NOTA: El plan NO ha modificado la base de datos (modo seguro).`);
  console.log(`Para aplicar este plan de forma definitiva (con respaldo y verificación previa):`);
  console.log(`  node scripts/offline-vault.ts apply --plan "${planPath}"`);
}

async function handleApply(dbPath: string, planPath: string, autoConfirm = false, skipVacuum = false) {
  // Protective gate: centrally disallow production destructive apply
  throw new Error(
    "Mantenimiento suspendido: operación interrumpida / exclusión no garantizada (coordinación exclusiva de host no disponible en producción)."
  );
}

async function handleRunArmed(stateDir?: string, ownerPidStr?: string, skipVacuum = false) {
  // Protective gate: centrally disallow production destructive run-armed
  throw new Error(
    "Mantenimiento suspendido: operación interrumpida / exclusión no garantizada (coordinación exclusiva de host no disponible en producción)."
  );
}

async function handleCancelArmed(stateDir?: string) {
  const store = new Store(stateDir);
  const cancelled = await cancelArmedPlan(store);
  console.log(JSON.stringify({ cancelled }));
}

async function handleClaimed(stateDir?: string, asJson = false) {
  const store = new Store(stateDir);
  const report = await inspectClaimedState(store);
  if (asJson) {
    console.log(JSON.stringify({ claimed: report }));
    return;
  }
  if (!report) {
    console.log("\nNo se detectó ningún plan de mantenimiento en estado reclamado.");
    return;
  }
  console.log(`
--- ESTADO DE OPERACIÓN RECLAMADA (INSPECCIÓN NO DESTRUCTIVA) ---
Estado general:      ${report.status.toUpperCase()}
Estado del proceso:  ${report.pidStatus} (PID: ${report.workerPid ?? "no registrado"})
Plan ID:             ${report.incidentInfo.armId}
Base de datos:       ${report.incidentInfo.canonicalDbPath}
Familias en lote:    ${report.incidentInfo.selectedFamilyCount}
Sesiones totales:    ${report.incidentInfo.totalSessionCount}
Resultado en datos:  ${report.incidentInfo.outcome.toUpperCase()} (sin verificar por operador)
Recibo generado:     ${report.hasReceipt ? "SÍ" : "NO"}
-----------------------------------------------------------------
ACCIONES RECOMENDADAS:
- ${report.incidentInfo.actionableMessage}
- Inspección 100% de solo lectura. No se modificó ningún archivo.
`);
}

async function handleReceipt(stateDir?: string, clear = false) {
  const store = new Store(stateDir);
  const receipt = await getReceipt(store);
  if (clear) {
    await clearReceipt(store);
  }
  console.log(JSON.stringify({ receipt }));
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (flags.help || !command) {
    printHelp();
    return;
  }

  const explicitDb = typeof flags.db === "string" ? flags.db : defaultDatabasePath();
  const planPath = path.resolve(typeof flags.plan === "string" ? flags.plan : typeof flags.out === "string" ? flags.out : "vault-plan.json");
  const batchLimit = typeof flags.max === "string" ? parseInt(flags.max, 10) : undefined;
  const projectID = typeof flags.project === "string" ? flags.project.trim() : undefined;
  const autoConfirm = Boolean(flags.confirm);
  const skipVacuum = Boolean(flags.skipVacuum);
  const asJson = Boolean(flags.json);
  const allowRunning = Boolean(flags.allowRunning || flags["allow-running"]);
  const stateDir = typeof flags["state-dir"] === "string" ? flags["state-dir"] : undefined;
  const ownerPid = typeof flags["owner-pid"] === "string" ? flags["owner-pid"] : undefined;

  try {
    switch (command) {
      case "inspect":
        await handleInspect(
          explicitDb,
          asJson,
          Boolean(flags["check-integrity"] || flags["full-integrity"] || flags.integrity)
        );
        break;
      case "plan":
        await handlePlan(explicitDb, planPath, batchLimit, projectID, asJson, allowRunning, stateDir);
        break;
      case "claimed":
        await handleClaimed(stateDir, asJson);
        break;
      case "apply":
        await handleApply(explicitDb, planPath, autoConfirm, skipVacuum);
        break;
      case "run-armed":
        await handleRunArmed(stateDir, ownerPid, skipVacuum);
        break;
      case "cancel-armed":
        await handleCancelArmed(stateDir);
        break;
      case "receipt":
        await handleReceipt(stateDir, Boolean(flags.clear));
        break;
      default:
        console.error(`Comando desconocido: ${command}`);
        printHelp();
        process.exitCode = 1;
    }
  } catch (err) {
    if (asJson) {
      console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    } else {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exitCode = 1;
  }
}

void main();
