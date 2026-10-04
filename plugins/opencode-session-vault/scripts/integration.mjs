// Hardened isolated harness (unit 1 correction): proves temp ownership, scrubs
// config with Windows casefold, assigns a per-run server credential AFTER scrub
// (in memory only, never logged), proves the OBSERVED runtime database path via
// `opencode db path` under the SAME scrubbed env/cwd BEFORE any mutation,
// proves owned-server provenance via authenticated triple + startup log +
// liveness (stale responders fail), creates synthetic sessions only through a
// before-mutation guard, and cleans only the owned process. No direct SQL,
// no timestamp writes, no fixture deletion, no production I/O.
import { spawn, execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import {
  APPROVED_TEMP_DIR,
  buildServeArgv,
  scrubIsolatedEnv,
  assertPathInside,
  assertOwnedPid,
  getFreeLoopbackPort,
  defaultSpawnOptions,
  LEGACY_FIXED_PORT,
  parseDbPathOutput,
  parseVersionOutput,
  assertObservedDbMatchesExpected,
  buildBasicAuthHeader,
  verifyServerProvenance,
  assertBeforeMutation,
} from "./isolation.ts";

const execFileAsync = promisify(execFile);

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");

function resolveBinary() {
  const candidates = [
    process.env.OPENCODE_TEST_BINARY,
    "C:\\Users\\DELL\\AppData\\Roaming\\npm\\opencode.exe",
    "C:\\Users\\DELL\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe",
  ].filter(Boolean);
  return candidates[0];
}

async function stopOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return "already-exited";
  assertOwnedPid(child, child.pid);
  const ownedPid = child.pid;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const timeout = setTimeout(() => {
    try {
      assertOwnedPid(child, ownedPid);
      child.kill("SIGKILL");
    } catch {}
  }, 3000);
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error("owned shutdown deadline exceeded")), 8000)),
  ]).finally(() => clearTimeout(timeout));
  return "stopped-owned";
}

function runBounded(argv, options, timeoutMs) {
  return execFileAsync(argv[0], argv.slice(1), { ...options, timeout: timeoutMs });
}

function makeAuthFetch(authHeader) {
  return (input, init) => {
    if (typeof input === "string") {
      const headers = { ...(init?.headers ?? {}), Authorization: authHeader };
      return fetch(input, { ...init, headers, signal: init?.signal ?? AbortSignal.timeout(15000) });
    }
    const merged = new Headers(input.headers ?? {});
    merged.set("Authorization", authHeader);
    const withAuth = new Request(input, { headers: merged });
    return fetch(withAuth, { signal: AbortSignal.timeout(15000) });
  };
}

const binary = resolveBinary();
if (!binary) throw new Error("Define OPENCODE_TEST_BINARY with the absolute OpenCode executable path.");
await stat(binary).catch(() => { throw new Error(`OpenCode test binary missing: ${binary}`); });

// Owned disposable temp under the approved root; never os.tmpdir() siblings.
await mkdir(APPROVED_TEMP_DIR, { recursive: true });
const tmpRoot = await mkdtemp(path.join(APPROVED_TEMP_DIR, "vault-isolated-"));
assertPathInside(tmpRoot, APPROVED_TEMP_DIR, "tmp root");
const roots = {
  root: tmpRoot,
  config: path.join(tmpRoot, "config"),
  data: path.join(tmpRoot, "data"),
  state: path.join(tmpRoot, "state"),
  cache: path.join(tmpRoot, "cache"),
  vaultHome: path.join(tmpRoot, "vault"),
  project: path.join(tmpRoot, "project"),
};
await mkdir(roots.project, { recursive: true });

const { env, scrubbed } = scrubIsolatedEnv(process.env, roots);
for (const p of [env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_STATE_HOME, env.XDG_CACHE_HOME, env.OPENCODE_SESSION_VAULT_HOME]) {
  assertPathInside(String(p), tmpRoot, "isolated home");
}

