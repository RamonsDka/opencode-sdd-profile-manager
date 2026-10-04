import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";
import type { Session, Snapshot } from "./model.ts";
import { validateSessions } from "./policy.ts";

export type ExportData = { info: Session; messages: Array<{ info: { id: string; [key: string]: unknown }; parts: unknown[] }> };

export interface GatewayOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  liveness?: boolean;
  candidateDirectories?: Set<string> | string[];
  provenRoutingDirectories?: Set<string> | string[];
}

export interface Gateway {
  list(options?: GatewayOptions): Promise<Session[]>;
  snapshot(active: Set<string>, activeDirectory?: string, activeProjectID?: string, options?: GatewayOptions): Promise<Snapshot>;
  exportSession(session: Session, options?: GatewayOptions): Promise<ExportData>;
  remove(session: Session, options?: GatewayOptions): Promise<void>;
  diagnoseDirectoryRouting?(dir: string, options?: GatewayOptions): Promise<{
    directory: string;
    canonicalDirectory: string;
    existsOnDisk: boolean;
    proven: boolean;
    reason?: string;
  }>;
}

/**
 * Computes canonical directory representation for safe cross-platform identity comparison.
 * Handles Windows case-insensitivity, mixed slash separators, and root directories safely.
 * Never uses prefix matching.
 */
export function canonicalizeDirectory(dirPath?: string | null): string {
  if (!dirPath || typeof dirPath !== "string") return "";
  const resolved = path.resolve(dirPath);
  const parsed = path.parse(resolved);
  let normalized = path.normalize(resolved);
  if (normalized !== parsed.root) {
    normalized = normalized.replace(/[/\\]+$/, "");
  }
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isSameDirectory(a?: string | null, b?: string | null): boolean {
  const canonA = canonicalizeDirectory(a);
  const canonB = canonicalizeDirectory(b);
  if (!canonA || !canonB) return false;
  return canonA === canonB;
}

export interface DirectoryRoutingProofResult {
  proven: boolean;
  verifiedCanonicalDir?: string;
  reason?: string;
}

/**
 * Authoritatively verifies if the server instance is routed to the target directory.
 * Requires explicit server-returned canonical directory identity matching the target.
 * Header/query sent is NOT accepted as proof.
 * Fails closed if identity cannot be verified or mismatches.
 */
export async function verifyServerDirectoryRouting(
  client: OpencodeClient,
  targetDir: string,
  signal: AbortSignal
): Promise<DirectoryRoutingProofResult> {
  const targetCanonical = canonicalizeDirectory(targetDir);
  if (!targetCanonical) {
    return { proven: false, reason: "invalid_target_directory" };
  }

  const queryParams: Record<string, unknown> = { directory: targetDir };
  const requestOptions: Record<string, unknown> = {
    throwOnError: true,
    signal,
    headers: {
      "x-opencode-directory": encodeURIComponent(targetDir),
      "x-opencode-workspace": "",
    },
  };

  // 1. Authoritative check via /path endpoint (client.path.get)
  const pathApi = (client as unknown as { path?: { get?: (params: any, options: any) => Promise<any> } }).path;
  if (typeof pathApi?.get === "function") {
    try {
      const res = await raceWithSignal(pathApi.get(queryParams, requestOptions), signal);
      const data = res?.data;
      if (data && typeof data === "object") {
        const reportedDir = typeof data.directory === "string" ? canonicalizeDirectory(data.directory) : "";
        const reportedWorktree = typeof data.worktree === "string" ? canonicalizeDirectory(data.worktree) : "";
        if (reportedDir === targetCanonical || reportedWorktree === targetCanonical) {
          return { proven: true, verifiedCanonicalDir: reportedDir || reportedWorktree };
        }
        return {
          proven: false,
          reason: `mismatched_path_identity: expected ${targetCanonical}, got dir=${reportedDir} worktree=${reportedWorktree}`,
        };
      }
    } catch (e: any) {
      if (signal.aborted) throw e;
      // path.get failed or endpoint missing, try next strategy
    }
  }

  // 2. Authoritative check via /project/current endpoint (client.project.current)
  const projectApi = (client as unknown as { project?: { current?: (params: any, options: any) => Promise<any> } }).project;
  if (typeof projectApi?.current === "function") {
    try {
      const res = await raceWithSignal(projectApi.current(queryParams, requestOptions), signal);
      const data = res?.data;
      if (data && typeof data === "object") {
        const reportedWorktree = typeof data.worktree === "string" ? canonicalizeDirectory(data.worktree) : "";
        if (reportedWorktree === targetCanonical) {
          return { proven: true, verifiedCanonicalDir: reportedWorktree };
        }
        return {
          proven: false,
          reason: `mismatched_project_identity: expected ${targetCanonical}, got worktree=${reportedWorktree}`,
        };
      }
    } catch (e: any) {
      if (signal.aborted) throw e;
      // project.current failed or endpoint missing
    }
  }

  return { proven: false, reason: "authoritative_directory_identity_unavailable" };
}

export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      val => {
        signal.removeEventListener("abort", onAbort);
        resolve(val);
      },
      err => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

export function createTimeoutController(timeoutMs?: number, parentSignal?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  if (timeoutMs && timeoutMs > 0 && timeoutMs < Infinity) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  const onParentAbort = () => {
    controller.abort();
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      if (timer) clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    },
  };
}

