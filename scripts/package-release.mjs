import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const packageJsonPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = pkg.version || "2.0.0";

const releaseDist = path.join(root, "dist-release");
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
  const src = path.join(root, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(stagingDir, file));
  }
}

const docsSrc = path.join(root, "docs");
const docsDest = path.join(stagingDir, "docs");
if (fs.existsSync(docsSrc)) {
  fs.cpSync(docsSrc, docsDest, { recursive: true });
}

const distSrc = path.join(root, "dist");
const distDest = path.join(stagingDir, "dist");
if (!fs.existsSync(distSrc) || !fs.existsSync(path.join(distSrc, "tui.js"))) {
  console.error("Error: dist/tui.js not found. Please run 'npm run build' first.");
  process.exit(1);
}
fs.cpSync(distSrc, distDest, { recursive: true });

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
