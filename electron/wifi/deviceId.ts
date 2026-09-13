// Persistent appliance identity (protocol/DEVICE_API.md §Identité de
// l'appliance, PLAN_DIRECTEUR.md §5ter.5). Generated ONCE, stored in
// <userData>/config/device-id.json (same dir as device-config.json), format
// `desktop-<4 hex>`. Non-secret: it lets the Mobile re-match the appliance
// after the network transition. Atomic tmp+rename write, tolerant read — a
// corrupt or malformed file is regenerated, never a crash.
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEVICE_ID_FILE_NAME = "device-id.json";

const DEVICE_ID_PATTERN = /^desktop-[0-9a-f]{4}$/;

/** `<dir>/device-id.json`. */
export function resolveDeviceIdPath(dir: string): string {
  return join(dir, DEVICE_ID_FILE_NAME);
}

function generateDeviceId(): string {
  return `desktop-${randomBytes(2).toString("hex")}`;
}

/** Read the persisted deviceId, generating and persisting it on first boot.
 * Returns null only when nothing can be written either (the caller keeps
 * running without identity — health routes then omit the field, which the
 * contract allows as additive). */
export function readOrCreateDeviceId(path: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { deviceId?: unknown };
    if (typeof parsed.deviceId === "string" && DEVICE_ID_PATTERN.test(parsed.deviceId)) {
      return parsed.deviceId;
    }
  } catch {
    // Absent (first boot) or corrupt: regenerate below.
  }
  const deviceId = generateDeviceId();
  try {
    writeFileSync(`${path}.tmp`, JSON.stringify({ version: 1, deviceId }, null, 2), "utf8");
    renameSync(`${path}.tmp`, path);
  } catch {
    return null;
  }
  return deviceId;
}
