// Main-process credential IPC (contract v1, decision D1). The provider API
// keys live in <userData>/config/provider-credentials.json — the SAME file
// the Next server writes via POST /api/credentials (LITEFORMS_CREDENTIALS_PATH).
// The renderer reaches it through this narrow IPC channel (get/set), never
// over HTTP, so a key never leaves the appliance over the network.
//
// File format must stay in sync with lib/deviceConfig/providerCredentials.ts
// (single source of truth on the Next side): { version: 1, credentials: {
// "<provider>": "<apiKey>" } }. The file NAME is duplicated here on purpose:
// electron/ and lib/ are separate compilation units (see electron/tsconfig.json).
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IpcMain } from "electron";

export const PROVIDER_CREDENTIALS_FILE_NAME = "provider-credentials.json";

const getCredentialChannel = "liteforms:credential:get";
const setCredentialChannel = "liteforms:credential:set";

type CredentialsMap = Record<string, string>;

function resolveCredentialsPath(dir: string): string {
  return join(dir, PROVIDER_CREDENTIALS_FILE_NAME);
}

function readCredentials(path: string): CredentialsMap {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; credentials?: unknown };
    if (parsed.version !== 1 || typeof parsed.credentials !== "object" || parsed.credentials === null) {
      return {};
    }
    const credentials: CredentialsMap = {};
    for (const [provider, apiKey] of Object.entries(parsed.credentials as Record<string, unknown>)) {
      if (typeof apiKey === "string" && apiKey.length > 0) credentials[provider] = apiKey;
    }
    return credentials;
  } catch {
    return {};
  }
}

function writeCredential(path: string, provider: string, apiKey: string): boolean {
  const credentials = readCredentials(path);
  credentials[provider] = apiKey;
  try {
    writeFileSync(`${path}.tmp`, JSON.stringify({ version: 1, credentials }, null, 2), "utf8");
    renameSync(`${path}.tmp`, path);
    return true;
  } catch {
    return false;
  }
}

/** Registers the get/set credential IPC handlers. `dir` is the same
 * `<userData>/config` folder handed to the Next server via
 * LITEFORMS_DEVICE_CONFIG_DIR. The raw key is never logged — only provider ids
 * and booleans. */
export function registerCredentialIpc(
  ipcMain: IpcMain,
  dir: string,
  log: (line: string) => void
): void {
  const path = resolveCredentialsPath(dir);

  ipcMain.handle(getCredentialChannel, (_event, provider: unknown): string | undefined => {
    if (typeof provider !== "string" || provider.length === 0) return undefined;
    return readCredentials(path)[provider];
  });

  ipcMain.handle(setCredentialChannel, (_event, provider: unknown, apiKey: unknown): boolean => {
    if (typeof provider !== "string" || provider.length === 0) return false;
    if (typeof apiKey !== "string" || apiKey.length === 0) return false;
    const ok = writeCredential(path, provider, apiKey);
    log(`[credentials] set provider=${provider} saved=${ok} (key redacted)`);
    return ok;
  });
}
