import { describe, it, expect } from "vitest";
import {
  BASE_CANONICAL_ORDER,
  CATALOG_GROUPS,
  FALLBACK_SYNC_BASE_ORDER,
  FALLBACK_MANAGED_COUNT,
  PERSISTIBLE_AGENT_KEYS,
  RUNTIME_SYNC_AGENT_KEYS,
  VISIBLE_CATALOG_ROWS,
  isFallbackCatalogAgent,
  isRuntimeSyncCatalogAgent,
  isValidAgentKey,
  deriveFallbackProfileKey,
  classifyFamily,
} from "./catalog";
import { isCatalogVisibleAgent, isEditablePrimaryAgent } from "./utils";

const EXPECTED_FALLBACK_ORDER: readonly string[] = [
  "jd-fix-agent-fallback",
  "jd-judge-a-fallback",
  "jd-judge-b-fallback",
  "review-readability-fallback",
  "review-refuter-fallback",
  "review-reliability-fallback",
  "review-resilience-fallback",
  "review-risk-fallback",
  "review-validator-fallback",
  "sdd-apply-fallback",
  "sdd-archive-fallback",
  "sdd-design-fallback",
  "sdd-explore-fallback",
  "sdd-init-fallback",
  "sdd-onboard-fallback",
  "sdd-propose-fallback",
  "sdd-spec-fallback",
  "sdd-tasks-fallback",
  "sdd-verify-fallback",
] as const;

const EXPECTED_CATALOG_GROUPS: readonly (readonly string[])[] = [
  ["sdd-ORCHETATOR"],
  [
    "sdd-propose",
    "sdd-design",
    "sdd-apply",
    "sdd-verify",
    "sdd-spec",
    "sdd-onboard",
    "sdd-explore",
    "sdd-init",
    "sdd-tasks",
    "sdd-archive",
  ],
  ["jd-judge-a", "jd-judge-b", "jd-fix-agent"],
  [
    "review-readability",
    "review-reliability",
    "review-resilience",
    "review-validator",
    "review-refuter",
    "review-risk",
    "model-audit",
  ],
  ["gentle-ai-windows-validator", "compaction", "summary", "title"],
] as const;

const EXPECTED_RUNTIME_SYNC_KEYS = [
  ...EXPECTED_CATALOG_GROUPS.flat(),
].filter((name) => !["sdd-ORCHETATOR", "compaction", "summary", "title"].includes(name));

