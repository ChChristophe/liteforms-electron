import { describe, expect, it } from "vitest";
import {
  displayKey,
  resolveHologramAutoOpen,
  type HologramAutoOpenPrevious,
} from "./hologramAutoOpen";

const lgDisplay = { left: 1920, top: 0, width: 1440, height: 2560 };

function current(overrides: Partial<Parameters<typeof resolveHologramAutoOpen>[0]> = {}) {
  return {
    hasElectronApi: true,
    connected: true,
    display: lgDisplay,
    hologramActive: false,
    ...overrides,
  };
}

function previous(overrides: Partial<HologramAutoOpenPrevious> = {}): HologramAutoOpenPrevious {
  return { connected: undefined, displayKey: "", ...overrides };
}

describe("displayKey", () => {
  it("builds a comparable key from bounds", () => {
    expect(displayKey(lgDisplay)).toBe("1920:0:1440:2560");
    expect(displayKey(undefined)).toBe("");
  });
});

describe("resolveHologramAutoOpen", () => {
  it("does nothing without the Electron preload API", () => {
    expect(resolveHologramAutoOpen(current({ hasElectronApi: false }), previous())).toBe("none");
  });

  it("does nothing when the bridge reports connected without display bounds", () => {
    expect(resolveHologramAutoOpen(current({ display: undefined }), previous())).toBe("none");
  });

  it("opens on the first connected transition with display bounds", () => {
    expect(resolveHologramAutoOpen(current(), previous())).toBe("open");
  });

  it("does nothing while connected with unchanged display bounds", () => {
    expect(
      resolveHologramAutoOpen(current(), previous({ connected: true, displayKey: displayKey(lgDisplay) })),
    ).toBe("none");
  });

  it("opens again when the display bounds change", () => {
    expect(
      resolveHologramAutoOpen(
        current({ display: { left: 0, top: 0, width: 1440, height: 2560 } }),
        previous({ connected: true, displayKey: displayKey(lgDisplay) }),
      ),
    ).toBe("open");
  });

  it("reopens the hologram window on a reconnect transition after sleep or replug", () => {
    expect(
      resolveHologramAutoOpen(
        current({ hologramActive: true }),
        previous({ connected: false, displayKey: displayKey(lgDisplay) }),
      ),
    ).toBe("reopen");
  });

  it("does not fight the user when they closed the hologram while the bridge stayed connected", () => {
    expect(
      resolveHologramAutoOpen(
        current({ hologramActive: false }),
        previous({ connected: true, displayKey: displayKey(lgDisplay) }),
      ),
    ).toBe("none");
  });
});
