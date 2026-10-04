import { describe, expect, it, vi } from "vitest";
import {
  createVaultAdapter,
  openVendoredSessionVault,
  initVendoredSessionVault,
  VAULT_COMMAND,
  VAULT_SHORTCUT,
} from "./vault-adapter";

type VaultKeymapLayer = {
  priority: number;
  commands: Array<{ name: string; title: string; desc: string; category: string; nargs: string; run(): boolean }>;
  bindings: Array<{ key: string; cmd: string }>;
};

describe("Session Vault adapter", () => {
  it("registers the Session Vault command and Alt+V strictly without super+v", () => {
    const registerLayer = vi.fn((_layer: VaultKeymapLayer) => vi.fn());
    const open = vi.fn();

    const registered = createVaultAdapter(open).register({ keymap: { registerLayer } });
    const layer = registerLayer.mock.calls[0]?.[0];

    expect(registered).toBe(true);
    expect(layer?.priority).toBe(110);
    expect(layer?.commands).toEqual([
      expect.objectContaining({
        name: VAULT_COMMAND,
        title: "Session Vault",
        desc: "Gestionar y respaldar sesiones",
        category: "Plugins",
      }),
    ]);
    expect(layer?.bindings).toEqual([{ key: VAULT_SHORTCUT, cmd: VAULT_COMMAND }]);
    expect(VAULT_SHORTCUT).toBe("alt+v");

    // Strictly ensure super+v (paste) is never registered
    const allKeys = layer?.bindings.map((b) => b.key) ?? [];
    expect(allKeys).toContain("alt+v");
    expect(allKeys).not.toContain("super+v");
    expect(allKeys.some((k) => k.includes("super"))).toBe(false);

    expect(layer?.commands[0]?.run()).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("returns false safely when keymap API is absent", () => {
    const registered = createVaultAdapter(() => {}).register({});
    expect(registered).toBe(false);
  });

  it("safely invokes openVendoredSessionVault", async () => {
    const mockApi = {
      app: { version: "1.18.29" },
      client: {
        project: { current: vi.fn().mockResolvedValue({ data: { id: "test-proj" } }) },
      },
      state: { path: { directory: "/test" } },
      route: { current: { name: "home" } },
      renderer: { width: 100, height: 40 },
      ui: { dialog: { replace: vi.fn(), setSize: vi.fn(), clear: vi.fn() }, toast: vi.fn() },
      lifecycle: { signal: { aborted: false }, onDispose: vi.fn() },
    };

    await expect(openVendoredSessionVault(mockApi)).resolves.not.toThrow();
  });

  it("safely initializes vendored Session Vault runtime without registering standalone keymap", async () => {
    const mockRegisterLayer = vi.fn();
    const mockApi = {
      app: { version: "1.18.29" },
      client: {
        project: { current: vi.fn().mockResolvedValue({ data: { id: "test-proj" } }) },
      },
      state: { path: { directory: "/test" } },
      route: { current: { name: "home" } },
      keymap: { registerLayer: mockRegisterLayer },
      renderer: { width: 100, height: 40 },
      ui: { dialog: { replace: vi.fn(), setSize: vi.fn(), clear: vi.fn() }, toast: vi.fn() },
      lifecycle: { signal: { aborted: false }, onDispose: vi.fn() },
    };

    await initVendoredSessionVault(mockApi);
    // Standalone keymap (alt+shift+s) must not be registered during embedded init
    expect(mockRegisterLayer).not.toHaveBeenCalled();
  });
});
