// Isolated harness helpers: pure, testable isolation primitives.
// No OpenCode spawn, no database access, no production reads.
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";

export const APPROVED_TEMP_DIR: string =
  process.platform === "win32"
    ? "C:\\Users\\DELL\\AppData\\Local\\Temp\\opencode"
    : path.join(os.tmpdir(), "opencode");

export const OWNED_PREFIX = "vault-isolated-";
export const LEGACY_FIXED_PORT = 14987;

export interface IsolatedRoots {
  root: string;
  config: string;
  data: string;
  state: string;
  cache: string;
  vaultHome: string;
  project: string;
}

function isOpenCodeKey(key: string): boolean {
  const upper = key.toUpperCase();
  return upper === "OPENCODE" || upper.startsWith("OPENCODE_");
}

function isSensitiveInheritedKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (isOpenCodeKey(key)) return true;
  if (upper.includes("API_KEY") || upper.includes("APIKEY")) return true;
  if (upper.includes("PRIVATE_KEY")) return true;
  if (upper.includes("SECRET") || upper.includes("PASSWORD")) return true;
  if (upper === "TOKEN" || upper.endsWith("_TOKEN") || upper.includes("_TOKEN_")) return true;
  return false;
}

function isXdgKey(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    upper === "XDG_CONFIG_HOME" ||
    upper === "XDG_DATA_HOME" ||
    upper === "XDG_STATE_HOME" ||
    upper === "XDG_CACHE_HOME"
  );
}

export function scrubIsolatedEnv(
  inputEnv: NodeJS.ProcessEnv,
  tmp: IsolatedRoots,
): { env: NodeJS.ProcessEnv; scrubbed: string[] } {
  const env: NodeJS.ProcessEnv = { ...inputEnv };
  const scrubbed: string[] = [];
  for (const key of Object.keys(env)) {
    if (isOpenCodeKey(key) || isSensitiveInheritedKey(key)) {
      if (!scrubbed.includes(key)) scrubbed.push(key);
      delete env[key];
      continue;
    }
    if (isXdgKey(key)) {
      const value = env[key];
      if (value !== undefined && !String(value).startsWith(tmp.root)) {
        if (!scrubbed.includes(key)) scrubbed.push(key);
      }
      delete env[key];
    }
  }
  for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const) {
    const value = inputEnv[key];
    if (value !== undefined && !String(value).startsWith(tmp.root)) {
      if (!scrubbed.includes(key)) scrubbed.push(key);
    }
  }
  env.XDG_CONFIG_HOME = tmp.config;
  env.XDG_DATA_HOME = tmp.data;
  env.XDG_STATE_HOME = tmp.state;
  env.XDG_CACHE_HOME = tmp.cache;
  env.OPENCODE_SESSION_VAULT_HOME = tmp.vaultHome;
  env.OPENCODE_DISABLE_AUTOUPDATE = "true";
  env.OPENCODE_DISABLE_MODELS_FETCH = "true";
  env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "true";
  env.OPENCODE_DISABLE_PROJECT_PLUGINS = "true";
  return { env, scrubbed };
}

export function assertPathInside(child: string, parent: string, label = "path"): true {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  const rel = path.relative(resolvedParent, resolvedChild);
  if (rel === "") return true;
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`${label} is outside owned temp: ${resolvedChild} not inside ${resolvedParent}`);
  }
  return true;
}

export function assertDbPathIsTemp(dbPath: string, dataHome: string, tmpRoot: string): true {
  assertPathInside(dataHome, tmpRoot, "data home");
  assertPathInside(tmpRoot, APPROVED_TEMP_DIR, "tmp root");
  assertPathInside(dbPath, dataHome, "database");
  return true;
}

export function assertOwnedPid(child: { pid?: number } | undefined, pid: number): true {
  if (!child || typeof child.pid !== "number") {
    throw new Error("refuses cleanup: missing owned process handle");
  }
  if (pid !== child.pid) {
    throw new Error(`refuses unowned cleanup: pid ${String(pid)} is not owned pid ${String(child.pid)}`);
  }
  return true;
}

export function buildServeArgv(port: number): string[] {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`dynamic loopback port required, got ${String(port)}`);
  }
  if (port === LEGACY_FIXED_PORT) {
    throw new Error(`fixed legacy port ${String(port)} rejected: use a dynamic loopback port`);
  }
  return ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--pure"];
}

export function defaultSpawnOptions(cwd: string, env: NodeJS.ProcessEnv): {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: false;
  stdio: ["ignore", "pipe", "pipe"];
} {
  return { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] };
}

export function getFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function createIsolatedRoots(): Promise<IsolatedRoots> {
  const base = APPROVED_TEMP_DIR;
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, `${OWNED_PREFIX}`));
  const paths: IsolatedRoots = {
    root,
    config: path.join(root, "config"),
    data: path.join(root, "data"),
    state: path.join(root, "state"),
    cache: path.join(root, "cache"),
    vaultHome: path.join(root, "vault"),
    project: path.join(root, "project"),
  };
  await mkdir(paths.project, { recursive: true });
  assertPathInside(paths.root, base, "tmp root");
  return paths;
}