export class OpenCodeGateway implements Gateway {
  client: OpencodeClient;
  activeDirectory?: string;
  activeWorkspaceID?: string;

  constructor(client: OpencodeClient, options?: { activeDirectory?: string; activeWorkspaceID?: string }) {
    this.client = client;
    this.activeDirectory = options?.activeDirectory;
    this.activeWorkspaceID = options?.activeWorkspaceID;
  }

  async list(options?: GatewayOptions): Promise<Session[]> {
    const timeoutMs = options?.timeoutMs ?? 15000;
    const parentSignal = options?.signal;
    const timeoutCtrl = createTimeoutController(timeoutMs, parentSignal);

    try {
      for (let limit = 256; limit <= 131072; limit *= 2) {
        const queryParams: Record<string, unknown> = {
          roots: false,
          archived: true,
          limit,
          directory: "",
        };
        if (this.activeWorkspaceID) {
          queryParams.workspace = this.activeWorkspaceID;
        }

        const requestOptions: Record<string, unknown> = {
          throwOnError: true,
          signal: timeoutCtrl.signal,
        };
        if (this.activeDirectory) {
          requestOptions.headers = {
            "x-opencode-directory": encodeURIComponent(this.activeDirectory),
          };
        }

        const r = await raceWithSignal(this.client.experimental.session.list(queryParams, requestOptions), timeoutCtrl.signal);
        if (!Array.isArray(r.data)) throw new Error("OpenCode no devolvió el inventario de sesiones.");
        if (r.data.length < limit && !r.response?.headers?.get?.("x-next-cursor")) {
          const sessions = r.data as Session[];
          validateSessions(sessions);
          return sessions;
        }
      }
      throw new Error("Inventario demasiado grande para verificarlo completo. Limpieza suspendida.");
    } catch (e) {
      if (timeoutCtrl.didTimeout()) {
        throw new Error("Tiempo de espera agotado al consultar el inventario de sesiones.");
      }
      if (parentSignal?.aborted) {
        throw new Error("Operación cancelada.");
      }
      throw e;
    } finally {
      timeoutCtrl.dispose();
    }
  }

