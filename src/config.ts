/** @jsxImportSource @opentui/solid */

/**
 * Plugin Configuration and Path Management
 *
 * Handles path resolution for config files, profile directories,
 * and project identification.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createLogger } from "./logger";

const log = createLogger("config");

/**
 * Collection of core plugin paths
 */
export type Paths = {
	configRoot: string;
	profilesDir: string;
	profileVersionsDir: string;
	configPath: string;
	backupPath: string;
	pluginConfigPath: string;
};

const DEFAULT_PLUGIN_SHORTCUTS = ["alt+k", "super+k"] as const;

/**
 * Resolves all necessary system paths for the plugin
 *
 * @returns Object containing all resolved paths
 */
export function resolvePaths(): Paths {
	const home = os.homedir();
	const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
	const configRoot = path.join(xdgConfig, "opencode");

	return {
		configRoot,
		profilesDir: path.join(configRoot, "profiles"),
		profileVersionsDir: path.join(configRoot, "profile-versions"),
		configPath: fs.existsSync(path.join(configRoot, "opencode.jsonc"))
			? path.join(configRoot, "opencode.jsonc") : path.join(configRoot, "opencode.json"),
		backupPath: path.join(configRoot, "opencode.json.bak"),
		pluginConfigPath: path.join(configRoot, "sdd-model-select.json"),
	};
}

function normalizeShortcutBinding(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase().replace(/\s*\+\s*/g, "+").replace(/\s+/g, "");
	return normalized ? normalized : null;
}

function expandShortcutBinding(binding: string): string[] {
	if (!binding.startsWith("alt+")) return [binding];
	return [binding, `super+${binding.slice(4)}`];
}

export function readPluginShortcutBindings(): string[] {
	const { pluginConfigPath } = resolvePaths();
	if (!fs.existsSync(pluginConfigPath)) return [...DEFAULT_PLUGIN_SHORTCUTS];

	try {
		const raw = JSON.parse(fs.readFileSync(pluginConfigPath, "utf-8"));
		const explicitShortcuts = Array.isArray(raw?.shortcuts)
			? raw.shortcuts.map(normalizeShortcutBinding).filter(Boolean) as string[]
			: [];
		if (explicitShortcuts.length > 0) return [...new Set(explicitShortcuts)];

		const shortcut = normalizeShortcutBinding(raw?.shortcut);
		if (shortcut) return [...new Set(expandShortcutBinding(shortcut))];
		log.warn(`readPluginShortcutBindings: missing shortcut/shortcuts in ${pluginConfigPath}`);
	} catch (e) {
		log.warn(`readPluginShortcutBindings: failed to read ${pluginConfigPath}`, e);
	}

	return [...DEFAULT_PLUGIN_SHORTCUTS];
}

/**
 * Ensures the profiles directory exists, creating it if necessary
 */
export function ensureProfilesDir(): void {
	const { profilesDir } = resolvePaths();
	if (!fs.existsSync(profilesDir)) {
		try {
			fs.mkdirSync(profilesDir, { recursive: true });
		} catch (e) {
			log.warn("ensureProfilesDir: failed to create profiles directory", e);
		}
	}
}

/**
 * Resolves a single project name for the current workspace
 *
 * @param api - The TUI API instance
 * @returns The most likely project name or "unknown"
 */
export function resolveProjectName(api: any): string {
	return resolveProjectCandidates(api)[0] || "unknown";
}

/**
 * Resolves the optional Engram project override from workspace/.engram/config.json.
 */
export function resolveEngramProjectName(api: any): string | null {
	const workspaceRoot = resolveWorkspaceRoot(api);
	const configPath = path.join(workspaceRoot, ".engram", "config.json");

	if (!fs.existsSync(configPath)) return null;

	try {
		const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		const projectName = typeof raw?.project_name === "string" ? raw.project_name.trim() : "";
		if (projectName) return projectName;
		log.warn(`resolveEngramProjectName: missing project_name in ${configPath}`);
	} catch (e) {
		log.warn(`resolveEngramProjectName: failed to read ${configPath}`, e);
	}

	return null;
}

/**
 * Identifies potential project names based on Git remotes, Git root, and directory name
 *
 * @param api - The TUI API instance
 * @returns Array of unique project name candidates
 */
export function resolveProjectCandidates(api: any): string[] {
	const directory = api?.state?.path?.directory || process.cwd();
	const candidates: string[] = [];

	try {
		const remote = execFileSync(
			"git",
			["-C", directory, "remote", "get-url", "origin"],
			{
				encoding: "utf-8",
				timeout: 2000,
				stdio: ["ignore", "pipe", "ignore"],
			},
		).trim();

		if (remote) {
			const repoName = remote
				.replace(/\.git$/, "")
				.split(/[/:]/)
				.pop()
				?.trim()
				.toLowerCase();
			if (repoName) candidates.push(repoName);
		}
	} catch (e) {
		log.warn(`resolveProjectCandidates: failed to read git origin for ${directory}`, e);
	}

	try {
		const root = execFileSync(
			"git",
			["-C", directory, "rev-parse", "--show-toplevel"],
			{
				encoding: "utf-8",
				timeout: 2000,
				stdio: ["ignore", "pipe", "ignore"],
			},
		).trim();

		if (root) {
			const rootName = path.basename(root)?.trim().toLowerCase();
			if (rootName) candidates.push(rootName);
		}
	} catch (e) {
		log.warn(`resolveProjectCandidates: failed to read git root for ${directory}`, e);
	}

	const dirName = path.basename(directory)?.trim().toLowerCase();
	if (dirName) candidates.push(dirName);

	return [...new Set(candidates.filter(Boolean))];
}

/**
 * Resolves the workspace root directory
 *
 * @param api - The TUI API instance
 * @returns The absolute path to the workspace root
 */
export function resolveWorkspaceRoot(api: any): string {
	return api?.state?.path?.directory || process.cwd();
}
