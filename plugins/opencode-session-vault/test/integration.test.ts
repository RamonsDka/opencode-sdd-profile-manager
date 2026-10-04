import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import {
  APPROVED_TEMP_DIR,
  buildServeArgv,
  scrubIsolatedEnv,
  assertPathInside,
  assertDbPathIsTemp,
  assertOwnedPid,
  getFreeLoopbackPort,
  defaultSpawnOptions,
} from "../scripts/isolation.ts";
import * as isolationNs from "../scripts/isolation.ts";

function fakeTmp() {
  const root = path.join(APPROVED_TEMP_DIR, "vault-isolated-fake");
  return {
    root,
    config: path.join(root, "config"),
    data: path.join(root, "data"),
    state: path.join(root, "state"),
    cache: path.join(root, "cache"),
    vaultHome: path.join(root, "vault"),
    project: path.join(root, "project"),
  };
}

test("inherited config is scrubbed and replaced with owned temp homes", () => {
  const tmp = fakeTmp();
  const input = {
    ...process.env,
    OPENCODE_CONFIG: "/prod/config.json",
    OPENCODE_CONFIG_CONTENT: '{"injected":true}',
    OPENCODE_CONFIG_DIR: "/prod/config-dir",
    OPENCODE_CONFIG_ROOT: "C:/Users/DELL/.config/opencode",
    OPENCODE_SERVER_PASSWORD: "secret",
    OPENCODE_SERVER_USERNAME: "admin",
    OPENCODE: "1",
    OPENCODE_EXPERIMENTAL: "true",
    OPENCODE_PID: "31708",
    OPENCODE_WORKSPACE_ROOT: "C:/Users/DELL/projects/0.-MEJORA-OPENCODE-TRABAJANDO",
    OPENCODE_SESSION_VAULT_HOME: "/prod/vault",
    XDG_DATA_HOME: "/prod/data",
    MY_CUSTOM_KEEP: "keep-me",
  };
  const { env, scrubbed } = scrubIsolatedEnv(input, tmp);
  for (const key of [
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_CONFIG_ROOT",
    "OPENCODE_SERVER_PASSWORD",
    "OPENCODE_SERVER_USERNAME",
  ]) {
    assert.equal(env[key], undefined, `${key} must be scrubbed`);
  }
  assert.ok(scrubbed.includes("OPENCODE_SESSION_VAULT_HOME"), "production VaultHome must be reported scrubbed");
  assert.ok(scrubbed.length >= 7, "scrubbed keys must be reported");
  assert.equal(env.XDG_CONFIG_HOME, tmp.config);
  assert.equal(env.XDG_DATA_HOME, tmp.data);
  assert.equal(env.XDG_STATE_HOME, tmp.state);
  assert.equal(env.XDG_CACHE_HOME, tmp.cache);
  assert.equal(env.OPENCODE_SESSION_VAULT_HOME, tmp.vaultHome);
  assert.equal(env.OPENCODE_DISABLE_DEFAULT_PLUGINS, "true");
  assert.equal(env.MY_CUSTOM_KEEP, "keep-me");
  assertPathInside(env.XDG_DATA_HOME, tmp.root, "XDG_DATA_HOME");
  assertPathInside(env.OPENCODE_SESSION_VAULT_HOME, tmp.root, "VaultHome");
});

test("external database path is rejected, owned temp path is accepted", () => {
  const tmp = fakeTmp();
  const ownedDb = path.join(tmp.data, "opencode", "opencode.db");
  assertDbPathIsTemp(ownedDb, tmp.data, tmp.root);
  const prodCandidates = [
    path.join(os.homedir(), ".local", "share", "opencode", "opencode.db"),
    "C:/Users/DELL/.config/opencode/opencode.db",
  ];
  for (const prod of prodCandidates) {
    // Skip candidates that accidentally fall inside the fake tmp root.
    if (path.relative(tmp.root, prod) !== "" && !path.relative(tmp.root, prod).startsWith("..")) continue;
    assert.throws(() => assertDbPathIsTemp(prod, tmp.data, tmp.root), /external|owned|temp/i);
  }
  assert.throws(() => assertPathInside("/prod/outside.db", tmp.root, "db"), /outside|owned/i);
});

