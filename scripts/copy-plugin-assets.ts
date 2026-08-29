import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".agents",
  ".claude",
  ".github",
  ".git",
  ".codegraph",
  ".pi",
  ".atl",
  ".pi-lens",
  ".engram",
  ".cortexmem",
  ".cortex",
  ".context-mode",
  ".playwright-mcp",
  ".hallmark",
  ".impeccable",
  ".opencode",
  "openspec",
  "specs",
  "test",
  "tests",
  "__tests__",
  "test-results",
  "coverage",
  "release",
  "dist-release",
  ".tmp",
  "tmp",
  "image",
  "src",
]);

const EXCLUDED_FILE_PATTERNS = [
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /\.last-run\.json$/,
  /^skills-lock\.json$/,
  /notebooklm/i,
  /\.DS_Store$/,
  /Thumbs\.db$/,
  /\.log$/,
  /\.tmp-.*$/,
  /\.bak$/,
  /^package\.mjs$/,
  /^run-tests\.mjs$/,
  /^tsconfig(\..*)?\.json$/,
  /^tsup\.config\.ts$/,
];

export function shouldCopyPluginAsset(srcRoot: string, sourcePath: string): boolean {
  const relative = path.relative(srcRoot, sourcePath);
  if (!relative || relative === ".") return true;

  const segments = relative.split(/[/\\]/);

  // Check directory exclusions
  for (const segment of segments) {
    if (EXCLUDED_DIRS.has(segment)) {
      return false;
    }
  }

  // Check file exclusions
  const basename = path.basename(sourcePath);
  for (const pattern of EXCLUDED_FILE_PATTERNS) {
    if (pattern.test(basename)) {
      return false;
    }
  }

  return true;
}

export function copyPluginAssets(packageRoot = root): void {
  for (const plugin of ["suite-de-agentes", "task-manager"]) {
    const src = path.join(packageRoot, "plugins", plugin);
    const dest = path.join(packageRoot, "dist", "plugins", plugin);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    if (!fs.existsSync(src)) continue;

    fs.cpSync(src, dest, {
      recursive: true,
      filter: (sourcePath) => shouldCopyPluginAsset(src, sourcePath),
    });
  }
}

if (process.argv[1]?.endsWith("copy-plugin-assets.ts") || process.argv[1]?.endsWith("copy-plugin-assets.js")) {
  copyPluginAssets();
}
