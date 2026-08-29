import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const packageJsonPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = pkg.version || "2.0.1";

export function validatePackageHygiene(stagingDir) {
  const forbiddenPatterns = [
    { name: "Specific Windows user path", regex: /C:[\\/\\\\]Users[\\/\\\\](?!<[a-z0-9_-]+>)[a-z0-9_]/i },
    { name: "Specific Projects path", regex: /C:[\\/\\\\]Projects/i },
    { name: "Author private username (DELL)", regex: /\bDELL\b/i },
    { name: "GitHub OAuth token", regex: /gho_[A-Za-z0-9_]+/i },
    { name: "GitHub Personal Access token", regex: /ghp_[A-Za-z0-9_]+/i },
    { name: "Agent NotebookLM private reference", regex: /agent-notebooklm/i },
  ];

  const forbiddenDirNames = new Set([
    "node_modules",
    ".agents",
    ".claude",
    ".github",
    ".git",
    ".codegraph",
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
  ]);

  const forbiddenFileNames = new Set([
    "skills-lock.json",
    ".last-run.json",
  ]);

  function scan(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(stagingDir, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (forbiddenDirNames.has(entry.name)) {
          throw new Error(`Hygiene validation failed: Forbidden directory '${relPath}' in release package`);
        }
        scan(fullPath);
      } else if (entry.isFile()) {
        if (forbiddenFileNames.has(entry.name)) {
          throw new Error(`Hygiene validation failed: Forbidden file '${relPath}' in release package`);
        }
        if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
          throw new Error(`Hygiene validation failed: Test file '${relPath}' in release package`);
        }
        if (/notebooklm/i.test(entry.name)) {
          throw new Error(`Hygiene validation failed: NotebookLM file '${relPath}' in release package`);
        }
        // Check content for text files
        if (/\.(js|mjs|cjs|ts|tsx|json|md|txt|html|css|sh|ps1|yml|yaml)$/i.test(entry.name)) {
          const content = fs.readFileSync(fullPath, "utf8");
          for (const { name, regex } of forbiddenPatterns) {
            if (regex.test(content)) {
              throw new Error(`Hygiene validation failed in '${relPath}': matches forbidden pattern ${name}`);
            }
          }
        }
      }
    }
  }

  scan(stagingDir);

  // Validate presence of critical public assets
  const required = [
    "dist/tui.js",
    "dist/plugins/suite-de-agentes/manifest.json",
    "dist/plugins/suite-de-agentes/dist/server.js",
    "dist/plugins/suite-de-agentes/dist/tui.js",
    "dist/plugins/suite-de-agentes/skills/task-tracker-manager/SKILL.md",
    "dist/plugins/task-manager/Task-Manager-Portable.html",
    "package.json",
    "README.md",
    "LICENSE",
  ];

  for (const req of required) {
    const p = path.join(stagingDir, req);
    if (!fs.existsSync(p)) {
      throw new Error(`Hygiene validation failed: Required asset '${req}' missing from release package`);
    }
  }
}

export function generateReleasePackage(packageRoot = root) {
  const releaseDist = path.join(packageRoot, "dist-release");
  if (fs.existsSync(releaseDist)) {
    fs.rmSync(releaseDist, { recursive: true, force: true });
  }
  fs.mkdirSync(releaseDist, { recursive: true });

  const stagingDir = path.join(releaseDist, `sdd-profile-manager-v${version}`);
  fs.mkdirSync(stagingDir, { recursive: true });

  const filesToCopy = [
    "package.json",
    "README.md",
    "LICENSE",
    "NOTICE.md",
    "SECURITY.md",
    "CHANGELOG.md",
  ];

  for (const file of filesToCopy) {
    const src = path.join(packageRoot, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(stagingDir, file));
    }
  }

  const docsSrc = path.join(packageRoot, "docs");
  const docsDest = path.join(stagingDir, "docs");
  if (fs.existsSync(docsSrc)) {
    fs.cpSync(docsSrc, docsDest, { recursive: true });
  }

  const distSrc = path.join(packageRoot, "dist");
  const distDest = path.join(stagingDir, "dist");
  if (!fs.existsSync(distSrc) || !fs.existsSync(path.join(distSrc, "tui.js"))) {
    console.error("Error: dist/tui.js not found. Please run 'npm run build' first.");
    process.exit(1);
  }
  fs.cpSync(distSrc, distDest, { recursive: true });

  console.log(`Validating package hygiene for v${version}...`);
  validatePackageHygiene(stagingDir);

  const tarName = `sdd-profile-manager-v${version}.tar.gz`;
  const zipName = `sdd-profile-manager-v${version}.zip`;
  const tarPath = path.join(releaseDist, tarName);
  const zipPath = path.join(releaseDist, zipName);

  console.log(`Packaging release archive v${version}...`);

  execFileSync("tar", [
    "-czf",
    tarName,
    `sdd-profile-manager-v${version}`
  ], { cwd: releaseDist, stdio: "inherit" });

  execFileSync("tar", [
    "-acf",
    zipName,
    `sdd-profile-manager-v${version}`
  ], { cwd: releaseDist, stdio: "inherit" });

  fs.rmSync(stagingDir, { recursive: true, force: true });

  const archives = fs.readdirSync(releaseDist).filter((f) => f.endsWith(".zip") || f.endsWith(".tar.gz"));
  const checksumLines = [];

  for (const archive of archives) {
    const archivePath = path.join(releaseDist, archive);
    const hash = crypto.createHash("sha256");
    const fileBuffer = fs.readFileSync(archivePath);
    hash.update(fileBuffer);
    const digest = hash.digest("hex");
    const stats = fs.statSync(archivePath);
    checksumLines.push(`${digest}  ${archive}`);
    console.log(`- ${archive} (${stats.size} bytes) SHA256: ${digest}`);
  }

  const checksumPath = path.join(releaseDist, "SHA256SUMS");
  fs.writeFileSync(checksumPath, checksumLines.join("\n") + "\n", "utf8");
  console.log(`\nChecksums written to ${checksumPath}`);
  console.log("Release packaging completed successfully.");
}

if (process.argv[1]?.endsWith("package-release.mjs") || process.argv[1]?.endsWith("package-release.js")) {
  generateReleasePackage();
}