  async snapshot(
    active: Set<string>,
    activeDirectory?: string,
    activeProjectID?: string,
    options?: GatewayOptions
  ): Promise<Snapshot> {
    const sessions = await this.list(options);
    const busy = new Set<string>();
    const unverified = new Set<string>();

    // Inventory-only browsing: skips status calls and foreign directory boots
    if (options?.liveness === false) {
      return { sessions, busy, active, unverified };
    }

    const effectiveActiveDir = activeDirectory ?? this.activeDirectory;
    const timeoutMs = options?.timeoutMs ?? 30000;
    const parentSignal = options?.signal;
    const timeoutCtrl = createTimeoutController(timeoutMs, parentSignal);

    try {
      let statusData: Record<string, { type?: string }> = {};

      if (effectiveActiveDir) {
        const queryParams: Record<string, unknown> = { directory: effectiveActiveDir };
        if (this.activeWorkspaceID) {
          queryParams.workspace = this.activeWorkspaceID;
        }

        const requestOptions: Record<string, unknown> = {
          throwOnError: true,
          signal: timeoutCtrl.signal,
          headers: {
            "x-opencode-directory": encodeURIComponent(effectiveActiveDir),
          },
        };

        const r = await raceWithSignal(this.client.session.status(queryParams, requestOptions), timeoutCtrl.signal);
        if (!r.data || typeof r.data !== "object" || Array.isArray(r.data)) {
          throw new Error("No se pudo verificar el estado de actividad.");
        }
        statusData = r.data as Record<string, { type?: string }>;
      }

      // Check active directory sessions
      for (const s of sessions) {
        if (effectiveActiveDir && isSameDirectory(s.directory, effectiveActiveDir)) {
          const st = statusData[s.id];
          if (st) {
            if (!st.type || !["idle", "busy", "retry"].includes(st.type)) {
              busy.add(s.id);
              unverified.add(s.id);
            } else if (st.type !== "idle") {
              busy.add(s.id);
            }
          }
        }
      }

      // Multi-project candidate directory verification:
      // When candidateDirectories is provided, safely verify activity per directory with bounded concurrency.
      const candidateDirsSet = new Set<string>();
      const candidateDirsList: string[] = [];
      if (options?.candidateDirectories) {
        for (const d of options.candidateDirectories) {
          if (d && (!effectiveActiveDir || !isSameDirectory(d, effectiveActiveDir))) {
            const canon = canonicalizeDirectory(d);
            if (canon && !candidateDirsSet.has(canon)) {
              candidateDirsSet.add(canon);
              candidateDirsList.push(d);
            }
          }
        }
      }

      const foreignDirsToCheck = candidateDirsList;
      if (foreignDirsToCheck.length > 0) {
        const foreignStartTime = Date.now();
        // Bounded concurrency (max 4 concurrent status calls to prevent boot storms)
        await mapConcurrent(foreignDirsToCheck, 4, async dir => {
          if (parentSignal?.aborted) return;
          if (timeoutCtrl.didTimeout()) {
            for (const s of sessions) {
              if (isSameDirectory(s.directory, dir)) {
                busy.add(s.id);
                unverified.add(s.id);
              }
            }
            return;
          }

          // Check existence on disk before attempting to boot or call status
          let exists = false;
          try {
            const stat = await fs.stat(dir);
            exists = stat.isDirectory();
          } catch {
            exists = false;
          }

          if (!exists) {
            // Nonexistent directory fails closed without boot: mark all its sessions unverified
            for (const s of sessions) {
              if (isSameDirectory(s.directory, dir)) {
                busy.add(s.id);
                unverified.add(s.id);
              }
            }
            return;
          }

          // Bounded per-directory timeout: 5000ms, or remaining snapshot time if less
          const remainingMs = Math.max(50, timeoutMs - (Date.now() - foreignStartTime));
          const dirTimeoutMs = Math.min(5000, remainingMs);
          const dirTimeoutCtrl = createTimeoutController(dirTimeoutMs, timeoutCtrl.signal);

          try {
            const queryParams: Record<string, unknown> = { directory: dir };
            const requestOptions: Record<string, unknown> = {
              throwOnError: true,
              signal: dirTimeoutCtrl.signal,
              headers: {
                "x-opencode-directory": encodeURIComponent(dir),
                "x-opencode-workspace": "",
              },
            };

            let statusClient = this.client;
            const transport = this.client as unknown as {
              client?: {
                getConfig?: () => {
                  baseUrl?: string;
                  fetch?: typeof fetch;
                  headers?: HeadersInit;
                };
              };
            };
            const clientConfig = transport.client?.getConfig?.();
            if (clientConfig) {
              try {
                const detachedHeaders = new Headers(clientConfig.headers as HeadersInit);
                detachedHeaders.delete("x-opencode-workspace");
                detachedHeaders.delete("x-opencode-directory");
                statusClient = createOpencodeClient({
                  baseUrl: clientConfig.baseUrl,
                  fetch: clientConfig.fetch,
                  headers: Object.fromEntries(detachedHeaders.entries()),
                  directory: dir,
                });
              } catch {
                // Fallback to client with explicit headers override
              }
            }

            // Verify routing proof authoritatively
            const routingProof = await verifyServerDirectoryRouting(statusClient, dir, dirTimeoutCtrl.signal);

            const r = await raceWithSignal(statusClient.session.status(queryParams, requestOptions), dirTimeoutCtrl.signal);
            if (!r.data || typeof r.data !== "object" || Array.isArray(r.data)) {
              throw new Error("Respuesta de estado inválida");
            }
            const dirStatus = r.data as Record<string, { type?: string }>;

            // Also inspect response header if returned by safe request scoped response
            let headerProven = false;
            const rawHeader = r.response?.headers?.get?.("x-opencode-directory");
            if (rawHeader) {
              try {
                const decoded = decodeURIComponent(rawHeader);
                if (isSameDirectory(decoded, dir)) {
                  headerProven = true;
                }
              } catch {}
            }

            const routingProven = routingProof.proven || headerProven;

            for (const s of sessions) {
              if (isSameDirectory(s.directory, dir)) {
                const st = dirStatus[s.id];
                if (st) {
                  if (!st.type || !["idle", "busy", "retry"].includes(st.type)) {
                    busy.add(s.id);
                    unverified.add(s.id);
                  } else if (st.type !== "idle") {
                    busy.add(s.id);
                  }
                } else if (!routingProven) {
                  busy.add(s.id);
                  unverified.add(s.id);
                }
              }
            }
          } catch (err) {
            if (parentSignal?.aborted) throw err;
            // Directory status failed, timed out, or inaccessible: protect explicitly, fail closed
            for (const s of sessions) {
              if (isSameDirectory(s.directory, dir)) {
                busy.add(s.id);
                unverified.add(s.id);
              }
            }
          } finally {
            dirTimeoutCtrl.dispose();
          }
        });
      }

      // Foreign directory sessions not in active directory and not in candidate directories:
      // Fail closed, never assume idle, protect unknown activity
      for (const s of sessions) {
        const isInActiveDir = Boolean(effectiveActiveDir && isSameDirectory(s.directory, effectiveActiveDir));
        const sCanon = canonicalizeDirectory(s.directory);
        const isInCandidateDir = Boolean(sCanon && candidateDirsSet.has(sCanon));
        if (!isInActiveDir && !isInCandidateDir) {
          busy.add(s.id);
          unverified.add(s.id);
        }
      }
    } catch (e) {
      if (timeoutCtrl.didTimeout()) {
        throw new Error("Tiempo de espera agotado al verificar el estado de actividad.");
      }
      if (parentSignal?.aborted) {
        throw new Error("Operación cancelada.");
      }
      // Failed liveness for the active project must fail closed.
      throw e;
    } finally {
      timeoutCtrl.dispose();
    }

    return { sessions, busy, active, unverified };
  }

