import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
// @ts-ignore
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { requiredPluginAssets, verifyPluginAssets } from "./verify-assets";
import { shouldCopyPluginAsset } from "./copy-plugin-assets";
// @ts-ignore
import { validatePackageHygiene } from "./package-release.mjs";

const root = path.resolve(import.meta.dirname, "..");

describe("Phase 0 Publication Foundation & Asset Boundaries", () => {
  describe("required plugin assets", () => {
    it("requires the portable template and Suite offline help", () => {
      expect(requiredPluginAssets("/package").map((asset) => asset.replaceAll("\\", "/"))).toEqual([
        "/package/plugins/task-manager/Task-Manager-Portable.html",
        "/package/plugins/suite-de-agentes/README.md",
      ]);
    });

    it("verifies required plugin assets exist in workspace", () => {
      expect(() => verifyPluginAssets(root)).not.toThrow();
    });
  });

  describe("copy-plugin-assets hygiene filter", () => {
    const fakeSrc = "/fake/plugins/suite-de-agentes";

    it("excludes dev-only and harness directories", () => {
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/.agents")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/.claude")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/.github")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/.git")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/.codegraph")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/.engram")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/openspec")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/src")).toBe(false);
    });

    it("excludes tests, specs, test results, and dev configs", () => {
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/test")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/tests")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/test/agent.test.ts")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/test-results")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/.last-run.json")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/package.mjs")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/tsconfig.json")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/tsup.config.ts")).toBe(false);
    });

    it("excludes local registries, notebooklm, and uncurated screenshots", () => {
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/skills-lock.json")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/agent-notebooklm.md")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/.notebooklm")).toBe(false);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/docs/image")).toBe(false);
    });

    it("includes public runtime assets, Task Manager Portable, and public skills", () => {
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/dist/server.js")).toBe(true);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/dist/tui.js")).toBe(true);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/manifest.json")).toBe(true);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/README.md")).toBe(true);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/LICENSE")).toBe(true);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/SECURITY.md")).toBe(true);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/PROVENANCE.json")).toBe(true);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/install.ps1")).toBe(true);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/install.sh")).toBe(true);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/scripts/installer.mjs")).toBe(true);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/skills/task-tracker-manager/SKILL.md")).toBe(true);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/task-manager/Task-Manager-Portable.html")).toBe(true);
      expect(shouldCopyPluginAsset(fakeSrc, "/fake/plugins/suite-de-agentes/docs/images/catalog-overview.png")).toBe(true);
    });
  });

  describe("release package hygiene validation", () => {
    it("rejects staging directories containing machine-specific paths", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hygiene-test-"));
      try {
        fs.writeFileSync(path.join(tempDir, "sample.js"), 'const p = "C:\\\\Users\\\\DELL\\\\projects";');
        expect(() => validatePackageHygiene(tempDir)).toThrow(/matches forbidden pattern/i);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("rejects staging directories containing forbidden folders", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hygiene-test-"));
      try {
        fs.mkdirSync(path.join(tempDir, ".agents"), { recursive: true });
        expect(() => validatePackageHygiene(tempDir)).toThrow(/Forbidden directory '.agents'/i);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("rejects staging directories containing agent-notebooklm files", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hygiene-test-"));
      try {
        fs.writeFileSync(path.join(tempDir, "agent-notebooklm.md"), "# NotebookLM");
        expect(() => validatePackageHygiene(tempDir)).toThrow(/NotebookLM file 'agent-notebooklm.md'/i);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("GitHub YAML Issue Forms validation", () => {
    const issueTemplateDir = path.join(root, ".github", "ISSUE_TEMPLATE");

    it("contains valid config.yml", () => {
      const configPath = path.join(issueTemplateDir, "config.yml");
      expect(fs.existsSync(configPath)).toBe(true);
      const parsed = yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      expect(parsed.blank_issues_enabled).toBe(false);
      expect(Array.isArray(parsed.contact_links)).toBe(true);
    });

    it.each([
      ["enhancement.yml", "enhancement", "[feat]: "],
      ["documentation.yml", "documentation", "[docs]: "],
      ["security.yml", "security", "[sec]: "],
      ["release_task.yml", "release", "[release]: "],
      ["bug_report.yml", "bug", "[bug]: "],
    ])("validates %s schema and attributes", (filename, label, titlePrefix) => {
      const formPath = path.join(issueTemplateDir, filename);
      expect(fs.existsSync(formPath)).toBe(true);
      const parsed = yaml.load(fs.readFileSync(formPath, "utf8")) as {
        name?: string;
        description?: string;
        title?: string;
        labels?: string[];
        body?: Array<{ type: string; id?: string; attributes?: Record<string, unknown> }>;
      };

      expect(typeof parsed.name).toBe("string");
      expect(parsed.name!.length).toBeGreaterThan(0);
      expect(typeof parsed.description).toBe("string");
      expect(parsed.description!.length).toBeGreaterThan(0);
      expect(parsed.title?.startsWith(titlePrefix)).toBe(true);
      expect(parsed.labels).toContain(label);
      expect(Array.isArray(parsed.body)).toBe(true);
      expect(parsed.body!.length).toBeGreaterThan(1);
    });
  });
});
