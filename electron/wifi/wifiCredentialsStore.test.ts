import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWifiCredentialsStore, resolveWifiCredentialsPath } from "./wifiCredentialsStore";

function fakeSafeStorage(overrides: Partial<Parameters<typeof createWifiCredentialsStore>[1]> = {}) {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc(${plain})`, "utf8"),
    decryptString: (encrypted: Buffer) => encrypted.toString("utf8").replace(/^enc\(|\)$/g, ""),
    ...overrides
  };
}

describe("wifiCredentialsStore (safeStorage)", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips credentials without ever writing the plaintext password", () => {
    dir = mkdtempSync(join(tmpdir(), "liteforms-wifi-store-"));
    const path = resolveWifiCredentialsPath(dir);
    const store = createWifiCredentialsStore(path, fakeSafeStorage());

    expect(store.save({ ssid: "MaisonWifi", password: "mot-de-passe-wifi", security: "WPA2-PSK" })).toBe(true);
    const rawFile = readFileSync(path, "utf8");
    expect(rawFile).not.toContain("mot-de-passe-wifi");
    expect(rawFile).toContain("MaisonWifi");

    expect(store.load()).toEqual({ ssid: "MaisonWifi", password: "mot-de-passe-wifi", security: "WPA2-PSK" });
  });

  it("returns null on absent and corrupt files, never throws", () => {
    dir = mkdtempSync(join(tmpdir(), "liteforms-wifi-store-"));
    const path = resolveWifiCredentialsPath(dir);
    const store = createWifiCredentialsStore(path, fakeSafeStorage());

    expect(store.load()).toBeNull();

    writeFileSync(path, "{ not json", "utf8");
    expect(store.load()).toBeNull();
  });

  it("refuses to save when safeStorage encryption is unavailable (no plaintext fallback)", () => {
    dir = mkdtempSync(join(tmpdir(), "liteforms-wifi-store-"));
    const store = createWifiCredentialsStore(
      resolveWifiCredentialsPath(dir),
      fakeSafeStorage({ isEncryptionAvailable: () => false })
    );

    expect(store.save({ ssid: "Net", password: "pw", security: "WPA2-PSK" })).toBe(false);
    expect(store.load()).toBeNull();
  });

  it("clear leaves an empty file that loads as null", () => {
    dir = mkdtempSync(join(tmpdir(), "liteforms-wifi-store-"));
    const path = resolveWifiCredentialsPath(dir);
    const store = createWifiCredentialsStore(path, fakeSafeStorage());

    store.save({ ssid: "Net", password: "pw", security: "OPEN" });
    store.clear();

    expect(store.load()).toBeNull();
  });
});
