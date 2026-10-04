import { safeHostAction, safeHostAsyncAction } from "../host-compat";
import { openSessionVault, initSessionVault } from "../../plugins/opencode-session-vault/src/tui";

export const VAULT_COMMAND = ":session-vault";
export const VAULT_SHORTCUT = "alt+v";

type VaultRegistrationApi = {
  keymap?: {
    registerLayer(layer: {
      priority: number;
      commands: Array<{
        name: string;
        title: string;
        desc: string;
        category: string;
        nargs: "0";
        run(): boolean;
      }>;
      bindings: Array<{ key: string; cmd: string }>;
    }): unknown;
  };
};

export function createVaultAdapter(openVault: () => void): { register(api: VaultRegistrationApi): boolean } {
  return {
    register(api) {
      return safeHostAction("register Session Vault", () => {
        if (!api.keymap) return false;
        api.keymap.registerLayer({
          priority: 110,
          commands: [{
            name: VAULT_COMMAND,
            title: "Session Vault",
            desc: "Gestionar y respaldar sesiones",
            category: "Plugins",
            nargs: "0",
            run: () => { openVault(); return true; },
          }],
          // STRICT RULE: Register strictly alt+v, NEVER expand super+v (paste)
          bindings: [{ key: VAULT_SHORTCUT, cmd: VAULT_COMMAND }],
        });
        return true;
      }, false);
    },
  };
}

export async function openVendoredSessionVault(api: any): Promise<void> {
  await safeHostAsyncAction("open vendored Session Vault", () => openSessionVault(api), undefined);
}

export async function initVendoredSessionVault(api: any): Promise<void> {
  await safeHostAsyncAction(
    "init vendored Session Vault",
    async () => {
      await initSessionVault(api, { registerKeymap: false });
    },
    undefined,
  );
}
