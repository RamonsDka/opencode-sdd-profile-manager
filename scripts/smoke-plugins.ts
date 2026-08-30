import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distributionRoot = path.join(packageRoot, "dist");
const requiredAssets = [
	"plugins/task-manager/Task-Manager-Portable.html",
	"plugins/suite-de-agentes/README.md",
	"plugins/suite-de-agentes/skills/task-tracker-manager/SKILL.md",
	"plugins/suite-de-agentes/dist/server.js",
	"plugins/suite-de-agentes/dist/tui.js",
];
const requiredProvenance = ["suite-de-agentes", "task-manager"];

function requireReadable(filePath: string): void {
	if (!fs.statSync(filePath).isFile() || fs.readFileSync(filePath).length === 0) {
		throw new Error(`Missing or unreadable packaged asset: ${filePath}`);
	}
}

function verifyProvenance(): void {
	for (const plugin of requiredProvenance) {
		const provenancePath = path.join(distributionRoot, "plugins", plugin, "PROVENANCE.json");
		const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8")) as { commit?: unknown; version?: unknown };
		if (typeof provenance.commit !== "string" || !provenance.commit || typeof provenance.version !== "string" || !provenance.version) {
			throw new Error(`Invalid packaged provenance: ${provenancePath}`);
		}
	}
}

function ensureDistributedPluginAssets(): void {
	for (const plugin of ["suite-de-agentes", "task-manager"]) {
		const src = path.join(packageRoot, "plugins", plugin);
		const dest = path.join(distributionRoot, "plugins", plugin);
		if (!fs.existsSync(dest)) {
			fs.cpSync(src, dest, {
				recursive: true,
				filter: (sourcePath) => {
					const relative = path.relative(src, sourcePath);
					if (relative.split(path.sep).includes("node_modules")) return false;
					return true;
				},
			});
		}
	}
}

function main(): void {
	ensureDistributedPluginAssets();
	const originalCwd = process.cwd();
	const temporaryCwd = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-engram-plugin-smoke-"));
	try {
		process.chdir(temporaryCwd);
		for (const asset of requiredAssets) requireReadable(path.join(distributionRoot, asset));
		verifyProvenance();
		console.log(`Plugin distribution smoke passed from temporary cwd: ${temporaryCwd}`);
	} finally {
		process.chdir(originalCwd);
		fs.rmSync(temporaryCwd, { recursive: true, force: true });
	}
}

main();
