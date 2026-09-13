import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

afterEach(() => {
  delete process.env.LITEFORMS_NETWORK_MODE;
  delete process.env.LITEFORMS_DEVICE_ID;
});

describe("GET /api/health (contract v1)", () => {
  it("returns the health payload without secrets (default networkMode wifi)", async () => {
    const response = await GET();

    expect(await response.json()).toEqual({
      ok: true,
      name: "Liteforms Desktop",
      protocolVersion: "1.0",
      configVersions: ["1.0"],
      networkMode: "wifi"
    });
  });

  it("reports the networkMode handed over by the main process", async () => {
    process.env.LITEFORMS_NETWORK_MODE = "provisioning";
    const response = await GET();

    expect((await response.json()).networkMode).toBe("provisioning");
  });

  it("carries the persistent deviceId when the main process hands it over", async () => {
    process.env.LITEFORMS_DEVICE_ID = "desktop-8f31";
    const response = await GET();

    const body = await response.json();
    expect(body.deviceId).toBe("desktop-8f31");
    expect(body).toMatchObject({ ok: true, networkMode: "wifi" });
  });

  it("omits the deviceId field when no identity is available (additive field)", async () => {
    const response = await GET();

    // A v1 health payload without deviceId stays valid; the field is only
    // present when the main process generated one.
    expect(await response.json()).not.toHaveProperty("deviceId");
  });
});