test("stale listener is handled via dynamic loopback port", async () => {
  const port = await getFreeLoopbackPort();
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, `dynamic port in range, got ${port}`);
  assert.notEqual(port, 14987, "must not reuse legacy fixed port");
  // Occupy one port, then a fresh pick must still yield a connectable free port.
  const occupied: net.Server = net.createServer();
  await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", () => resolve()));
  const addr: string | net.AddressInfo | null = occupied.address();
  const occupiedPort: number = typeof addr === "object" && addr !== null ? addr.port : 0;
  const fresh = await getFreeLoopbackPort();
  assert.ok(fresh >= 1024 && fresh <= 65535, `fresh port in range, got ${fresh}`);
  assert.notEqual(fresh, 14987, "retry must not fall back to fixed port");
  await new Promise((resolve) => occupied.close(resolve));
  void occupiedPort;
  const argv = buildServeArgv(port);
  assert.ok(argv.includes("--pure"), "serve argv must include --pure");
  assert.ok(argv.includes("127.0.0.1"), "serve argv must bind loopback only");
});

test("cleanup refuses unowned processes", () => {
  const owned = { pid: 424242 };
  assert.equal(assertOwnedPid(owned, 424242), true);
  assert.throws(() => assertOwnedPid(owned, 1), /unowned|refuse/i);
  assert.throws(() => assertOwnedPid(owned, process.pid === 424242 ? 424243 : process.pid), /unowned|refuse/i);
  assert.throws(() => assertOwnedPid(undefined, 1234), /unowned|owned|missing/i);
});

test("spawn uses argv-only boundary with pure loopback server", () => {
  const argv = buildServeArgv(51234);
  assert.ok(Array.isArray(argv), "argv must be an array, never a shell string");
  assert.equal(argv[0], "serve");
  assert.ok(argv.includes("--hostname"));
  assert.ok(argv.includes("--port"));
  assert.ok(argv.includes("--pure"));
  const joined = argv.join(" ");
  assert.ok(!joined.includes(";") && !joined.includes("&&") && !joined.includes("|"), "argv must not contain shell metachars");
  const opts = defaultSpawnOptions("/tmp/proj", { FOO: "bar" });
  assert.equal(opts.shell, false, "spawn must never use a shell");
  assert.equal(opts.cwd, "/tmp/proj");
  assert.throws(() => buildServeArgv(14987), /fixed|dynamic/i, "legacy fixed port must be rejected");
});

test("windows case variants of OPENCODE keys are scrubbed (casefold)", () => {
  const tmp = fakeTmp();
  const input = {
    ...process.env,
    opencode_server_password: "secret-lower",
    Opencode_Config: "/prod/config",
    OPENcode_CONFIG_CONTENT: '{"x":1}',
    OpEnCoDe_Experimental: "1",
    Xdg_Data_Home: "/prod/data-lower",
  };
  const { env } = scrubIsolatedEnv(input, tmp);
  assert.equal(env["opencode_server_password"], undefined, "lowercase password must be scrubbed");
  assert.equal(env["Opencode_Config"], undefined, "mixed-case config must be scrubbed");
  assert.equal(env["OPENcode_CONFIG_CONTENT"], undefined, "mixed-case content must be scrubbed");
  assert.equal(env["OpEnCoDe_Experimental"], undefined, "mixed-case experimental must be scrubbed");
  assert.equal(env["Xdg_Data_Home"], undefined, "lowercase XDG variant must not linger");
  assert.equal(env.XDG_DATA_HOME, tmp.data);
});

test("inherited secrets are scrubbed for sandbox, benign keys preserved", () => {
  const tmp = fakeTmp();
  const input = {
    ...process.env,
    ANTHROPIC_API_KEY: "sk-test",
    OPENAI_API_KEY: "sk-test",
    GITHUB_TOKEN: "gh-test",
    MY_APP_SECRET: "s3cr3t",
    MY_PASSWORD: "pw",
    MY_CUSTOM_KEEP: "keep-me",
  };
  const { env, scrubbed } = scrubIsolatedEnv(input, tmp);
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "MY_APP_SECRET", "MY_PASSWORD"]) {
    assert.equal(env[k], undefined, `${k} must not leak into sandbox`);
  }
  assert.equal(env.MY_CUSTOM_KEEP, "keep-me", "benign custom key preserved");
  assert.ok(scrubbed.length >= 5, "secret scrub must be reported");
});

test("observed db path must match expected owned location (injected exec results)", () => {
  const tmp = fakeTmp();
  const expected = path.join(tmp.data, "opencode", "opencode.db");
  const fn = (isolationNs as unknown as Record<string, unknown>)["assertObservedDbMatchesExpected"] as unknown as (
    observedRaw: string, expectedDb: string, dataHome: string, tmpRoot: string,
  ) => string;
  assert.equal(typeof fn, "function", "assertObservedDbMatchesExpected must exist");
  const observed = fn(`${expected}\r\n`, expected, tmp.data, tmp.root);
  assert.equal(path.resolve(observed), path.resolve(expected));
  const prod = path.join(os.homedir(), ".config", "opencode", "opencode.db");
  if (path.resolve(prod) !== path.resolve(expected)) {
    assert.throws(() => fn(`${prod}\n`, expected, tmp.data, tmp.root), /outside|owned|temp|mismatch/i);
  }
  const other = path.join(tmp.data, "opencode", "other.db");
  assert.throws(() => fn(`${other}\n`, expected, tmp.data, tmp.root), /mismatch/i);
});

