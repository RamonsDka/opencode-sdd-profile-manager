import * as fsSync from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Returns default canonical database path based on platform and environment.
 */
export function defaultDatabasePath(): string {
  if (process.env.OPENCODE_DB_PATH) return path.resolve(process.env.OPENCODE_DB_PATH);
  if (process.env.XDG_DATA_HOME) {
    const xdgPath = path.join(process.env.XDG_DATA_HOME, "opencode", "opencode.db");
    if (fsSync.existsSync(xdgPath)) return path.resolve(xdgPath);
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const p1 = path.join(localAppData, "opencode", "opencode.db");
      if (fsSync.existsSync(p1)) return path.resolve(p1);
    }
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      const p2 = path.join(userProfile, ".local", "share", "opencode", "opencode.db");
      if (fsSync.existsSync(p2)) return path.resolve(p2);
    }
  }
  return path.resolve(path.join(os.homedir(), ".local", "share", "opencode", "opencode.db"));
}