  async exportSession(session: Session, options?: GatewayOptions): Promise<ExportData> {
    const timeoutMs = options?.timeoutMs ?? 30000;
    const parentSignal = options?.signal;
    const timeoutCtrl = createTimeoutController(timeoutMs, parentSignal);

    try {
      const parameters = { sessionID: session.id, directory: session.directory };
      const info = (await this.client.session.get(parameters, { throwOnError: true, signal: timeoutCtrl.signal })).data;
      if (!info) throw new Error("Sesión no disponible para respaldo.");
      const messages: ExportData["messages"] = [];
      const cursors = new Set<string>();
      const ids = new Set<string>();
      let before: string | undefined;
      for (let page = 0; page < 10000; page++) {
        const r = await this.client.session.messages({ ...parameters, limit: 200, before }, { throwOnError: true, signal: timeoutCtrl.signal });
        if (!Array.isArray(r.data)) throw new Error("Respuesta de mensajes inválida.");
        for (const msg of r.data) {
          if (ids.has(msg.info.id) || !Array.isArray(msg.parts)) throw new Error("Respaldo incompleto o mensajes duplicados.");
          ids.add(msg.info.id); messages.push(msg);
        }
        const next = r.response.headers.get("x-next-cursor");
        if (!next) {
          messages.sort((a, b) => Number((a.info.time as { created?: number })?.created ?? 0) - Number((b.info.time as { created?: number })?.created ?? 0) || a.info.id.localeCompare(b.info.id));
          return { info: info as Session, messages };
        }
        if (cursors.has(next) || !r.data.length) throw new Error("Paginación de mensajes inconsistente.");
        cursors.add(next); before = next;
      }
      throw new Error("Respaldo demasiado grande; se conserva la sesión.");
    } catch (e) {
      if (timeoutCtrl.didTimeout()) {
        throw new Error("Tiempo de espera agotado al respaldar la sesión.");
      }
      if (parentSignal?.aborted) {
        throw new Error("Operación cancelada.");
      }
      throw e;
    } finally {
      timeoutCtrl.dispose();
    }
  }