// Per-run server credential AFTER scrub; in memory only, never logged/stored.
// Official contract: `opencode attach` documents OPENCODE_SERVER_PASSWORD and
// OPENCODE_SERVER_USERNAME (default 'opencode') for Basic auth; `serve`
// enforces it (live-probed: 401 without/wrong, 200 with correct).
const runUsername = "opencode";
const runPassword = randomBytes(24).toString("hex");
env.OPENCODE_SERVER_USERNAME = runUsername;
env.OPENCODE_SERVER_PASSWORD = runPassword;
const authHeader = buildBasicAuthHeader(runUsername, runPassword);

// OBSERVED runtime database-path proof BEFORE any mutation, under the SAME
// scrubbed env/cwd, argv-only exec with bounds. Rejects tautological expected-only checks.
const expectedDb = path.join(roots.data, "opencode", "opencode.db");
const dbProc = await runBounded([binary, "db", "path", "--pure"], { cwd: roots.project, env, shell: false }, 15000);
const dbObservedRaw = String(dbProc.stdout ?? "");
parseDbPathOutput(dbObservedRaw);
const dbObserved = assertObservedDbMatchesExpected(dbObservedRaw, expectedDb, roots.data, tmpRoot);
assert.ok(!String(dbObserved).startsWith(path.resolve(os.homedir(), ".config")), "db must not be production");

// Measured runtime version, never a literal.
const verProc = await runBounded([binary, "--version"], { cwd: roots.project, env, shell: false }, 15000);
const versionObserved = parseVersionOutput(String(verProc.stdout ?? "") + String(verProc.stderr ?? ""));

