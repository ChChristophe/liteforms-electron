// Durable device-config store (replaces the POC memory park as source of
// truth, POC.md §13.4). One JSON file in <userData>/config/, written by the
// Next server through a path handed over by the Electron main process —
// same mechanism as LITEFORMS_VRM_LIBRARY_DIR. Node-only: never imported by
// renderer code (the server/renderer boundary of POC.md §3.2 stays intact).
// The raw payload is never logged; paths stay out of the [poc] lines too.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDeviceConfig, type PocDeviceConfig } from "./pocConfig";
import { pocLog } from "./pocLog";

export const DEVICE_CONFIG_FILE_NAME = "device-config.json";

export type DeviceConfigFilePayload = {
  version: 1;
  receivedAt: string;
  config: PocDeviceConfig;
};

/** `<dir>/device-config.json`. */
export function resolveDeviceConfigPath(dir: string): string {
  return join(dir, DEVICE_CONFIG_FILE_NAME);
}

/** Atomic save: write `<file>.tmp` then rename over the target (atomic on
 * Windows and Linux). Returns false on failure — callers keep the memory
 * park as fallback, the HTTP contract never breaks on a storage hiccup. */
export function saveDeviceConfigFile(path: string, config: PocDeviceConfig, receivedAt: string): boolean {
  const payload: DeviceConfigFilePayload = { version: 1, receivedAt, config };
  try {
    writeFileSync(`${path}.tmp`, JSON.stringify(payload, null, 2), "utf8");
    renameSync(`${path}.tmp`, path);
    return true;
  } catch {
    pocLog("device-config file save failed (memory park kept as fallback)");
    return false;
  }
}

/** Tolerant load: missing or corrupt file -> null (never throws, never logs
 * the payload). The config is re-validated with the contract parser so a
 * hand-edited or stale file cannot inject an invalid payload. */
export function loadDeviceConfigFile(path: string): DeviceConfigFilePayload | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    // Absent file = normal first boot: no log, no noise.
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DeviceConfigFilePayload>;
    if (parsed.version !== 1 || typeof parsed.receivedAt !== "string") {
      throw new Error("bad envelope");
    }
    const result = parseDeviceConfig(parsed.config);
    if ("error" in result) {
      pocLog(`device-config file ignored (invalid content code=${result.error})`);
      return null;
    }
    return { version: 1, receivedAt: parsed.receivedAt, config: result.config };
  } catch {
    pocLog("device-config file corrupt (starting empty, next POST rewrites it)");
    return null;
  }
}