test("server provenance rejects stale unsecured responder (fake listener)", async () => {
  const fn = (isolationNs as unknown as Record<string, unknown>)["verifyServerProvenance"] as unknown as (
    check: {
      url: string; username: string; password: string; expectedPort: number;
      getLog: () => string; isAlive: () => boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchImpl: (url: string, init?: any) => Promise<{ status: number; ok: boolean; text: () => Promise<string> }>;
    },
  ) => Promise<{ healthVersion: string }>;
  assert.equal(typeof fn, "function", "verifyServerProvenance must exist");
  const port = 51999;
  const staleFetch = async () => ({ status: 200, ok: true, text: async () => '{"healthy":true,"version":"9.9.9"}' });
  await assert.rejects(
    () => fn({
      url: `http://127.0.0.1:${port}`, username: "opencode", password: "per-run-secret",
      expectedPort: port, getLog: () => `opencode server listening on http://127.0.0.1:${port}\n`,
      isAlive: () => true, fetchImpl: staleFetch,
    }),
    /stale|unauth|401/i,
    "stale responder with 200 unauthenticated must fail before mutation",
  );
});

test("server provenance requires startup log and liveness, enforces auth triple", async () => {
  const fn = (isolationNs as unknown as Record<string, unknown>)["verifyServerProvenance"] as unknown as (
    check: {
      url: string; username: string; password: string; expectedPort: number;
      getLog: () => string; isAlive: () => boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchImpl: (url: string, init?: any) => Promise<{ status: number; ok: boolean; text: () => Promise<string> }>;
    },
  ) => Promise<{ healthVersion: string }>;
  assert.equal(typeof fn, "function", "verifyServerProvenance must exist");
  const port = 51998;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const goodFetch = async (_url: string, init?: any) => {
    const h = init?.headers?.["Authorization"] ?? init?.headers?.["authorization"] ?? "";
    const good = `Basic ${Buffer.from("opencode:per-run-secret", "utf8").toString("base64")}`;
    if (!h) return { status: 401, ok: false, text: async () => "" };
    if (h !== good) return { status: 401, ok: false, text: async () => "" };
    return { status: 200, ok: true, text: async () => '{"healthy":true,"version":"1.18.18"}' };
  };
  await assert.rejects(
    () => fn({
      url: `http://127.0.0.1:${port}`, username: "opencode", password: "per-run-secret",
      expectedPort: port, getLog: () => "booting...\n", isAlive: () => true, fetchImpl: goodFetch,
    }),
    /listening|log|provenance/i,
    "missing startup log must fail",
  );
  await assert.rejects(
    () => fn({
      url: `http://127.0.0.1:${port}`, username: "opencode", password: "per-run-secret",
      expectedPort: port, getLog: () => `opencode server listening on http://127.0.0.1:${port}\n`,
      isAlive: () => false, fetchImpl: goodFetch,
    }),
    /alive|owned|exit/i,
    "dead child must fail",
  );
  const out = await fn({
    url: `http://127.0.0.1:${port}`, username: "opencode", password: "per-run-secret",
    expectedPort: port, getLog: () => `opencode server listening on http://127.0.0.1:${port}\n`,
    isAlive: () => true, fetchImpl: goodFetch,
  });
  assert.equal(out.healthVersion, "1.18.18");
});

test("version output is parsed, not hardcoded; auth header is Basic", () => {
  const ns = isolationNs as unknown as Record<string, unknown>;
  const parseVersion = ns["parseVersionOutput"] as unknown as (s: string) => string;
  const buildHeader = ns["buildBasicAuthHeader"] as unknown as (u: string, p: string) => string;
  assert.equal(typeof parseVersion, "function", "parseVersionOutput must exist");
  assert.equal(typeof buildHeader, "function", "buildBasicAuthHeader must exist");
  assert.equal(parseVersion("1.18.18\n"), "1.18.18");
  assert.equal(parseVersion("opencode version 1.18.18 (abc)\n"), "1.18.18");
  assert.throws(() => parseVersion("\n"), /version/i);
  assert.equal(buildHeader("opencode", "s3"), `Basic ${Buffer.from("opencode:s3", "utf8").toString("base64")}`);
});
