import { describe, expect, it } from "vitest";
import {
  classifyTaskManagerHtml,
  currentTaskManagerMeta,
  isLegacyManagedTaskManagerHtml,
  TASK_MANAGER_CAPABILITY_TOKEN_INSIGHTS,
} from "./task-manager-classifier";

describe("Task Manager template classifier", () => {
  it("distinguishes a current managed template from an old recognized version", () => {
    const current = `<div data-tm-capability="${TASK_MANAGER_CAPABILITY_TOKEN_INSIGHTS}"></div><script id="tm-state">${JSON.stringify(currentTaskManagerMeta())}</script>`;
    const old = `<div data-tm-capability="${TASK_MANAGER_CAPABILITY_TOKEN_INSIGHTS}"></div><script id="tm-state">${JSON.stringify({ ...currentTaskManagerMeta(), templateVersion: "0.9.0" })}</script>`;

    expect(classifyTaskManagerHtml(current)).toBe("current");
    expect(classifyTaskManagerHtml(old)).toBe("old");
  });

  it("classifies prior-current 1.1.0, 1.2.0, and 1.3.1 templates as old", () => {
    const prior110 = `<div data-tm-capability="${TASK_MANAGER_CAPABILITY_TOKEN_INSIGHTS}"></div><script id="tm-state">${JSON.stringify({ ...currentTaskManagerMeta(), templateVersion: "1.1.0" })}</script>`;
    const prior120 = `<div data-tm-capability="token-insights-v1"></div><script id="tm-state">${JSON.stringify({ ...currentTaskManagerMeta(), templateVersion: "1.2.0" })}</script>`;
    const prior131 = `<div data-tm-capability="${TASK_MANAGER_CAPABILITY_TOKEN_INSIGHTS}"></div><script id="tm-state">${JSON.stringify({ ...currentTaskManagerMeta(), templateVersion: "1.3.1" })}</script>`;
    expect(classifyTaskManagerHtml(prior110)).toBe("old");
    expect(classifyTaskManagerHtml(prior120)).toBe("old");
    expect(classifyTaskManagerHtml(prior131)).toBe("old");
  });

  it("treats templates with matching metadata version but missing structural capability marker as old", () => {
    const missingCapability = `<div class="old-shell"></div><script id="tm-state">${JSON.stringify(currentTaskManagerMeta())}</script>`;
    expect(classifyTaskManagerHtml(missingCapability)).toBe("old");
  });

  it("treats templates with welcome-dialog or old delegation markers as old even if version matched", () => {
    const legacyWithCurrentMeta = `<div data-tm-capability="${TASK_MANAGER_CAPABILITY_TOKEN_INSIGHTS}"><div id="welcome-dialog"></div></div><script id="tm-state">${JSON.stringify(currentTaskManagerMeta())}</script>`;
    expect(classifyTaskManagerHtml(legacyWithCurrentMeta)).toBe("old");
  });

  it("blocks files without the stable signature and treats absent files as missing", () => {
    expect(classifyTaskManagerHtml(undefined)).toBe("missing");
    expect(classifyTaskManagerHtml('<script id="tm-state">{"schemaVersion":"1.0"}</script>')).toBe("unrecognized");
  });

  it("recognizes an earlier host plugin version as an old managed template", () => {
    const earlierPlugin = `<div data-tm-capability="${TASK_MANAGER_CAPABILITY_TOKEN_INSIGHTS}"></div><script id="tm-state">${JSON.stringify({ ...currentTaskManagerMeta(), pluginVersion: "1.6.0" })}</script>`;

    expect(classifyTaskManagerHtml(earlierPlugin)).toBe("old");
  });

  it("blocks a signed state that omits a required plugin version", () => {
    const incompleteVersionState = { ...currentTaskManagerMeta() } as Record<string, unknown>;
    delete incompleteVersionState.pluginVersion;

    expect(classifyTaskManagerHtml(`<div data-tm-capability="${TASK_MANAGER_CAPABILITY_TOKEN_INSIGHTS}"></div><script id="tm-state">${JSON.stringify(incompleteVersionState)}</script>`)).toBe("unrecognized");
  });

  it("isLegacyManagedTaskManagerHtml correctly identifies legacy Task Manager vs arbitrary HTML", () => {
    const legacyHtml = `<div id="welcome-dialog">Modal</div><script id="tm-state">{"schemaVersion":"1.0","phases":[{"id":"p1","tasks":[]}]}</script>`;
    const arbitraryHtmlWithScript = `<html><body><script id="tm-state">{"random":"json"}</script></body></html>`;
    const plainHtml = `<html><body>Just a page</body></html>`;

    expect(isLegacyManagedTaskManagerHtml(legacyHtml)).toBe(true);
    expect(isLegacyManagedTaskManagerHtml(arbitraryHtmlWithScript)).toBe(false);
    expect(isLegacyManagedTaskManagerHtml(plainHtml)).toBe(false);
    expect(isLegacyManagedTaskManagerHtml(undefined)).toBe(false);
  });
});
