import { describe, expect, it } from "vitest";
import {
  parseNetworkMode,
  parseWifiCredentials,
  resolveProvisioningPort
} from "./wifiConfig";

const contractPayload = {
  ssid: "MaisonWifi",
  password: "mot-de-passe-wifi",
  security: "WPA2-PSK"
};

describe("parseWifiCredentials (contract v1)", () => {
  it("accepts the exact contract payload", () => {
    const result = parseWifiCredentials(contractPayload);

    expect(result).toEqual({
      ok: true,
      credentials: { ssid: "MaisonWifi", password: "mot-de-passe-wifi", security: "WPA2-PSK" }
    });
  });

  it("ignores unknown fields", () => {
    const result = parseWifiCredentials({ ...contractPayload, extra: "ignored", nested: { a: 1 } });

    expect(result).toMatchObject({ ok: true, credentials: { ssid: "MaisonWifi" } });
  });

  it("defaults missing security to WPA2-PSK", () => {
    const result = parseWifiCredentials({ ssid: "Net", password: "x" });

    expect(result).toMatchObject({ ok: true, credentials: { security: "WPA2-PSK" } });
  });

  it("accepts an empty password only for OPEN and normalizes it", () => {
    const open = parseWifiCredentials({ ssid: "Cafe", password: "", security: "OPEN" });
    expect(open).toEqual({ ok: true, credentials: { ssid: "Cafe", password: "", security: "OPEN" } });

    const secured = parseWifiCredentials({ ssid: "Net", password: "", security: "WPA2-PSK" });
    expect(secured).toMatchObject({ ok: false, code: "INVALID_WIFI_CONFIG" });
  });

  it("rejects a missing, empty or oversized ssid", () => {
    expect(parseWifiCredentials({ password: "x" }).ok).toBe(false);
    expect(parseWifiCredentials({ ssid: "", password: "x" }).ok).toBe(false);
    expect(parseWifiCredentials({ ssid: "a".repeat(33), password: "x" }).ok).toBe(false);
  });

  it("rejects an unknown security value", () => {
    const result = parseWifiCredentials({ ssid: "Net", password: "x", security: "WEP" });

    expect(result).toMatchObject({ ok: false, code: "INVALID_WIFI_CONFIG", message: expect.stringContaining("WPA2-PSK") });
    // The rejected value must not be echoed back in the message.
    expect((result as { message: string }).message).not.toContain("WEP");
  });

  it("rejects a non-string password and a non-object body", () => {
    expect(parseWifiCredentials({ ssid: "Net", password: 42 }).ok).toBe(false);
    expect(parseWifiCredentials("not-an-object").ok).toBe(false);
    expect(parseWifiCredentials(null).ok).toBe(false);
  });

  it("never echoes the password back in any message", () => {
    const secret = "super-secret-password";
    const cases = [
      parseWifiCredentials({ ssid: "Net", password: secret, security: "WEP" }),
      parseWifiCredentials({ ssid: "", password: secret }),
      parseWifiCredentials({ ssid: "Net", password: `${secret}!`, security: "OPEN" })
    ];
    for (const result of cases) {
      if (!result.ok) {
        expect(result.message).not.toContain(secret);
      }
    }
  });
});

describe("parseNetworkMode", () => {
  it("accepts the three contract values and falls back to wifi", () => {
    expect(parseNetworkMode("ethernet")).toBe("ethernet");
    expect(parseNetworkMode("provisioning")).toBe("provisioning");
    expect(parseNetworkMode("wifi")).toBe("wifi");
    expect(parseNetworkMode("garbage")).toBe("wifi");
    expect(parseNetworkMode(undefined)).toBe("wifi");
  });
});

describe("resolveProvisioningPort", () => {
  it("defaults to 8080 and accepts a configured port", () => {
    expect(resolveProvisioningPort({})).toBe(8080);
    expect(resolveProvisioningPort({ LITEFORMS_PROVISIONING_PORT: "8090" })).toBe(8090);
    expect(resolveProvisioningPort({ LITEFORMS_PROVISIONING_PORT: "not-a-number" })).toBe(8080);
    expect(resolveProvisioningPort({ LITEFORMS_PROVISIONING_PORT: "99999" })).toBe(8080);
  });
});
