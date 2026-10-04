import type { OpenCodeClient, SessionInfo, SessionTransferData } from "@opencode/client";
import type { Gateway, GatewayOptions, ExportData } from "./api.ts";
import { createTimeoutController, raceWithSignal } from "./api.ts";
import type { Session, Snapshot } from "./model.ts";
import { validateSessions } from "./policy.ts";
export const V2_DELETION_BLOCKED = "V2 deletion is unavailable: no atomic idle/family exclusion guarantee exists in the installed API.";
export function projectV2Session(info: SessionInfo): Session {
  return { ...info, title: info.title ?? info.id, directory: info.location.directory };
}
export class V2Gateway implements Gateway {
  readonly client: OpenCodeClient;
  constructor(client: OpenCodeClient) { this.client = client; }
  private async request<T>(options: GatewayOptions | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const ctrl = createTimeoutController(options?.timeoutMs ?? 15000, options?.signal);
    try {
      if (ctrl.signal.aborted) throw new Error("Operation cancelled.");
      return await raceWithSignal(action(ctrl.signal), ctrl.signal);
    } finally { ctrl.dispose(); }
  }
  async list(options?: GatewayOptions): Promise<Session[]> {
    return this.request(options, async signal => {
      const sessions: Session[] = [], seen = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 512; page++) {
        const result = await this.client.session.list({ limit: 256, ...(cursor ? { cursor } : {}) }, { signal });
        if (!Array.isArray(result.data) || !result.cursor) throw new Error("Invalid V2 session inventory.");
        sessions.push(...result.data.map(projectV2Session));
        validateSessions(sessions);
        const next = result.cursor.next;
        if (!next) return sessions;
        if (!result.data.length || seen.has(next)) throw new Error("Inconsistent V2 inventory cursor.");
        seen.add(next); cursor = next;
      }
      throw new Error("V2 inventory exceeds the verification limit.");
    });
  }
  async snapshot(active: Set<string>, _directory?: string, _project?: string, options?: GatewayOptions): Promise<Snapshot> {
    const sessions = await this.list(options);
    const busy = new Set<string>();
    if (options?.liveness !== false) {
      const running = await this.request(options, signal => this.client.session.active({ signal }));
      if (!running || typeof running !== "object" || Array.isArray(running)) throw new Error("Invalid V2 activity inventory.");
      for (const [id, status] of Object.entries(running)) {
        if (status.type !== "running") throw new Error("Unknown V2 activity status.");
        busy.add(id);
      }
    }
    // Observed idle is not an atomic exclusion against concurrent execution or descendants.
    return { sessions, busy, active, unverified: new Set(sessions.map(s => s.id)) };
  }
  async exportSession(session: Session, options?: GatewayOptions): Promise<ExportData & { native: SessionTransferData }> {
    return this.request(options, async signal => {
      const native = await this.client.session.export({ sessionID: session.id, sanitize: false }, { signal });
      const info = projectV2Session(native.info);
      validateSessions([info]);
      if (info.id !== session.id || !Array.isArray(native.messages)) throw new Error("Invalid V2 session export.");
      return { info, native, messages: native.messages.map(message => ({ info: { ...message }, parts: "content" in message ? message.content : [] })) };
    });
  }
  async remove(_session: Session, _options?: GatewayOptions): Promise<void> { throw new Error(V2_DELETION_BLOCKED); }
}
export function disabledV2Helper(): any {
  return new Proxy({}, { get: () => () => { throw new Error("V2 offline maintenance is unavailable: legacy SQLite schema is not supported."); } });
}
