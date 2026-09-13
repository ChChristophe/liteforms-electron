// Secure WiFi credentials store (contract v1 + POC.md Â§13.6): the target
// WiFi password is encrypted with Electron safeStorage (DPAPI on Windows /
// keyring on Linux) and persisted as one file in <userData>/config/. The
// plaintext password NEVER appears in logs, responses or errors â€” failures
// are surfaced as booleans/throwers without payload details.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WifiCredentials } from "./wifiConfig";

export const WIFI_CREDENTIALS_FILE_NAME = "wifi-credentials.json";

type StoredWifiCredentials = {
  version: 1;
  savedAt: string;
  /** safeStorage ciphertext, base64. The plaintext password is never written. */
  passwordEncrypted: string;
  ssid: string;
  security: string;
};

export type WifiCredentialsStore = {
  save(credentials: WifiCredentials): boolean;
  /** Returns null when absent or unreadable (first boot / corrupt file). */
  load(): WifiCredentials | null;
  clear(): void;
};

type SafeStorageLike = {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

/** `<dir>/wifi-credentials.json`. */
export function resolveWifiCredentialsPath(dir: string): string {
  return join(dir, WIFI_CREDENTIALS_FILE_NAME);
}

export function createWifiCredentialsStore(
  path: string,
  safeStorage: SafeStorageLike
): WifiCredentialsStore {
  return {
    save(credentials: WifiCredentials): boolean {
      try {
        if (!safeStorage.isEncryptionAvailable()) {
          return false;
        }
        const payload: StoredWifiCredentials = {
          version: 1,
          savedAt: new Date().toISOString(),
          ssid: credentials.ssid,
          security: credentials.security,
          passwordEncrypted: safeStorage.encryptString(credentials.password).toString("base64")
        };
        writeFileSync(`${path}.tmp`, JSON.stringify(payload, null, 2), "utf8");
        renameSync(`${path}.tmp`, path);
        return true;
      } catch {
        return false;
      }
    },

    load(): WifiCredentials | null {
      let raw: string;
      try {
        raw = readFileSync(path, "utf8");
      } catch {
        return null; // Absent file = never provisioned (or wiped): normal.
      }
      try {
        const parsed = JSON.parse(raw) as Partial<StoredWifiCredentials>;
        if (
          parsed.version !== 1
          || typeof parsed.ssid !== "string"
          || typeof parsed.security !== "string"
          || typeof parsed.passwordEncrypted !== "string"
          || parsed.ssid.length < 1
        ) {
          return null;
        }
        const password = safeStorage.decryptString(Buffer.from(parsed.passwordEncrypted, "base64"));
        return { ssid: parsed.ssid, password, security: parsed.security as WifiCredentials["security"] };
      } catch {
        return null;
      }
    },

    clear(): void {
      try {
        writeFileSync(path, "", "utf8");
      } catch {
        // Best effort: provisioning state must not depend on the wipe.
      }
    }
  };
}