export function canonicalizeForCompare(p: string): string {
  const resolved = path.resolve(String(p).trim());
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function parseDbPathOutput(stdout: string): string {
  const line = String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] ?? "";
  if (!line) throw new Error("empty db path output from runtime");
  return line;
}

export function parseVersionOutput(stdout: string): string {
  const text = String(stdout).trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] ?? "";
  const m = text.match(/(\d+\.\d+\.\d+[^\s]*)/);
  if (!m) throw new Error(`unparseable version output: ${text.slice(0, 200)}`);
  return m[1];
}

export function assertObservedDbMatchesExpected(
  observedRaw: string,
  expectedDb: string,
  dataHome: string,
  tmpRoot: string,
): string {
  const observed = parseDbPathOutput(observedRaw);
  assertPathInside(dataHome, tmpRoot, "data home");
  assertPathInside(tmpRoot, APPROVED_TEMP_DIR, "tmp root");
  assertPathInside(observed, dataHome, "observed database");
  assertPathInside(expectedDb, dataHome, "expected database");
  if (canonicalizeForCompare(observed) !== canonicalizeForCompare(expectedDb)) {
    throw new Error(`observed db path mismatch: ${observed} !== ${expectedDb}`);
  }
  const prodConfig = path.resolve(os.homedir(), ".config");
  if (
    canonicalizeForCompare(observed).startsWith(canonicalizeForCompare(prodConfig)) ||
    canonicalizeForCompare(observed).startsWith(canonicalizeForCompare(path.resolve(os.homedir(), ".local", "share")))
  ) {
    throw new Error(`observed db path is production location: ${observed}`);
  }
  return observed;
}

export function buildBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export interface ProvenanceFetchResult {
  status: number;
  ok: boolean;
  text: () => Promise<string>;
}

export interface ProvenanceCheck {
  url: string;
  username: string;
  password: string;
  expectedPort: number;
  getLog: () => string;
  isAlive: () => boolean;
  fetchImpl: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<ProvenanceFetchResult>;
}

export async function verifyServerProvenance(check: ProvenanceCheck): Promise<{ healthVersion: string }> {
  if (!check.isAlive()) {
    throw new Error("owned server not alive before mutation: refuses synthetic sessions");
  }
  const log = check.getLog();
  const marker = `http://127.0.0.1:${String(check.expectedPort)}`;
  if (!log.includes(marker) || !log.toLowerCase().includes("listening")) {
    throw new Error(`missing owned bind proof in startup log for ${marker}: stale responder must fail`);
  }
  const healthUrl = `${check.url}/global/health`;
  let unauth: ProvenanceFetchResult;
  try {
    unauth = await check.fetchImpl(healthUrl);
  } catch (err) {
    throw new Error(`owned health unreachable before mutation: ${String(err).slice(0, 300)}`);
  }
  if (unauth.status !== 401 && unauth.ok) {
    throw new Error(`stale unsecured responder accepted unauthenticated health (${String(unauth.status)}): refuses mutation`);
  }
  if (unauth.status !== 401) {
    throw new Error(`expected 401 without credentials, got ${String(unauth.status)}: refuses mutation`);
  }
  const wrongHeader = buildBasicAuthHeader(check.username, `${check.password}-wrong`);
  const wrong = await check.fetchImpl(healthUrl, { headers: { Authorization: wrongHeader } });
  if (wrong.status !== 401) {
    throw new Error(`expected 401 with incorrect credentials, got ${String(wrong.status)}: refuses mutation`);
  }
  const goodHeader = buildBasicAuthHeader(check.username, check.password);
  const good = await check.fetchImpl(healthUrl, { headers: { Authorization: goodHeader } });
  if (!good.ok || good.status !== 200) {
    throw new Error(`valid credentials rejected (${String(good.status)}): refuses mutation`);
  }
  const body = await good.text();
  let healthVersion = "unknown";
  try {
    const parsed = JSON.parse(body) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) healthVersion = parsed.version;
  } catch {
    const m = body.match(/(\d+\.\d+\.\d+[^\s"]*)/);
    if (m) healthVersion = m[1];
  }
  if (!check.isAlive()) {
    throw new Error("owned server died during provenance check: refuses mutation");
  }
  return { healthVersion };
}

export function assertBeforeMutation(facts: {
  dbObserved: string;
  dbExpected: string;
  serverProven: boolean;
  versionObserved: string;
  tmpProven: boolean;
}): true {
  if (!facts.tmpProven) throw new Error("tmp ownership not proven before mutation");
  if (!facts.dbObserved || !facts.dbExpected) throw new Error("database path not proven before mutation");
  if (canonicalizeForCompare(facts.dbObserved) !== canonicalizeForCompare(facts.dbExpected)) {
    throw new Error("observed database differs from expected owned location before mutation");
  }
  if (!facts.serverProven) throw new Error("server provenance not proven before mutation");
  if (!facts.versionObserved) throw new Error("runtime version not measured before mutation");
  return true;
}
