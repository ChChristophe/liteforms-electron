import { describe, expect, it, vi } from "vitest";
import { checkLookingGlassBridgeConnection, getLookingGlassBridgeConnection } from "./bridgeConnection";

describe("checkLookingGlassBridgeConnection", () => {
  it("reports Bridge connected when Bridge.js status succeeds", async () => {
    const status = vi.fn().mockResolvedValue(true);

    await expect(checkLookingGlassBridgeConnection({ getBridgeClient: () => ({ status }) })).resolves.toBe(true);
    expect(status).toHaveBeenCalledOnce();
  });

  it("reports Bridge missing when Bridge.js status returns false", async () => {
    const status = vi.fn().mockResolvedValue(false);

    await expect(checkLookingGlassBridgeConnection({ getBridgeClient: () => ({ status }) })).resolves.toBe(false);
    expect(status).toHaveBeenCalledOnce();
  });

  it("reports Bridge missing when Bridge.js cannot create a client", async () => {
    const getBridgeClient = vi.fn(() => {
      throw new Error("Bridge unavailable");
    });

    await expect(checkLookingGlassBridgeConnection({ getBridgeClient })).resolves.toBe(false);
  });

  it("uses the connected native display when available", async () => {
    const status = vi.fn().mockResolvedValue(false);
    const getNativeBridgeState = vi.fn().mockResolvedValue({
      available: true,
      source: "native",
      display: { serial: "LKG-123", width: 1440, height: 2560 },
      calibration: { serial: "LKG-123" },
    });

    await expect(getLookingGlassBridgeConnection({
      getBridgeClient: () => ({ status }),
      getNativeBridgeState,
      hasNativeBridgeApi: () => true,
    })).resolves.toEqual({
      connected: true,
      source: "native",
      display: { left: 0, top: 0, width: 1440, height: 2560 },
    });

    expect(getNativeBridgeState).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("falls back to Bridge.js when the native driver has no display", async () => {
    const status = vi.fn().mockResolvedValue(true);
    const getNativeBridgeState = vi.fn().mockResolvedValue({
      available: false,
      source: "native",
      error: "No Looking Glass displays were reported by the native Bridge driver.",
    });

    await expect(getLookingGlassBridgeConnection({
      getBridgeClient: () => ({ status }),
      getNativeBridgeState,
      hasNativeBridgeApi: () => true,
    })).resolves.toEqual({ connected: true, source: "bridge-js" });

    expect(getNativeBridgeState).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledOnce();
  });

  it("reports the native probe error when neither the native driver nor Bridge.js connects", async () => {
    const status = vi.fn().mockResolvedValue(false);
    const nativeError = "No Looking Glass displays were reported by the native Bridge driver.";
    const getNativeBridgeState = vi.fn().mockResolvedValue({
      available: false,
      source: "native",
      error: nativeError,
    });

    await expect(getLookingGlassBridgeConnection({
      getBridgeClient: () => ({ status }),
      getNativeBridgeState,
      hasNativeBridgeApi: () => true,
    })).resolves.toEqual({
      connected: false,
      source: "none",
      error: nativeError,
    });

    expect(status).toHaveBeenCalledOnce();
  });
});
