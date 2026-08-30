import { describe, expect, it, vi } from "vitest";
import { badgeDisplayMode, setBadgeDisplayMode, setShowModelBadge, showModelBadge } from "../state";
import { showProfilesMenu } from "../dialogs";
import { formatActiveModelBadgeText } from "../../components";

describe("model badge state and migration", () => {
  it("updates badge visibility when setShowModelBadge is called with arguments", () => {
    setShowModelBadge(false);
    expect(showModelBadge()).toBe(false);
    setShowModelBadge(true);
    expect(showModelBadge()).toBe(true);
  });

  it("updates badge display mode when setBadgeDisplayMode is called with arguments", () => {
    setBadgeDisplayMode("profile");
    expect(badgeDisplayMode()).toBe("profile");
    setBadgeDisplayMode("model");
    expect(badgeDisplayMode()).toBe("model");
  });

  it("omits badge visibility and mode controls from the main profiles menu", () => {
    let renderedProps: any = null;
    const api = {
      ui: {
        dialog: {
          setSize: vi.fn(),
          replace: vi.fn((renderFn: () => any) => {
            renderedProps = renderFn().props;
          }),
          clear: vi.fn(),
        },
        DialogSelect: (props: any) => ({ type: "DialogSelect", props }),
      },
    };

    showProfilesMenu(api);
    expect(renderedProps).not.toBeNull();
    const values = renderedProps.options.map((opt: any) => opt.value);
    expect(values).not.toContain("toggle_badge_visible");
    expect(values).not.toContain("toggle_badge_mode");
    expect(values).toEqual(["create", "list", "plugins", "__close__"]);
  });

  it("renders ActiveModelBadge text properly with active profile", () => {
    const profile = {
      modelName: "Claude 3.5 Sonnet",
      contextLimit: 200000,
      reasoningEffort: "high",
      profileName: "test-profile",
    };
    const text = formatActiveModelBadgeText(profile as any, "model");
    expect(text).toContain("Claude 3.5 Sonnet");
    expect(text).toContain("effort: high");
  });
});