  async remove(session: Session, options?: GatewayOptions): Promise<void> {
    if (options?.signal?.aborted) {
      throw new Error("Operación cancelada.");
    }
    const r = await this.client.session.delete(
      { sessionID: session.id, directory: session.directory },
      { throwOnError: true, signal: options?.signal }
    );
    if (r.data !== true) throw new Error("OpenCode no confirmó la eliminación.");
    // Host removal can swallow internal errors. Verify the postcondition.
    // Avoid unsafe deletion timeout retries: never automatically re-issue delete if postcondition or network throws.
    if ((await this.list(options)).some(s => s.id === session.id)) {
      throw new Error("OpenCode conserva la sesión tras solicitar el borrado. Revisa el registro.");
    }
  }

  /**
   * Safe read-only diagnostic that tests whether the server can authoritatively prove
   * routing for the given directory. Produces no side effects and exposes no secrets.
   */
  async diagnoseDirectoryRouting(
    dir: string,
    options?: GatewayOptions
  ): Promise<{
    directory: string;
    canonicalDirectory: string;
    existsOnDisk: boolean;
    proven: boolean;
    reason?: string;
  }> {
    const canonicalDir = canonicalizeDirectory(dir);
    let existsOnDisk = false;
    try {
      const stat = await fs.stat(dir);
      existsOnDisk = stat.isDirectory();
    } catch {
      existsOnDisk = false;
    }

    if (!existsOnDisk) {
      return {
        directory: dir,
        canonicalDirectory: canonicalDir,
        existsOnDisk: false,
        proven: false,
        reason: "directory_not_found_on_disk",
      };
    }

    const timeoutMs = options?.timeoutMs ?? 5000;
    const timeoutCtrl = createTimeoutController(timeoutMs, options?.signal);
    try {
      let statusClient = this.client;
      const transport = this.client as unknown as {
        client?: {
          getConfig?: () => {
            baseUrl?: string;
            fetch?: typeof fetch;
            headers?: HeadersInit;
          };
        };
      };
      const clientConfig = transport.client?.getConfig?.();
      if (clientConfig) {
        try {
          const detachedHeaders = new Headers(clientConfig.headers as HeadersInit);
          detachedHeaders.delete("x-opencode-workspace");
          detachedHeaders.delete("x-opencode-directory");
          statusClient = createOpencodeClient({
            baseUrl: clientConfig.baseUrl,
            fetch: clientConfig.fetch,
            headers: Object.fromEntries(detachedHeaders.entries()),
            directory: dir,
          });
        } catch {}
      }

      const proof = await verifyServerDirectoryRouting(statusClient, dir, timeoutCtrl.signal);
      return {
        directory: dir,
        canonicalDirectory: canonicalDir,
        existsOnDisk: true,
        proven: proof.proven,
        reason: proof.reason,
      };
    } catch (err: any) {
      return {
        directory: dir,
        canonicalDirectory: canonicalDir,
        existsOnDisk: true,
        proven: false,
        reason: err?.message || String(err),
      };
    } finally {
      timeoutCtrl.dispose();
    }
  }
}
