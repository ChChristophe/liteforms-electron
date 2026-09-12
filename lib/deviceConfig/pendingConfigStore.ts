// Module-memory POC state. Since the durable file store (deviceConfigFile.ts,
// POC.md §13.4) it is only a read cache and the dev-without-Electron fallback:
// with LITEFORMS_DEVICE_CONFIG_DIR set the file is the source of truth and
// this park merely serves the session when a file write failed.
// Kept in lib/ (not in a route file): Next.js route files may only export
// HTTP handlers, and app/api/poc/pending-config imports these helpers.
import type { PocDeviceConfig } from "./pocConfig";

let pendingConfig: (PocDeviceConfig & { receivedAt: string }) | null = null;

export function readPendingConfig() {
  return pendingConfig;
}

export function clearPendingConfig() {
  pendingConfig = null;
}

export function setPendingConfig(config: PocDeviceConfig, receivedAt: string) {
  pendingConfig = { ...config, receivedAt };
}