let server;
let port = 0;
let attempts = 0;
let report = {};
let provenance = { unauthRejected: false, wrongRejected: false, validAccepted: false, healthVersion: "unknown" };
let serverLogObserved = false;
let tmpCleanup = { removed: false, retainedPath: null, error: null };
try {
  // Dynamic loopback port with stale-listener retry (max 3 attempts).
  // Each attempt requires owned bind log + liveness + auth triple; a stale
  // unsecured responder (200 without auth) fails before any mutation.
  let lastError = "";
  for (attempts = 1; attempts <= 3; attempts++) {
    port = await getFreeLoopbackPort();
    assert.ok(port !== LEGACY_FIXED_PORT, "dynamic port required");
    const argv = buildServeArgv(port);
    const url = `http://127.0.0.1:${port}`;
    server = spawn(binary, argv, defaultSpawnOptions(roots.project, env));
    assertOwnedPid(server, server.pid);
    let log = "";
    server.stdout?.on("data", (d) => { log += String(d); });
    server.stderr?.on("data", (d) => { log += String(d); });
    const getLog = () => log;
    const isAlive = () => server && server.exitCode === null && server.signalCode === null;
    const start = Date.now();
    let proven = false;
    let attemptError = "";
    while (Date.now() - start < 15000) {
      if (!isAlive()) {
        attemptError = `owned process exited early: ${getLog().slice(-2000)}`;
        break;
      }
      if (getLog().includes("EADDRINUSE")) {
        attemptError = `stale listener on ${String(port)}`;
        break;
      }
      try {
        const out = await verifyServerProvenance({
          url, username: runUsername, password: runPassword, expectedPort: port,
          getLog, isAlive,
          fetchImpl: async (fetchUrl, init) => {
            const res = await fetch(fetchUrl, { ...init, signal: AbortSignal.timeout(2000) });
            return { status: res.status, ok: res.ok, text: () => res.text() };
          },
        });
        provenance = { unauthRejected: true, wrongRejected: true, validAccepted: true, healthVersion: out.healthVersion };
        serverLogObserved = true;
        proven = true;
        break;
      } catch (err) {
        const msg = String(err?.message ?? err);
        if (/stale unsecured/i.test(msg)) {
          attemptError = msg.slice(0, 500);
          break;
        }
        await new Promise((r) => setTimeout(r, 300));
        attemptError = msg.slice(0, 500);
      }
    }
    if (proven) { lastError = ""; break; }
    lastError = attemptError || `not ready on ${String(port)}: ${getLog().slice(-2000)}`;
    try { await stopOwned(server); } catch (err) { lastError += `; stop failed: ${String(err?.message ?? err).slice(0, 200)}`; }
    server = undefined;
    if (attempts === 3) throw new Error(`isolated server provenance never satisfied: ${lastError}`);
  }

  const url = `http://127.0.0.1:${port}`;
  const authFetch = makeAuthFetch(authHeader);
  const client = createOpencodeClient({
    baseUrl: url,
    directory: roots.project,
    fetch: (request) => authFetch(request),
  });

  // Before-mutation guard: all safety facts must hold, otherwise no sessions.
  assertBeforeMutation({
    dbObserved, dbExpected: expectedDb, serverProven: provenance.validAccepted,
    versionObserved, tmpProven: true,
  });

  // Synthetic sessions only; no backdating, no deletion, no SQL.
  const created = [];
  for (let i = 0; i < 2; i++) {
    const res = await client.session.create(
      { directory: roots.project, title: `TEST synthetic isolated ${i}` },
      { throwOnError: true },
    );
    created.push(res.data);
  }
  assert.equal(created.length, 2);
  const listed = await client.session.list({ directory: roots.project }, { throwOnError: true });
  const ids = new Set(created.map((s) => s.id));
  const found = listed.data.filter((s) => ids.has(s.id));
  assert.equal(found.length, 2, "isolated inventory must contain only the owned synthetic sessions");
  for (const s of found) {
    assert.equal(s.directory, roots.project, "synthetic session must stay in the owned project");
  }

  report = {
    harnessIntended: { syntheticSessions: 2, deletions: 0, sqlWrites: 0, globalCleanup: "not-attempted" },
    harnessMeasured: {
      syntheticSessions: created.length,
      isolatedInventory: found.length,
      sqlWrites: 0,
      fixtureDeletion: 0,
    },
    platform: process.platform,
    binary,
    versionObserved,
    versionHealth: provenance.healthVersion,
    dynamicPort: port,
    fixedPortRejected: LEGACY_FIXED_PORT,
    portAttempts: attempts,
    scrubbedKeys: scrubbed.length,
    tmpRootProven: true,
    dbPathExpected: expectedDb,
    dbPathObserved: dbObserved,
    dbPathProvenTemp: dbObserved,
    authProven: { unauthRejected: provenance.unauthRejected, wrongRejected: provenance.wrongRejected, validAccepted: provenance.validAccepted },
    serverLogObserved,
    ownedPid: server?.pid ?? null,
    globalCleanupClaim: "unproven",
    ownedCleanup: "pending-stop",
    testedAt: new Date().toISOString(),
  };
  await stopOwned(server);
  server = undefined;
  report.ownedCleanup = "stopped-owned";
  await mkdir(path.join(pluginRoot, "assets"), { recursive: true });
  await writeFile(path.join(pluginRoot, "assets", "integration-result.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  if (server) {
    try { await stopOwned(server); } catch (err) {
      console.error(`owned stop failed: ${String(err?.message ?? err).slice(0, 500)}`);
    }
  }
  try {
    await rm(tmpRoot, { recursive: true, force: true });
    tmpCleanup = { removed: true, retainedPath: null, error: null };
  } catch (err) {
    const message = String(err?.message ?? err).slice(0, 500);
    tmpCleanup = { removed: false, retainedPath: tmpRoot, error: message };
    console.error(`sandbox cleanup failed, retained ${tmpRoot}: ${message}`);
    if (report && typeof report === "object") {
      report.tmpCleanup = tmpCleanup;
      try {
        await mkdir(path.join(pluginRoot, "assets"), { recursive: true });
        await writeFile(path.join(pluginRoot, "assets", "integration-result.json"), JSON.stringify(report, null, 2) + "\n");
      } catch {}
    }
    throw err;
  }
  if (report && typeof report === "object" && !report.tmpCleanup) {
    report.tmpCleanup = tmpCleanup.removed ? { removed: true } : tmpCleanup;
  }
}