describe("catalog SSOT & validation", () => {
  describe("grouped catalog views (Unit 1)", () => {
    it("defines five ordered groups with every approved agent in exact sequence", () => {
      expect(CATALOG_GROUPS).toHaveLength(5);
      expect(CATALOG_GROUPS.map((group) => [...group.agents])).toEqual(EXPECTED_CATALOG_GROUPS);
      expect(PERSISTIBLE_AGENT_KEYS).toHaveLength(25);
      expect(PERSISTIBLE_AGENT_KEYS).toEqual(EXPECTED_CATALOG_GROUPS.flat());
    });

    it("emits only real agent rows without synthetic separator tokens", () => {
      expect(VISIBLE_CATALOG_ROWS).toEqual(PERSISTIBLE_AGENT_KEYS.map((key) => ({ kind: "agent", key })));
      expect(VISIBLE_CATALOG_ROWS).toHaveLength(25);
      expect(VISIBLE_CATALOG_ROWS.every((row) => row.kind === "agent")).toBe(true);
      expect(PERSISTIBLE_AGENT_KEYS).not.toContain("judgment-day");
      expect(PERSISTIBLE_AGENT_KEYS).not.toContain("readability");
      expect(isCatalogVisibleAgent("judgment-day")).toBe(false);
      expect(isCatalogVisibleAgent("review-readability")).toBe(true);
      expect(RUNTIME_SYNC_AGENT_KEYS).toEqual(EXPECTED_RUNTIME_SYNC_KEYS);
      expect(RUNTIME_SYNC_AGENT_KEYS).not.toContain("sdd-ORCHETATOR");
    });

    it("keeps auxiliaries model-and-level editable while excluding internal auxiliaries from fallback eligibility", () => {
      expect(isRuntimeSyncCatalogAgent("gentle-ai-windows-validator")).toBe(true);
      expect(["compaction", "summary", "title"].every((key) => !isRuntimeSyncCatalogAgent(key))).toBe(true);
      expect(["gentle-ai-windows-validator", "compaction", "summary", "title"].every(isEditablePrimaryAgent)).toBe(true);
      expect(["compaction", "summary", "title"].every((key) => !isFallbackCatalogAgent(key))).toBe(true);
      expect(isFallbackCatalogAgent("gentle-ai-windows-validator")).toBe(true);
      expect(isFallbackCatalogAgent("model-audit")).toBe(true);
    });
  });

  describe("BASE_CANONICAL_ORDER & counts (T01, T13, T16)", () => {
    it("has 40 total entries with 21 primaries and 19 fallbacks in exact sequence", () => {
      expect(BASE_CANONICAL_ORDER).toHaveLength(40);
      expect(FALLBACK_MANAGED_COUNT).toBe(19);

      const fallbacks = BASE_CANONICAL_ORDER.filter((name) => deriveFallbackProfileKey(name) !== null);
      expect(fallbacks).toHaveLength(19);
      expect(fallbacks).toEqual(EXPECTED_FALLBACK_ORDER);

      const primaries = BASE_CANONICAL_ORDER.filter((name) => deriveFallbackProfileKey(name) === null);
      expect(primaries).toHaveLength(21);
      expect(primaries[0]).toBe("gentle-orchestrator");
      expect(primaries).toContain("model-audit");
      expect(FALLBACK_SYNC_BASE_ORDER).toHaveLength(19);
      expect(FALLBACK_SYNC_BASE_ORDER).not.toContain("model-audit");
      expect(FALLBACK_SYNC_BASE_ORDER).not.toContain("gentle-orchestrator");
    });
  });

  describe("isValidAgentKey (T03, T24)", () => {
    it("validates valid agent key bounds and formats", () => {
      expect(isValidAgentKey("a")).toBe(true);
      expect(isValidAgentKey("a".repeat(64))).toBe(true);
      expect(isValidAgentKey("sdd-init")).toBe(true);
      expect(isValidAgentKey("my_agent.v1-test")).toBe(true);
    });

    it("rejects invalid keys, empty string, oversized, prototype pollution and invalid chars", () => {
      expect(isValidAgentKey("")).toBe(false);
      expect(isValidAgentKey("a".repeat(65))).toBe(false);
      expect(isValidAgentKey("__proto__")).toBe(false);
      expect(isValidAgentKey("constructor")).toBe(false);
      expect(isValidAgentKey("prototype")).toBe(false);
      expect(isValidAgentKey("a/b")).toBe(false);
      expect(isValidAgentKey("a b")).toBe(false);
      expect(isValidAgentKey(null)).toBe(false);
      expect(isValidAgentKey(undefined)).toBe(false);
      expect(isValidAgentKey(123)).toBe(false);
    });
  });

  describe("deriveFallbackProfileKey (T15, T16, T23, T32, T35, T36)", () => {
    it("derives primary key from valid base and future fallback agents", () => {
      expect(deriveFallbackProfileKey("sdd-apply-fallback")).toBe("sdd-apply");
      expect(deriveFallbackProfileKey("jd-judge-a-fallback")).toBe("jd-judge-a");
      expect(deriveFallbackProfileKey("review-risk-fallback")).toBe("review-risk");
      expect(deriveFallbackProfileKey("sdd-future-fallback")).toBe("sdd-future");
    });

    it("returns null for primaries, double fallbacks, model-audit, and ineligible keys", () => {
      expect(deriveFallbackProfileKey("sdd-init")).toBe(null);
      expect(deriveFallbackProfileKey("gentle-orchestrator")).toBe(null);
      expect(deriveFallbackProfileKey("sdd-apply-fallback-fallback")).toBe(null);
      expect(deriveFallbackProfileKey("model-audit-fallback")).toBe(null);
      expect(deriveFallbackProfileKey("weird-fallback")).toBe(null);
      expect(deriveFallbackProfileKey("")).toBe(null);
    });
  });

  describe("classifyFamily (T12)", () => {
    it("classifies agents into their respective visual families", () => {
      expect(classifyFamily({ displayName: "gentle-orchestrator", isFallback: false, base: true })).toBe("Orchestrator");
      expect(classifyFamily({ displayName: "sdd-init", isFallback: false, base: true })).toBe("SDD");
      expect(classifyFamily({ displayName: "jd-fix-agent", isFallback: false, base: true })).toBe("JD");
      expect(classifyFamily({ displayName: "review-risk", isFallback: false, base: true })).toBe("Review");
      expect(classifyFamily({ displayName: "model-audit", isFallback: false, base: true })).toBe("Tools");
      expect(classifyFamily({ displayName: "sdd-apply-fallback", isFallback: true, base: true })).toBe("Fallbacks");
      expect(classifyFamily({ displayName: "tester-fallback", isFallback: false, base: false })).toBe("Fallbacks");
      expect(classifyFamily({ displayName: "my-custom-agent", isFallback: false, base: false })).toBe("Custom");
    });
  });
});
